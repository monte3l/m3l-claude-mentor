import { mergeCatalog } from "../internal/catalog.ts";
import type { CatalogFile } from "../internal/catalog-file.ts";
import { MentorStateError } from "../internal/errors.ts";
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
}

/**
 * The merged catalog plus the user's `catalog.json` it was built from.
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
  return { file, entries: merged.value };
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
