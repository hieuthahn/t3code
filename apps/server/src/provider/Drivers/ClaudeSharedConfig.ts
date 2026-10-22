import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

const JsonObjectFromString = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));
const encodeJsonObject = Schema.encodeEffect(JsonObjectFromString);
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

export const CLAUDE_SHARED_CONFIG_ENTRIES = [
  "settings.json",
  "CLAUDE.md",
  "skills",
  "agents",
  "commands",
  "hooks",
  "rules",
  "plugins",
] as const;

export type ClaudeSharedConfigAction =
  | {
      readonly kind: "link";
      readonly entry: string;
      readonly source: string;
      readonly target: string;
    }
  | { readonly kind: "unlink"; readonly entry: string; readonly target: string }
  | { readonly kind: "keep"; readonly entry: string }
  | { readonly kind: "conflict"; readonly entry: string; readonly target: string };

export interface ClaudeSharedConfigInput {
  readonly enabled: boolean;
  /** The default Claude home whose entries are shared. */
  readonly sourceDir: string;
  /** The instance's CLAUDE_CONFIG_DIR. */
  readonly targetDir: string;
}

/** Decide, without touching disk, which shared entries to link or unlink. */
export const planClaudeSharedConfig = Effect.fn("planClaudeSharedConfig")(function* (
  input: ClaudeSharedConfigInput,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sourceDir = path.resolve(input.sourceDir);
  const targetDir = path.resolve(input.targetDir);
  if (sourceDir === targetDir) {
    return CLAUDE_SHARED_CONFIG_ENTRIES.map((entry): ClaudeSharedConfigAction => ({
      kind: "keep",
      entry,
    }));
  }
  const actions: ClaudeSharedConfigAction[] = [];
  for (const entry of CLAUDE_SHARED_CONFIG_ENTRIES) {
    const source = path.join(sourceDir, entry);
    const target = path.join(targetDir, entry);
    const linkTarget = yield* fileSystem.readLink(target).pipe(
      Effect.map((value) => path.resolve(targetDir, value)),
      Effect.orElseSucceed(() => undefined),
    );
    const linkedToSource = linkTarget === source;
    if (!input.enabled) {
      actions.push(linkedToSource ? { kind: "unlink", entry, target } : { kind: "keep", entry });
      continue;
    }
    if (linkedToSource) {
      actions.push({ kind: "keep", entry });
      continue;
    }
    const sourceExists = yield* fileSystem.exists(source).pipe(Effect.orElseSucceed(() => false));
    if (!sourceExists) {
      actions.push({ kind: "keep", entry });
      continue;
    }
    const occupied =
      linkTarget !== undefined ||
      (yield* fileSystem.exists(target).pipe(Effect.orElseSucceed(() => true)));
    actions.push(
      occupied ? { kind: "conflict", entry, target } : { kind: "link", entry, source, target },
    );
  }
  return actions;
});

/** Apply link and unlink actions; a conflict is reported and never overwritten. */
export const applyClaudeSharedConfig = Effect.fn("applyClaudeSharedConfig")(function* (
  actions: ReadonlyArray<ClaudeSharedConfigAction>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  for (const action of actions) {
    if (action.kind === "link") {
      yield* fileSystem.symlink(action.source, action.target);
    } else if (action.kind === "unlink") {
      yield* fileSystem.remove(action.target);
    }
  }
});

/** Copy the default home's MCP servers into the instance's .claude.json when they differ. */
export const syncClaudeSharedMcpServers = Effect.fn("syncClaudeSharedMcpServers")(
  function* (input: { readonly sourceConfigFile: string; readonly targetConfigFile: string }) {
    const fileSystem = yield* FileSystem.FileSystem;
    const readJson = (file: string) =>
      fileSystem.readFileString(file).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(JsonObjectFromString)),
        Effect.orElseSucceed(() => undefined),
      );
    const source = yield* readJson(input.sourceConfigFile);
    const sourceServers = source?.mcpServers;
    if (sourceServers === undefined || typeof sourceServers !== "object") return "skipped" as const;
    const target = yield* readJson(input.targetConfigFile);
    if (target === undefined) return "skipped" as const;
    if (encodeJson(target.mcpServers ?? null) === encodeJson(sourceServers)) {
      return "unchanged" as const;
    }
    const temporary = `${input.targetConfigFile}.t3-shared-${process.pid}`;
    const encoded = yield* encodeJsonObject({
      ...target,
      mcpServers: sourceServers,
    });
    yield* fileSystem.writeFileString(temporary, encoded);
    yield* fileSystem.rename(temporary, input.targetConfigFile);
    return "updated" as const;
  },
);

/** Bring an instance's config dir in line with its share setting; failures only log. */
export const syncClaudeSharedConfig = Effect.fn("syncClaudeSharedConfig")(
  function* (input: ClaudeSharedConfigInput & { readonly homeDirectory: string }) {
    const path = yield* Path.Path;
    const actions = yield* planClaudeSharedConfig(input);
    yield* applyClaudeSharedConfig(actions);
    const conflicts = actions.filter((action) => action.kind === "conflict");
    if (conflicts.length > 0) {
      yield* Effect.logWarning("Claude shared config left existing entries in place.", {
        targetDir: input.targetDir,
        entries: conflicts.map((action) => action.entry),
      });
    }
    if (!input.enabled || path.resolve(input.sourceDir) === path.resolve(input.targetDir)) return;
    const defaultHome = path.join(input.homeDirectory, ".claude");
    yield* syncClaudeSharedMcpServers({
      sourceConfigFile:
        path.resolve(input.sourceDir) === defaultHome
          ? path.join(input.homeDirectory, ".claude.json")
          : path.join(input.sourceDir, ".claude.json"),
      targetConfigFile: path.join(input.targetDir, ".claude.json"),
    });
  },
  Effect.catchCause((cause) => Effect.logWarning("Claude shared config sync failed.", cause)),
);
