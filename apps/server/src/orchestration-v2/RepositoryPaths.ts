function normalizeSeparators(path: string): string {
  return path.replaceAll("\\", "/");
}

/** macOS reports /var/... and /private/var/... for the same directory. */
function canonicalPath(path: string): string {
  return normalizeSeparators(path).replace(/^\/private(?=\/)/, "");
}

function stripRoot(path: string, root: string): string | null {
  const canonicalRoot = canonicalPath(root);
  const prefix = canonicalRoot.endsWith("/") ? canonicalRoot : `${canonicalRoot}/`;
  const canonical = canonicalPath(path);
  return canonical.startsWith(prefix) ? canonical.slice(prefix.length) : null;
}

function abbreviateHome(path: string, home: string): string {
  const relative = stripRoot(path, home);
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
): string {
  const relative = roots.reduce<string | null>(
    (found, root) => found ?? (root === null ? null : stripRoot(path, root)),
    null,
  );
  return (relative ?? abbreviateHome(path, home)).replace(/^(\.\/)+/, "");
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
 * A relative path is taken to start at the workspace root.
 */
export function relativeToWorkspace(path: string, roots: ReadonlyArray<string>): string | null {
  const normalized = normalizeSeparators(path.trim());
  if (normalized === "" || normalized.startsWith("~")) return null;
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    for (const root of roots) {
      const relative = stripRoot(normalized, root);
      if (relative !== null) return collapseSegments(relative);
    }
    return null;
  }
  return collapseSegments(normalized);
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
  /(?:^|[\s;&|(])(?:cd|pushd|git\s+-C)\s+(?:--\s+)?(?:"([^"]+)"|'([^']+)'|([^\s;&|()"']+))/g;

/**
 * Repositories a shell command reaches: absolute paths under a root, plus the
 * targets of `cd`, `pushd` and `git -C` (absolute, or relative to the root).
 */
export function repositoriesInCommand(
  command: string,
  roots: ReadonlyArray<string>,
  repositories: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const found = new Set<string>();
  const text = normalizeSeparators(command);
  for (const root of roots) {
    const canonicalRoot = canonicalPath(root).replace(/\/$/, "");
    for (const repository of repositories) {
      const needle = `${canonicalRoot}/${repository}`;
      for (const variant of new Set([needle, `/private${needle}`])) {
        let from = 0;
        for (;;) {
          const index = text.indexOf(variant, from);
          if (index < 0) break;
          const next = text[index + variant.length];
          if (next === undefined || next === "/" || /[\s"'`;&|)]/.test(next)) found.add(repository);
          from = index + variant.length;
        }
      }
    }
  }
  for (const match of text.matchAll(CD_TARGET)) {
    const target = match[1] ?? match[2] ?? match[3];
    if (target === undefined) continue;
    const relative = relativeToWorkspace(target, roots);
    const repository = relative === null ? null : repositoryOfPath(relative, repositories);
    if (repository !== null) found.add(repository);
  }
  return [...found];
}
