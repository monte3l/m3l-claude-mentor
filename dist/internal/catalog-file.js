/**
 * The shape of `catalog.json`: the learner's user catalog (overrides and
 * custom topics) plus optional scoring overrides, with a pure parser and a
 * serializer that round-trip each other.
 */
import { parseUserCatalog } from "./catalog.js";
import { parseScoringConfig } from "./scoring-config.js";
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
export const EMPTY_CATALOG_FILE = Object.freeze({
    user: Object.freeze({
        overrides: Object.freeze({}),
        custom: Object.freeze([]),
    }),
    scoring: Object.freeze({}),
});
function asRecord(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return null;
    }
    return value;
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
export function parseCatalogFile(value) {
    const record = asRecord(value);
    if (record === null) {
        return { ok: false, reason: "catalog file must be an object" };
    }
    let scoring = {};
    if (Object.hasOwn(record, "scoring")) {
        const parsed = parseScoringConfig(record["scoring"]);
        if (!parsed.ok) {
            return { ok: false, reason: `catalog scoring: ${parsed.reason}` };
        }
        scoring = parsed.value;
    }
    const user = parseUserCatalog(record);
    if (!user.ok)
        return { ok: false, reason: user.reason };
    return { ok: true, value: { user: user.value, scoring } };
}
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
export function serializeCatalogFile(file) {
    const user = file.user;
    const scoring = file.scoring;
    return {
        overrides: user.overrides,
        custom: user.custom,
        ...(Object.keys(scoring).length > 0 ? { scoring } : {}),
    };
}
//# sourceMappingURL=catalog-file.js.map