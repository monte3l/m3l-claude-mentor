import { mergeCatalog } from "../internal/catalog.js";
import { MentorStateError } from "../internal/errors.js";
import { loadCatalogFile } from "../internal/store.js";
import { CliUsageError } from "./args.js";
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
export async function loadMergedCatalog(env) {
    const file = await loadCatalogFile(env.dir);
    const merged = mergeCatalog(env.bundled, file.user);
    if (!merged.ok) {
        throw new MentorStateError("VALIDATION_FAILED", "catalog.json does not merge with the bundled topic catalog");
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
export function requireCatalogEntry(entries, topic) {
    const entry = entries.find((candidate) => candidate.id === topic);
    if (entry === undefined)
        throw new CliUsageError();
    return entry;
}
//# sourceMappingURL=env.js.map