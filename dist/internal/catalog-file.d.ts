/**
 * The shape of `catalog.json`: the learner's user catalog (overrides and
 * custom topics) plus optional scoring overrides, with a pure parser and a
 * serializer that round-trip each other.
 */
import type { CatalogOverride, UserCatalog } from "./catalog.js";
import type { CatalogEntry, Parsed } from "./schema.js";
import { type ScoringConfig } from "./scoring-config.js";
/**
 * The parsed content of `catalog.json`.
 *
 * @example
 * ```ts
 * import { EMPTY_CATALOG_FILE, type CatalogFile } from "./catalog-file.js";
 * const file: CatalogFile = EMPTY_CATALOG_FILE;
 * ```
 */
export interface CatalogFile {
    /** Overrides keyed by topic id and custom topics. */
    readonly user: UserCatalog;
    /** Scoring overrides; `{}` when none are configured. */
    readonly scoring: ScoringConfig;
}
/**
 * The catalog file used when `catalog.json` does not exist: no overrides, no
 * custom topics, no scoring overrides. Frozen at every level.
 *
 * @example
 * ```ts
 * import { EMPTY_CATALOG_FILE } from "./catalog-file.js";
 * EMPTY_CATALOG_FILE.user.custom.length; // 0
 * ```
 */
export declare const EMPTY_CATALOG_FILE: CatalogFile;
/**
 * The JSON-ready form of a {@link CatalogFile}, as written to
 * `catalog.json`.
 */
interface SerializedCatalogFile {
    readonly overrides: Readonly<Record<string, CatalogOverride>>;
    readonly custom: readonly CatalogEntry[];
    readonly scoring?: ScoringConfig;
}
/**
 * Validates the content of `catalog.json`. `scoring` is read once as an own
 * property and parsed with {@link parseScoringConfig} (absent means `{}`);
 * the same object is parsed with {@link parseUserCatalog}, which ignores the
 * `scoring` key. The result is built fresh.
 *
 * @param value - Untrusted input, typically JSON-parsed `catalog.json`.
 * @returns A fresh {@link CatalogFile}, or a reason that does not echo input.
 *
 * @example
 * ```ts
 * import { parseCatalogFile } from "./catalog-file.js";
 * const r = parseCatalogFile({ scoring: { halfLifeDays: 30 } });
 * if (r.ok) r.value.scoring; // { halfLifeDays: 30 }
 * ```
 */
export declare function parseCatalogFile(value: unknown): Parsed<CatalogFile>;
/**
 * Converts a {@link CatalogFile} into the plain object written to
 * `catalog.json`: `overrides`, `custom`, and `scoring` only when it has at
 * least one key. `parseCatalogFile(serializeCatalogFile(x))` equals `x`.
 *
 * @param file - A catalog file, normally from {@link parseCatalogFile}.
 * @returns A JSON-ready object; it shares structure with `file`.
 *
 * @example
 * ```ts
 * import { EMPTY_CATALOG_FILE, serializeCatalogFile } from "./catalog-file.js";
 * serializeCatalogFile(EMPTY_CATALOG_FILE); // { overrides: {}, custom: [] }
 * ```
 */
export declare function serializeCatalogFile(file: CatalogFile): SerializedCatalogFile;
export {};
//# sourceMappingURL=catalog-file.d.ts.map