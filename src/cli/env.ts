import { mergeCatalog } from "../internal/catalog.js";
import type { CatalogFile } from "../internal/catalog-file.js";
import { MentorStateError } from "../internal/errors.js";
import type { CatalogEntry, SessionId, TopicId } from "../internal/schema.js";
import { loadCatalogFile } from "../internal/store.js";
import { CliUsageError } from "./args.js";

/**
 * The validated context every command handler receives.
 *
 * @example
 * ```ts
 * import type { CommandEnv } from "./env.js";
 * const env: CommandEnv = { dir, now: Date.now(), session, bundled: [] };
 * ```
 */
export interface CommandEnv {
  readonly dir: string;
  readonly now: number;
  readonly session: SessionId;
  readonly bundled: readonly CatalogEntry[];
}

/**
 * The merged catalog plus the user's `catalog.json` it was built from.
 *
 * @example
 * ```ts
 * import { loadMergedCatalog, type LoadedCatalog } from "./env.js";
 * const loaded: LoadedCatalog = await loadMergedCatalog(env);
 * ```
 */
export interface LoadedCatalog {
  readonly file: CatalogFile;
  readonly entries: readonly CatalogEntry[];
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
 * import { loadMergedCatalog } from "./env.js";
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
  return { file, entries: merged.value };
}

/**
 * The catalog entry for `topic`.
 *
 * @throws CliUsageError when `topic` is not in `entries`.
 *
 * @example
 * ```ts
 * import { requireCatalogEntry } from "./env.js";
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
