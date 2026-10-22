import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

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
  | { readonly kind: "keep"; readonly entry: string }
  | { readonly kind: "conflict"; readonly entry: string; readonly target: string };

export interface ClaudeSharedConfigInput {
  /** The default Claude home whose entries are shared. */
  readonly sourceDir: string;
  /** The instance's CLAUDE_CONFIG_DIR. */
  readonly targetDir: string;
}

/** Decide, without touching disk, which shared entries to link. */
export const planClaudeSharedConfig = Effect.fn("planClaudeSharedConfig")(function* (
  input: ClaudeSharedConfigInput,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const realPathOf = (value: string) =>
    fileSystem.realPath(value).pipe(Effect.orElseSucceed(() => path.resolve(value)));
  const sourceDir = path.resolve(input.sourceDir);
  const targetDir = path.resolve(input.targetDir);
  if ((yield* realPathOf(sourceDir)) === (yield* realPathOf(targetDir))) {
    return CLAUDE_SHARED_CONFIG_ENTRIES.map((entry): ClaudeSharedConfigAction => ({
      kind: "keep",
      entry,
    }));
  }
  const actions: ClaudeSharedConfigAction[] = [];
  for (const entry of CLAUDE_SHARED_CONFIG_ENTRIES) {
    const source = path.join(sourceDir, entry);
    const target = path.join(targetDir, entry);
    const sourceExists = yield* fileSystem.exists(source).pipe(Effect.orElseSucceed(() => false));
    if (!sourceExists) {
      actions.push({ kind: "keep", entry });
      continue;
    }
    const isLink = yield* fileSystem.readLink(target).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
    if (isLink && (yield* realPathOf(target)) === (yield* realPathOf(source))) {
      actions.push({ kind: "keep", entry });
      continue;
    }
    const occupied =
      isLink || (yield* fileSystem.exists(target).pipe(Effect.orElseSucceed(() => true)));
    actions.push(
      occupied ? { kind: "conflict", entry, target } : { kind: "link", entry, source, target },
    );
  }
  return actions;
});

/** Apply link actions; a conflict is reported and never overwritten. */
export const applyClaudeSharedConfig = Effect.fn("applyClaudeSharedConfig")(function* (
  actions: ReadonlyArray<ClaudeSharedConfigAction>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  for (const action of actions) {
    if (action.kind === "link") {
      yield* fileSystem.symlink(action.source, action.target);
    }
  }
});

/**
 * Link missing shared entries when sharing is on; links made by hand or by another tool stay.
 * MCP servers are left to the claude-accounts job, which owns each account's .claude.json.
 */
export const syncClaudeSharedConfig = Effect.fn("syncClaudeSharedConfig")(
  function* (input: ClaudeSharedConfigInput & { readonly enabled: boolean }) {
    if (!input.enabled) return;
    const actions = yield* planClaudeSharedConfig(input);
    yield* applyClaudeSharedConfig(actions);
    const conflicts = actions.filter((action) => action.kind === "conflict");
    if (conflicts.length > 0) {
      yield* Effect.logWarning("Claude shared config left existing entries in place.", {
        targetDir: input.targetDir,
        entries: conflicts.map((action) => action.entry),
      });
    }
  },
  Effect.catchCause((cause) => Effect.logWarning("Claude shared config sync failed.", cause)),
);
