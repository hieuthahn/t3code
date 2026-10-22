import {
  ProviderSetupError,
  type ProviderAuthMethod,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ProviderAuthFlow from "@t3tools/provider-core/server/providerAuthFlow";
import type { ProviderAuthController } from "@t3tools/provider-core/server/auth";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { extractAuthorizeUrl, redactCliAuthOutput } from "./ProviderCliAuthOutput.ts";

const BROWSER_METHOD_ID = "codex-browser";
const INTERACTION_ID = "codex-login";
const OUTPUT_LINES_KEPT = 20;

const methods: ReadonlyArray<ProviderAuthMethod> = [
  {
    id: BROWSER_METHOD_ID,
    name: "Sign in with ChatGPT",
    description: "Opens a ChatGPT sign-in link. Codex finishes once the browser confirms.",
    type: "agent",
  },
];

export interface CodexCliAuthOptions {
  readonly instanceId: ProviderInstanceId;
  readonly binaryPath: string;
  /** The `CODEX_HOME` that receives this instance's `auth.json`. */
  readonly codexHome: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly onChanged: (signedIn: boolean) => Effect.Effect<void>;
  readonly timeoutMs?: number;
}

export const makeCodexCliAuth = Effect.fn("makeCodexCliAuth")(function* (
  options: CodexCliAuthOptions,
) {
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
  // Without BROWSER the CLI opens the system browser, which may be signed in to the wrong account.
  const environment: NodeJS.ProcessEnv = {
    ...options.environment,
    CODEX_HOME: options.codexHome,
    ...(platform === "win32" || options.environment.BROWSER ? {} : { BROWSER: "true" }),
  };
  const logContext = { instanceId: options.instanceId, codexHome: options.codexHome };
  const spawn = (args: ReadonlyArray<string>) =>
    spawner
      .spawn(
        ChildProcess.make(options.binaryPath, [...args], { env: environment, extendEnv: true }),
      )
      .pipe(
        Effect.mapError((cause) =>
          failure("spawn", "Could not run the Codex CLI. Check the binary path.", cause),
        ),
      );

  const authenticate: Parameters<typeof ProviderAuthFlow.make>[0]["authenticate"] = Effect.fn(
    "CodexCliAuth.authenticate",
  )(function* (_methodId, context) {
    const child = yield* spawn(["login"]);
    yield* Effect.annotateCurrentSpan({ ...logContext, pid: child.pid });
    yield* Effect.logInfo("Codex sign-in started.", { ...logContext, pid: child.pid });
    yield* Effect.addFinalizer(() => child.kill().pipe(Effect.ignore));
    const decoder = new TextDecoder();
    const outputLines: Array<string> = [];
    let published = false;
    let buffered = "";
    let pending = "";
    const recordOutput = (text: string) => {
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      const kept = lines.map(redactCliAuthOutput).filter((line) => line.trim().length > 0);
      outputLines.push(...kept);
      outputLines.splice(0, Math.max(0, outputLines.length - OUTPUT_LINES_KEPT));
      return Effect.forEach(kept, (line) => Effect.logInfo("Codex sign-in output.", { line }), {
        discard: true,
      });
    };
    const lastOutputLine = () => {
      const tail = redactCliAuthOutput(pending).trim();
      return tail.length > 0 ? tail : outputLines.at(-1);
    };
    yield* Stream.merge(child.stdout, child.stderr).pipe(
      Stream.runForEach((chunk) => {
        const text = decoder.decode(chunk, { stream: true });
        const logged = recordOutput(text);
        if (published) return logged;
        buffered += text;
        const url = extractAuthorizeUrl(buffered);
        if (url === undefined) return logged;
        published = true;
        return logged.pipe(
          Effect.andThen(Effect.logInfo("Codex sign-in link shown.")),
          Effect.andThen(
            context.setInteraction({
              type: "browser",
              id: INTERACTION_ID,
              url,
              requiresConsent: false,
            }),
          ),
        );
      }),
      Effect.tapError((cause) =>
        Effect.logWarning("Codex sign-in output stopped.", { cause: String(cause) }),
      ),
      Effect.ignore,
      Effect.forkScoped,
    );
    const exitCode = yield* child.exitCode.pipe(
      Effect.mapError((cause) => failure("wait", "The Codex sign-in stopped unexpectedly.", cause)),
      Effect.onInterrupt(() =>
        Effect.logWarning("Codex sign-in interrupted before the CLI exited.", {
          ...logContext,
          pid: child.pid,
          linkShown: published,
          lastOutput: lastOutputLine() ?? "",
        }),
      ),
    );
    yield* Effect.logInfo("Codex sign-in CLI exited.", { ...logContext, exitCode });
    if (exitCode !== 0) {
      const last = lastOutputLine();
      return yield* failure(
        "wait",
        last ? `Codex sign-in failed: ${last}` : "Codex sign-in did not complete. Start again.",
      );
    }
    yield* context.verifying;
    yield* options.onChanged(true);
  });

  const logout = Effect.scoped(
    Effect.gen(function* () {
      const child = yield* spawn(["logout"]);
      const exitCode = yield* child.exitCode.pipe(
        Effect.mapError((cause) => failure("logout", "Codex could not sign out.", cause)),
      );
      yield* Effect.logInfo("Codex sign-out CLI exited.", { ...logContext, exitCode });
      if (exitCode !== 0) {
        return yield* failure("logout", "Codex could not sign out.");
      }
      yield* options.onChanged(false);
    }),
  );

  const controller: ProviderAuthController = yield* ProviderAuthFlow.make({
    instanceId: options.instanceId,
    credentialBinding: { owner: "provider", key: `codex:${options.codexHome}` },
    methods: Effect.succeed(methods),
    defaultMethodId: BROWSER_METHOD_ID,
    authenticate,
    logout,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  }).pipe(Effect.provideService(Crypto.Crypto, crypto));
  return controller;
});
