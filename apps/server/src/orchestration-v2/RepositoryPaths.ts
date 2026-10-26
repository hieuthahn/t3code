import * as HostProcess from "@t3tools/shared/HostProcess";

function normalizeSeparators(path: string): string {
  return path.replaceAll("\\", "/");
}

export interface RepositoryPathOptions {
  readonly platform?: NodeJS.Platform | undefined;
}

const hostPlatform = (options: RepositoryPathOptions | undefined) =>
  options?.platform ?? HostProcess.Platform.defaultValue();

/** macOS reports /var/... and /private/var/... for the same directory. */
function canonicalPath(path: string, platform: NodeJS.Platform): string {
  const normalized = normalizeSeparators(path);
  return platform === "darwin" ? normalized.replace(/^\/private(?=\/)/, "") : normalized;
}

function stripRoot(path: string, root: string, platform: NodeJS.Platform): string | null {
  const canonicalRoot = canonicalPath(root, platform);
  const prefix = canonicalRoot.endsWith("/") ? canonicalRoot : `${canonicalRoot}/`;
  const canonical = canonicalPath(path, platform);
  return canonical.startsWith(prefix) ? canonical.slice(prefix.length) : null;
}

function abbreviateHome(path: string, home: string, platform: NodeJS.Platform): string {
  const relative = stripRoot(path, home, platform);
  return relative === null ? path : `~/${relative}`;
}

/**
 * Worktree threads report absolute paths under their own checkout, so strip the
 * thread's worktree first and the project root second. Paths outside both show
 * the home directory as "~".
 */
export function toWorkspaceRelativePath(
  path: string,
  roots: ReadonlyArray<string | null>,
  home: string,
  options?: RepositoryPathOptions,
): string {
  const platform = hostPlatform(options);
  const relative = roots.reduce<string | null>(
    (found, root) => found ?? (root === null ? null : stripRoot(path, root, platform)),
    null,
  );
  return (relative ?? abbreviateHome(path, home, platform)).replace(/^(\.\/)+/, "");
}

/** Resolves `.` and `..` segments; null when the path climbs above its base. */
function collapseSegments(path: string): string | null {
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.pop() === undefined) return null;
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

/**
 * Workspace-relative form of a path, or null when it lies outside every root.
 * A relative path starts at `options.base` (a workspace-relative directory), else at the root.
 */
export function relativeToWorkspace(
  path: string,
  roots: ReadonlyArray<string>,
  options?: RepositoryPathOptions & { readonly base?: string | null | undefined },
): string | null {
  const platform = hostPlatform(options);
  const base = options?.base ?? null;
  const normalized = normalizeSeparators(path.trim());
  if (normalized === "" || normalized.startsWith("~")) return null;
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    for (const root of roots) {
      const relative = stripRoot(normalized, root, platform);
      if (relative !== null) return collapseSegments(relative);
    }
    return null;
  }
  return collapseSegments(base === null ? normalized : `${base}/${normalized}`);
}

/** Longest repository path that is a prefix (on a segment boundary) of the relative path. */
export function repositoryOfPath(
  relativePath: string,
  repositories: ReadonlyArray<string>,
): string | null {
  let best: string | null = null;
  for (const repository of repositories) {
    const matches = relativePath === repository || relativePath.startsWith(`${repository}/`);
    if (matches && (best === null || repository.length > best.length)) best = repository;
  }
  return best;
}

const CD_TARGET =
  /(?:^|[\s;&|(])(cd|pushd|git\s+-C)\s+(?:--\s+)?(?:"([^"]+)"|'([^']+)'|([^\s;&|()"']+))/g;

const QUOTED_STRING = /"(?:[^"\\]|\\.)*"|'[^']*'/g;
const MESSAGE_ARGUMENT = new RegExp(
  `((?:--message(?:=|\\s+)|-[A-Za-z]*m(?:=|\\s+))|\\b(?:echo|printf)(?:\\s+-\\w+)*\\s+)(?:${QUOTED_STRING.source})`,
  "g",
);
const PATH_TERMINATOR = /[\s"'`;&|),:=>]/;

/** Blanks the quoted text of `git commit -m` and `echo` arguments, which is prose, not paths. */
function withoutQuotedMessages(command: string): string {
  return command.replace(MESSAGE_ARGUMENT, (_match, lead: string) => `${lead}""`);
}

/**
 * Repositories a shell command reaches: absolute paths under a root, plus the
 * targets of `cd`, `pushd` and `git -C`. A relative `cd` continues from the
 * directory an earlier `cd` in the same command reached, else the root.
 */
export function repositoriesInCommand(
  command: string,
  roots: ReadonlyArray<string>,
  repositories: ReadonlyArray<string>,
  options?: RepositoryPathOptions,
): ReadonlyArray<string> {
  const platform = hostPlatform(options);
  const found = new Set<string>();
  const text = withoutQuotedMessages(normalizeSeparators(command));
  for (const root of roots) {
    const canonicalRoot = canonicalPath(root, platform).replace(/\/$/, "");
    for (const repository of repositories) {
      const needle = `${canonicalRoot}/${repository}`;
      for (const variant of new Set(
        platform === "darwin" ? [needle, `/private${needle}`] : [needle],
      )) {
        let from = 0;
        for (;;) {
          const index = text.indexOf(variant, from);
          if (index < 0) break;
          const before = text[index - 1];
          const next = text[index + variant.length];
          const startsPath = before === undefined || PATH_TERMINATOR.test(before);
          if (startsPath && (next === undefined || next === "/" || PATH_TERMINATOR.test(next))) {
            found.add(repository);
          }
          from = index + variant.length;
        }
      }
    }
  }
  let directory: string | null = null;
  let outside = false;
  for (const match of text.matchAll(CD_TARGET)) {
    const target = match[2] ?? match[3] ?? match[4];
    if (target === undefined) continue;
    const changesDirectory = match[1] !== undefined && !match[1].startsWith("git");
    const isAbsolute = target.startsWith("/") || /^[A-Za-z]:\//.test(target);
    const relative: string | null =
      outside && !isAbsolute
        ? null
        : relativeToWorkspace(target, roots, { platform, base: isAbsolute ? null : directory });
    const repository = relative === null ? null : repositoryOfPath(relative, repositories);
    if (repository !== null) found.add(repository);
    if (changesDirectory) {
      directory = relative;
      outside = relative === null;
    }
  }
  return [...found];
}
