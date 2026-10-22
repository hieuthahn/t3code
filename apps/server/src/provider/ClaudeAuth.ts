import {
  ProviderSetupError,
  type ProviderAuthMethod,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ProviderAuthFlow from "@t3tools/provider-core/server/providerAuthFlow";
import type { ProviderAuthController } from "@t3tools/provider-core/server/auth";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { makeClaudeEnvironment } from "./Drivers/ClaudeHome.ts";

const BROWSER_METHOD_ID = "claude-browser";
const INTERACTION_ID = "claude-login";
const EXIT_AFTER_CODE_TIMEOUT = "90 seconds";
const OUTPUT_LINES_KEPT = 20;

const methods: ReadonlyArray<ProviderAuthMethod> = [
  {
    id: BROWSER_METHOD_ID,
    name: "Sign in with Claude",
    description: "Opens a Claude sign-in link, then asks for the code shown afterward.",
    type: "agent",
  },
];

const isUrlCharacter = (character: string): boolean => {
  const code = character.charCodeAt(0);
  return code > 0x20 && code !== 0x7f;
};

/** Pull the first sign-in link out of CLI output that may wrap it in terminal escapes. */
export const extractClaudeAuthorizeUrl = (text: string): string | undefined => {
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const start = text.indexOf("https://", searchFrom);
    if (start === -1) return undefined;
    let end = start;
    while (end < text.length && isUrlCharacter(text.charAt(end))) end += 1;
    const candidate = text.slice(start, end);
    if (candidate.includes("/oauth/authorize")) return candidate;
    searchFrom = end;
  }
  return undefined;
};

/** Hide OAuth parameters and token-shaped values before CLI output reaches a log or the UI. */
export const redactClaudeAuthOutput = (text: string): string =>
  text
    // eslint-disable-next-line no-control-regex -- terminal escapes wrap the link the CLI prints
    .replace(/\u001b\][^\u0007]*\u0007|\u001b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/(https:\/\/[^\s?]+)\?\S*/g, "$1?<redacted>")
    .replace(/[A-Za-z0-9_-]{32,}(?:[#.][A-Za-z0-9_-]{8,})*/g, "<redacted>");

export interface ClaudeAuthOptions {
  readonly instanceId: ProviderInstanceId;
  readonly binaryPath: string;
  readonly homePath: string;
  readonly configDir: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly onChanged: (signedIn: boolean) => Effect.Effect<void>;
}

export const makeClaudeAuth = Effect.fn("makeClaudeAuth")(function* (options: ClaudeAuthOptions) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const crypto = yield* Crypto.Crypto;
  const platform = yield* HostProcess.Platform;
  const failure = (operation: string, detail: string, cause?: unknown) =>
    new ProviderSetupError({
      instanceId: options.instanceId,
      operation,
      detail,
      ...(cause === undefined ? {} : { cause }),
    });
  const claudeEnvironment = yield* makeClaudeEnvironment(
    { homePath: options.homePath },
    options.environment,
  );
  // Without BROWSER the CLI opens the system browser, which may be signed in to the wrong account.
  const environment: NodeJS.ProcessEnv = {
    ...claudeEnvironment,
    ...(platform === "win32" || claudeEnvironment.BROWSER ? {} : { BROWSER: "true" }),
  };
  const spawn = (args: ReadonlyArray<string>) =>
    spawner
      .spawn(
        ChildProcess.make(options.binaryPath, [...args], { env: environment, extendEnv: true }),
      )
      .pipe(
        Effect.mapError((cause) =>
          failure("spawn", "Could not run the Claude CLI. Check the binary path.", cause),
        ),
      );

  const authenticate: Parameters<typeof ProviderAuthFlow.make>[0]["authenticate"] = Effect.fn(
    "ClaudeAuth.authenticate",
  )(function* (_methodId, context) {
    const child = yield* spawn(["auth", "login"]);
    yield* Effect.addFinalizer(() => child.kill().pipe(Effect.ignore));
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const codeSent = yield* Deferred.make<void>();
    const outputLines: Array<string> = [];
    let published = false;
    let buffered = "";
    let pending = "";
    const recordOutput = (text: string) => {
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      const kept = lines.map(redactClaudeAuthOutput).filter((line) => line.trim().length > 0);
      outputLines.push(...kept);
      outputLines.splice(0, Math.max(0, outputLines.length - OUTPUT_LINES_KEPT));
    };
    const lastOutputLine = () => {
      const tail = redactClaudeAuthOutput(pending).trim();
      return tail.length > 0 ? tail : outputLines.at(-1);
    };
    const submitCode = (code: string) =>
      Stream.run(Stream.make(encoder.encode(`${code.trim()}\n`)), child.stdin).pipe(
        Effect.mapError((cause) =>
          failure("complete", "Could not send the code to the Claude CLI.", cause),
        ),
        Effect.tap(() => Deferred.succeed(codeSent, undefined)),
      );
    yield* Stream.merge(child.stdout, child.stderr).pipe(
      Stream.runForEach((chunk) => {
        const text = decoder.decode(chunk, { stream: true });
        recordOutput(text);
        if (published) return Effect.void;
        buffered += text;
        const url = extractClaudeAuthorizeUrl(buffered);
        if (url === undefined) return Effect.void;
        published = true;
        return context.setInteraction(
          {
            type: "browser",
            id: INTERACTION_ID,
            url,
            requiresConsent: false,
            acceptsCallback: true,
          },
          undefined,
          submitCode,
        );
      }),
      Effect.ignore,
      Effect.forkScoped,
    );
    const exitAfterCodeTimeout = Deferred.await(codeSent).pipe(
      Effect.andThen(Effect.sleep(EXIT_AFTER_CODE_TIMEOUT)),
      Effect.andThen(
        Effect.suspend(() => {
          const last = lastOutputLine();
          return failure(
            "wait",
            `The Claude CLI did not finish ${EXIT_AFTER_CODE_TIMEOUT} after the code was sent${
              last ? ` (last output: ${last})` : ""
            }. Start again.`,
          );
        }),
      ),
    );
    const exitCode = yield* child.exitCode.pipe(
      Effect.mapError((cause) =>
        failure("wait", "The Claude sign-in stopped unexpectedly.", cause),
      ),
      Effect.raceFirst(exitAfterCodeTimeout),
    );
    if (exitCode !== 0) {
      const last = lastOutputLine();
      return yield* failure(
        "wait",
        last ? `Claude sign-in failed: ${last}` : "Claude sign-in did not complete. Start again.",
      );
    }
    yield* context.verifying;
    yield* options.onChanged(true);
  });

  const logout = Effect.scoped(
    Effect.gen(function* () {
      const child = yield* spawn(["auth", "logout"]);
      const exitCode = yield* child.exitCode.pipe(
        Effect.mapError((cause) => failure("logout", "Claude could not sign out.", cause)),
      );
      if (exitCode !== 0) {
        return yield* failure("logout", "Claude could not sign out.");
      }
      yield* options.onChanged(false);
    }),
  );

  const controller: ProviderAuthController = yield* ProviderAuthFlow.make({
    instanceId: options.instanceId,
    credentialBinding: { owner: "provider", key: `claude:${options.configDir}` },
    methods: Effect.succeed(methods),
    defaultMethodId: BROWSER_METHOD_ID,
    authenticate,
    logout,
  }).pipe(Effect.provideService(Crypto.Crypto, crypto));
  return controller;
});
