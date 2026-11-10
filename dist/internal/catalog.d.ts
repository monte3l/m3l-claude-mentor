/**
 * The topic catalog: parsing the bundled catalog and the learner's user
 * catalog, merging the two, and matching free text against topic keywords.
 *
 * Every function here is pure: no I/O, no mutation of its inputs.
 */
import { type CatalogEntry, type Level, type Parsed, type Style } from "./schema.js";
/**
 * A learner's adjustments to one catalog topic. Every field is optional and
 * replaces the entry's value when present.
 *
 * @example
 * ```ts
 * import type { CatalogOverride } from "./catalog.js";
 * const o: CatalogOverride = { enabled: false };
 * ```
 */
export interface CatalogOverride {
    readonly enabled?: boolean;
    readonly targetLevel?: Level;
    readonly style?: Style;
    /** Replaces the entry's keywords; same rules as catalog keywords. */
    readonly keywords?: readonly string[];
}
/**
 * The learner's catalog customizations: overrides keyed by topic id, and
 * custom topics appended after the bundled ones.
 *
 * @example
 * ```ts
 * import { parseUserCatalog, type UserCatalog } from "./catalog.js";
 * const r = parseUserCatalog({ overrides: { "plan-mode": { enabled: false } } });
 * const user: UserCatalog | undefined = r.ok ? r.value : undefined;
 * ```
 */
export interface UserCatalog {
    readonly overrides: Readonly<Record<string, CatalogOverride>>;
    readonly custom: readonly CatalogEntry[];
}
/**
 * Validates a whole catalog: an array of at most 500 entries, each valid per
 * {@link parseCatalogEntry}, with unique ids, known dependencies and no
 * dependency cycle. Failure reasons name the offending entry by zero-based
 * index. The result preserves input order.
 *
 * @param value - Untrusted input, typically parsed JSON.
 * @returns The entries, or a reason that does not echo the input.
 *
 * @example
 * ```ts
 * import { parseCatalog } from "./catalog.js";
 * const r = parseCatalog(JSON.parse(text) as unknown);
 * if (!r.ok) console.error(r.reason);
 * ```
 */
export declare function parseCatalog(value: unknown): Parsed<readonly CatalogEntry[]>;
/**
 * Validates the learner's user catalog. `overrides` and `custom` are both
 * optional (missing means `{}` and `[]`) but fail when present with the wrong
 * type. Override keys must be topic ids; unknown
 * keys inside an override are ignored. Custom entries are validated one by
 * one; cross-entry checks happen in {@link mergeCatalog}.
 *
 * @param value - Untrusted input, typically parsed JSON.
 * @returns A fresh {@link UserCatalog}, or a reason that does not echo input.
 *
 * @example
 * ```ts
 * import { parseUserCatalog } from "./catalog.js";
 * const r = parseUserCatalog({
 *   overrides: { "plan-mode": { targetLevel: "Fluent" } },
 *   custom: [],
 * });
 * r.ok; // true
 * ```
 */
export declare function parseUserCatalog(value: unknown): Parsed<UserCatalog>;
/**
 * Merges the bundled catalog with the learner's user catalog: bundled
 * entries in order with overrides applied, then custom entries in order
 * (overrides may also target a custom entry). Inputs are not mutated.
 *
 * Fails when an override names an unknown id, a custom id equals a bundled
 * id, or the merged list breaks a {@link parseCatalog} invariant (size cap,
 * duplicate ids, unknown dependency, cycle). Disabling a topic that another
 * enabled topic depends on is allowed.
 *
 * @example
 * ```ts
 * import { mergeCatalog, parseCatalog, parseUserCatalog } from "./catalog.js";
 * const bundled = parseCatalog(bundledJson);
 * const user = parseUserCatalog(userJson);
 * if (bundled.ok && user.ok) {
 *   const merged = mergeCatalog(bundled.value, user.value);
 * }
 * ```
 */
export declare function mergeCatalog(bundled: readonly CatalogEntry[], user: UserCatalog): Parsed<readonly CatalogEntry[]>;
/**
 * Finds the enabled topics whose keywords occur in `text`, best first.
 *
 * Matching is case-insensitive and literal; a keyword must be bounded on both
 * sides by a character that is not a Unicode letter or digit (`_` counts as a
 * boundary) or the string edge, so `plan` matches "a plan." but not
 * "explanation" or "planéte". A keyword starting with `/` (a slash command)
 * has a stricter opening boundary: the `/` must start the text or follow
 * whitespace or one of `( [ { ' "` or a backtick, so `/init` matches "use
 * /init" but not "./init", "~/init" or "src/init"; its closing boundary is
 * the usual one. Boundaries are tested one UTF-16 code unit at a time, so
 * astral-plane letters (outside the BMP) are treated as boundaries. Each
 * entry scores its count of DISTINCT matching keywords; zero scorers are
 * excluded, ties keep catalog order. Only the first 20000 chars of `text` are
 * examined: the cut may split a word, and lowercasing can make the scanned
 * text marginally longer than the cap.
 *
 * @param catalog - Validated entries, e.g. from {@link mergeCatalog}.
 * @param text - Free text to scan.
 * @param limit - Maximum results (default 3); below 1 returns `[]`.
 *
 * @example
 * ```ts
 * import { matchTopics } from "./catalog.js";
 * const hits = matchTopics(catalog, "How do I enter plan mode?");
 * hits.map((e) => e.id); // e.g. ["plan-mode"]
 * ```
 */
export declare function matchTopics(catalog: readonly CatalogEntry[], text: string, limit?: number): readonly CatalogEntry[];
//# sourceMappingURL=catalog.d.ts.map