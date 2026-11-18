/**
 * Matching a working directory against the learner's excluded projects.
 * Paths are compared both lexically and after resolving symlinks, so a
 * project reached through a link is still excluded. Nothing here throws.
 *
 * Resolution uses a synchronous `realpath`: an entry under a hung network
 * mount can block until the hook times out, which fails safe (nothing is
 * recorded).
 */

import { realpathSync } from "node:fs";
import path from "node:path";

/**
 * Injectable environment for {@link canonicalProject},
 * {@link isProjectExcluded} and {@link foldProjectCase}.
 *
 * @example
 * ```ts
 * import type { ProjectPathOptions } from "./project-exclusion.ts";
 * const options: ProjectPathOptions = { platform: "linux" };
 * ```
 */
export interface ProjectPathOptions {
  /** Decides case folding: `darwin` and `win32` compare case-insensitively. */
  readonly platform?: NodeJS.Platform;
  /** Resolves symlinks; may throw. Defaults to `fs.realpathSync.native`. */
  readonly realpath?: (p: string) => string;
}

/** The default symlink resolver, bound so `this` never matters. */
function nativeRealpath(p: string): string {
  return realpathSync.native(p);
}

/**
 * `path.normalize` without a trailing separator, except for a root (`/`,
 * `C:\`), which keeps it.
 *
 * @example
 * ```ts
 * import { normalizeProjectPath } from "./project-exclusion.ts";
 * normalizeProjectPath("/a/x/../b/"); // "/a/b"
 * ```
 */
export function normalizeProjectPath(dir: string): string {
  const normalized = path.normalize(dir);
  if (
    normalized.endsWith(path.sep) &&
    normalized !== path.parse(normalized).root
  ) {
    return normalized.slice(0, -path.sep.length);
  }
  return normalized;
}

/**
 * The key under which two project paths compare equal: lower-cased on
 * `darwin` and `win32` (whose default file systems are case-insensitive),
 * unchanged elsewhere. Known limit: on Linux a case-insensitive mount (ext4
 * casefold, vfat) still compares case-sensitively.
 *
 * @param p - A project path, already normalised.
 * @param platform - Defaults to `process.platform`.
 *
 * @example
 * ```ts
 * import { foldProjectCase } from "./project-exclusion.ts";
 * foldProjectCase("/Users/Me", "darwin"); // "/users/me"
 * foldProjectCase("/Users/Me", "linux"); // "/Users/Me"
 * ```
 */
export function foldProjectCase(
  p: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "darwin" || platform === "win32" ? p.toLowerCase() : p;
}

/** `realpath(p)`, or `null` when it throws anything at all. */
function attemptRealpath(
  p: string,
  realpath: (p: string) => string,
): string | null {
  try {
    return realpath(p);
  } catch {
    // Deliberately lenient: a missing or unreadable path (or a resolver
    // throwing anything at all) is handled by the caller's fallback.
    return null;
  }
}

/**
 * The normalised real path of the absolute path `p`. When `p` itself cannot
 * be resolved (deleted, unreadable, a link loop, too long), its nearest
 * resolvable ancestor is resolved and the unresolved tail re-appended, so a
 * deleted directory under a symlinked project still maps into the project.
 * `null` when `p` is relative or no ancestor resolves. The ancestor walk only
 * runs after a failure.
 */
function resolveReal(
  p: string,
  realpath: (p: string) => string,
): string | null {
  if (!path.isAbsolute(p)) return null;
  let head = normalizeProjectPath(p);
  const tail: string[] = [];
  for (;;) {
    const real = attemptRealpath(head, realpath);
    if (real !== null) {
      return normalizeProjectPath(path.join(real, ...tail.toReversed()));
    }
    const parent = path.dirname(head);
    if (parent === head) return null;
    tail.push(path.basename(head));
    head = parent;
  }
}

/** Whether `target` is `base` or lies beneath it, on a separator boundary. */
function isWithin(base: string, target: string): boolean {
  if (target === base) return true;
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  return target.startsWith(prefix);
}

/**
 * The form in which an excluded project is stored: its real path (symlinks
 * resolved), normalised and without a trailing separator except for the
 * root. When the path itself cannot be resolved (it does not exist, a
 * permission error, a resolver that throws a non-`Error`), its nearest
 * resolvable ancestor is resolved and the rest re-appended; when nothing
 * resolves, or the path is relative, it falls back to the lexically
 * normalised path. Never throws and never changes letter case.
 *
 * @param project - An absolute path, as the learner gave it.
 * @param options - Optional `realpath` override (default
 *   `fs.realpathSync.native`).
 *
 * @example
 * ```ts
 * import { canonicalProject } from "./project-exclusion.ts";
 * canonicalProject("/tmp/link-to-proj/"); // e.g. "/private/tmp/proj"
 * ```
 */
export function canonicalProject(
  project: string,
  { realpath = nativeRealpath }: Pick<ProjectPathOptions, "realpath"> = {},
): string {
  return resolveReal(project, realpath) ?? normalizeProjectPath(project);
}

/**
 * Whether `cwd` is an excluded project or lies beneath one, with a separator
 * boundary (`/a/b` covers `/a/b/c` but not `/a/bc`). Each entry matches when
 * any pairing of forms does: lexical `cwd` against the lexical entry, real
 * `cwd` against the real entry, real `cwd` against the lexical entry, or
 * lexical `cwd` against the real entry. A real form comes from the nearest
 * resolvable ancestor when the path itself does not resolve, so a deleted
 * directory under a symlinked excluded project is still excluded; when
 * nothing resolves only the lexical form is used. A relative entry is
 * skipped: it is never resolved and never matches. Case folding follows
 * {@link foldProjectCase} (insensitive on `darwin` and `win32`; on Linux a
 * case-insensitive mount still compares case-sensitively, a known limit).
 * An empty list is `false` without touching the filesystem. Never throws.
 *
 * @param excludedProjects - The stored exclusion list.
 * @param cwd - The working directory to test, absolute.
 * @param options - Optional `platform` (default `process.platform`) and
 *   `realpath` (default `fs.realpathSync.native`) overrides.
 *
 * @example
 * ```ts
 * import { isProjectExcluded } from "./project-exclusion.ts";
 * isProjectExcluded(["/work/secret"], "/work/secret/src"); // true
 * isProjectExcluded(["/work/secret"], "/work/secrets"); // false
 * ```
 */
export function isProjectExcluded(
  excludedProjects: readonly string[],
  cwd: string,
  {
    platform = process.platform,
    realpath = nativeRealpath,
  }: ProjectPathOptions = {},
): boolean {
  if (excludedProjects.length === 0) return false;
  const forms = (p: string): readonly string[] => {
    const lexical = normalizeProjectPath(p);
    const real = resolveReal(p, realpath);
    return (real === null ? [lexical] : [lexical, real]).map((form) =>
      foldProjectCase(form, platform),
    );
  };

  const targets = forms(cwd);
  return excludedProjects.some((entry) => {
    if (!path.isAbsolute(entry)) return false;
    const bases = forms(entry);
    return bases.some((base) =>
      targets.some((target) => isWithin(base, target)),
    );
  });
}
