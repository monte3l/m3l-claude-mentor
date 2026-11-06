import type { CatalogEntry } from "./schema.js";
/**
 * Loads and validates the bundled topic catalog. By default it reads
 * `data/topic-catalog.json`, located relative to this module so it resolves
 * from both `src/internal/` and `dist/internal/` (the plugin keeps `data/`
 * next to `dist/`). Nothing is cached: each call reads the file again and
 * returns a fresh array.
 *
 * @param source - A `file:` URL of the catalog to read; defaults to the
 * bundled `data/topic-catalog.json`.
 * @returns The validated catalog entries.
 * @throws MentorStateError `READ_FAILED` (fs error as `cause`) when the file
 * cannot be read; `TOO_LARGE` when it exceeds 1 MiB; `PARSE_FAILED` (fixed
 * message, no `cause`) when it is not JSON; `VALIDATION_FAILED` (with the
 * parser's reason) when the catalog is invalid.
 *
 * @example
 * ```ts
 * import { loadBundledCatalog } from "./bundled-catalog.js";
 * const catalog = await loadBundledCatalog();
 * const enabled = catalog.filter((entry) => entry.enabled);
 * ```
 */
export declare function loadBundledCatalog(source?: URL): Promise<readonly CatalogEntry[]>;
//# sourceMappingURL=bundled-catalog.d.ts.map