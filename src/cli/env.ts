import { mergeCatalog } from "../internal/catalog.ts";
import type { CatalogFile } from "../internal/catalog-file.ts";
import { MentorStateError } from "../internal/errors.ts";
import {
  CLI_LOCK_TIMEOUT_MS,
  withStateLock,
  type LockOptions,
} from "../internal/lock.ts";
import type { CatalogEntry, SessionId, TopicId } from "../internal/schema.ts";
import { loadCatalogFile } from "../internal/store.ts";
import { CliUsageError } from "./args.ts";

/**
 * The validated context every command handler receives.
 *
 * @example
 * ```ts
 * import type { CommandEnv } from "./env.ts";
 * const env: CommandEnv = { dir, now: Date.now(), session, bundled: [] };
 * ```
 */
export interface CommandEnv {
  readonly dir: string;
  readonly now: number;
  readonly session: SessionId;
  readonly bundled: readonly CatalogEntry[];
  /**
   * Lock tuning over the CLI defaults (a test seam); real callers leave it
   * out. See {@link lockedState}.
   */
  readonly lock?: LockOptions;
}

/**
 * The lock options a CLI command uses: {@link CLI_LOCK_TIMEOUT_MS} (longer
 * than the stale threshold, so a crashed holder's lock is outlived and
 * broken) overridden by `env.lock`.
 *
 * @example
 * ```ts
 * import { cliLockOptions } from "./env.ts";
 * await importBundleFromFile(env.dir, from, { replace: true }, { lock: cliLockOptions(env) });
 * ```
 */
export function cliLockOptions(env: CommandEnv): LockOptions {
  return { timeoutMs: CLI_LOCK_TIMEOUT_MS, ...env.lock };
}

/**
 * Runs `fn` under the data lock for `env.dir` (`withStateLock` in
 * `../internal/lock.ts`) with {@link cliLockOptions}. Every CLI writer wraps
 * its whole load-compute-save in this; validation and pure work stay
 * outside, and read-only commands never call it. The store primitives never
 * lock, so `fn` may call them freely, but must not call this again.
 *
 * @throws MentorStateError `LOCK_TIMEOUT` when the lock stays held, or
 * `WRITE_FAILED` when it cannot be created; whatever `fn` throws, unchanged.
 *
 * @example
 * ```ts
 * import { lockedState } from "./env.ts";
 * await lockedState(env, async () => {
 *   await saveState(env.dir, { ...(await loadState(env.dir, env.now)), muted: true });
 * });
 * ```
 */
export function lockedState<T>(
  env: CommandEnv,
  fn: () => Promise<T>,
): Promise<T> {
  return withStateLock(env.dir, fn, cliLockOptions(env));
}

/**
 * The merged catalog plus the user's `catalog.json` it was built from, and
 * the ids of custom topics dropped because a bundled topic uses that id.
 *
 * @example
 * ```ts
 * import { loadMergedCatalog, type LoadedCatalog } from "./env.ts";
 * const loaded: LoadedCatalog = await loadMergedCatalog(env);
 * ```
 */
export interface LoadedCatalog {
  readonly file: CatalogFile;
  readonly entries: readonly CatalogEntry[];
  /** Sorted ids of custom entries shadowed by a bundled id; may be empty. */
  readonly shadowedCustom: readonly string[];
}

/**
 * Loads `catalog.json` and merges it over the bundled catalog.
 *
 * @throws MentorStateError from {@link loadCatalogFile}, or
 * `VALIDATION_FAILED` when the user catalog does not merge with the bundled
 * one (a fixed message; the merge reason is not surfaced).
 *
 * @example
 * ```ts
 * import { loadMergedCatalog } from "./env.ts";
 * const { entries, file } = await loadMergedCatalog(env);
 * ```
 */
export async function loadMergedCatalog(
  env: CommandEnv,
): Promise<LoadedCatalog> {
  const file = await loadCatalogFile(env.dir);
  const merged = mergeCatalog(env.bundled, file.user);
  if (!merged.ok) {
    throw new MentorStateError(
      "VALIDATION_FAILED",
      "catalog.json does not merge with the bundled topic catalog",
    );
  }
  return {
    file,
    entries: merged.value.entries,
    shadowedCustom: merged.value.shadowedCustom,
  };
}

/**
 * The catalog entry for `topic`.
 *
 * @throws CliUsageError when `topic` is not in `entries`.
 *
 * @example
 * ```ts
 * import { requireCatalogEntry } from "./env.ts";
 * const entry = requireCatalogEntry(entries, topic);
 * ```
 */
export function requireCatalogEntry(
  entries: readonly CatalogEntry[],
  topic: TopicId,
): CatalogEntry {
  const entry = entries.find((candidate) => candidate.id === topic);
  if (entry === undefined) throw new CliUsageError();
  return entry;
}
