/**
 * The topic catalog: parsing the bundled catalog and the learner's user
 * catalog, merging the two, and matching free text against topic keywords.
 *
 * Every function here is pure: no I/O, no mutation of its inputs.
 */
import { LEVELS, STYLES, parseCatalogEntry, parseKeywords, parseTopicId, } from "./schema.js";
/** Ceiling on catalog size; also bounds every loop over caller structure. */
const MAX_ENTRIES = 500;
/** Bounds matching cost on arbitrarily long prompts; topics surface early. */
const MAX_MATCH_TEXT_LENGTH = 20_000;
/** Few enough suggestions to stay focused without crowding the session. */
const DEFAULT_MATCH_LIMIT = 3;
function ok(value) {
    return { ok: true, value };
}
function fail(reason) {
    return { ok: false, reason };
}
function asRecord(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return null;
    }
    return value;
}
/**
 * Checks the cross-entry invariants of a catalog: unique ids, every
 * dependency known, no dependency cycle. Cycle detection is Kahn's
 * algorithm, iterative, so it cannot overflow the stack.
 *
 * @returns `null` when valid, otherwise a reason naming a zero-based index.
 */
function graphProblem(entries) {
    const indexById = new Map();
    for (const [i, entry] of entries.entries()) {
        if (indexById.has(entry.id)) {
            return `entry ${String(i)} duplicates an earlier id`;
        }
        indexById.set(entry.id, i);
    }
    const dependents = entries.map(() => []);
    const pending = entries.map((e) => e.dependencies.length);
    for (const [i, entry] of entries.entries()) {
        for (const dep of entry.dependencies) {
            const target = indexById.get(dep);
            if (target === undefined) {
                return `entry ${String(i)} depends on an unknown topic`;
            }
            dependents[target]?.push(i);
        }
    }
    const ready = [];
    for (const [i, count] of pending.entries()) {
        if (count === 0)
            ready.push(i);
    }
    let resolved = 0;
    for (let next = ready.pop(); next !== undefined; next = ready.pop()) {
        resolved += 1;
        for (const dependent of dependents[next] ?? []) {
            const left = (pending[dependent] ?? 0) - 1;
            pending[dependent] = left;
            if (left === 0)
                ready.push(dependent);
        }
    }
    return resolved === entries.length ? null : "catalog has a dependency cycle";
}
function parseEntries(value, field) {
    if (!Array.isArray(value))
        return fail(`${field} must be an array`);
    const items = value;
    const length = items.length;
    if (length > MAX_ENTRIES) {
        return fail(`${field} may hold at most ${String(MAX_ENTRIES)} entries`);
    }
    const entries = [];
    for (let i = 0; i < length; i++) {
        const entry = parseCatalogEntry(items[i]);
        if (!entry.ok) {
            return fail(`${field} entry ${String(i)} is invalid: ${entry.reason}`);
        }
        entries.push(entry.value);
    }
    return ok(entries);
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
export function parseCatalog(value) {
    const entries = parseEntries(value, "catalog");
    if (!entries.ok)
        return entries;
    const problem = graphProblem(entries.value);
    return problem === null ? entries : fail(problem);
}
function parseOverride(value) {
    const record = asRecord(value);
    if (record === null)
        return fail("must be an object");
    const hasEnabled = Object.hasOwn(record, "enabled");
    const enabled = hasEnabled ? record["enabled"] : undefined;
    if (hasEnabled && typeof enabled !== "boolean") {
        return fail("enabled must be a boolean");
    }
    const hasLevel = Object.hasOwn(record, "targetLevel");
    const targetLevel = hasLevel ? record["targetLevel"] : undefined;
    if (hasLevel && !LEVELS.includes(targetLevel)) {
        return fail("targetLevel is invalid");
    }
    const hasStyle = Object.hasOwn(record, "style");
    const style = hasStyle ? record["style"] : undefined;
    if (hasStyle && !STYLES.includes(style)) {
        return fail("style is invalid");
    }
    let keywords;
    if (Object.hasOwn(record, "keywords")) {
        const parsed = parseKeywords(record["keywords"], "keywords");
        if (!parsed.ok)
            return parsed;
        keywords = parsed.value;
    }
    return ok({
        ...(typeof enabled === "boolean" ? { enabled } : {}),
        ...(hasLevel ? { targetLevel: targetLevel } : {}),
        ...(hasStyle ? { style: style } : {}),
        ...(keywords !== undefined ? { keywords } : {}),
    });
}
function parseOverrides(value) {
    const record = asRecord(value);
    if (record === null)
        return fail("overrides must be an object");
    const keys = Object.keys(record);
    if (keys.length > MAX_ENTRIES) {
        return fail(`overrides may hold at most ${String(MAX_ENTRIES)} topics`);
    }
    const parsed = new Map();
    for (const key of keys) {
        const id = parseTopicId(key);
        if (!id.ok)
            return fail(`overrides key is invalid: ${id.reason}`);
        const override = parseOverride(record[key]);
        if (!override.ok) {
            return fail(`override for a topic is invalid: ${override.reason}`);
        }
        parsed.set(id.value, override.value);
    }
    // Object.fromEntries defines own data properties, never invoking setters.
    return ok(Object.fromEntries(parsed));
}
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
export function parseUserCatalog(value) {
    const record = asRecord(value);
    if (record === null)
        return fail("user catalog must be an object");
    let overrides = {};
    if (Object.hasOwn(record, "overrides")) {
        const parsed = parseOverrides(record["overrides"]);
        if (!parsed.ok)
            return parsed;
        overrides = parsed.value;
    }
    let custom = [];
    if (Object.hasOwn(record, "custom")) {
        const parsed = parseEntries(record["custom"], "custom");
        if (!parsed.ok)
            return parsed;
        custom = parsed.value;
    }
    return ok({ overrides, custom });
}
function applyOverride(entry, override) {
    if (override === undefined)
        return entry;
    return {
        ...entry,
        ...(override.enabled !== undefined ? { enabled: override.enabled } : {}),
        ...(override.targetLevel !== undefined
            ? { targetLevel: override.targetLevel }
            : {}),
        ...(override.style !== undefined ? { style: override.style } : {}),
        ...(override.keywords !== undefined ? { keywords: override.keywords } : {}),
    };
}
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
export function mergeCatalog(bundled, user) {
    const bundledIds = new Set(bundled.map((e) => e.id));
    const customIds = new Set();
    for (const [i, entry] of user.custom.entries()) {
        if (bundledIds.has(entry.id)) {
            return fail(`custom entry ${String(i)} reuses a bundled id`);
        }
        if (customIds.has(entry.id)) {
            return fail(`custom entry ${String(i)} duplicates an earlier custom id`);
        }
        customIds.add(entry.id);
    }
    const combined = [...bundled, ...user.custom];
    if (combined.length > MAX_ENTRIES) {
        return fail(`catalog may hold at most ${String(MAX_ENTRIES)} entries`);
    }
    const knownIds = new Set(combined.map((e) => e.id));
    for (const key of Object.keys(user.overrides)) {
        if (!knownIds.has(key))
            return fail("an override names an unknown topic");
    }
    const merged = combined.map((entry) => applyOverride(entry, Object.hasOwn(user.overrides, entry.id)
        ? user.overrides[entry.id]
        : undefined));
    const problem = graphProblem(merged);
    return problem === null ? ok(merged) : fail(problem);
}
const WORD_CHAR = /^[\p{L}\p{N}]$/u;
/** Whether one UTF-16 code unit is a letter or digit (BMP only). */
function isWordChar(char) {
    return char !== undefined && WORD_CHAR.test(char);
}
/** Whether `keyword` occurs in `text` bounded by non-word chars or edges. */
function containsWord(text, keyword) {
    for (let at = text.indexOf(keyword); at !== -1; at = text.indexOf(keyword, at + 1)) {
        if (!isWordChar(text[at - 1]) && !isWordChar(text[at + keyword.length])) {
            return true;
        }
    }
    return false;
}
/**
 * Finds the enabled topics whose keywords occur in `text`, best first.
 *
 * Matching is case-insensitive and literal; a keyword must be bounded on both
 * sides by a character that is not a Unicode letter or digit (`_` counts as a
 * boundary) or the string edge, so `plan` matches "a plan." but not
 * "explanation" or "planéte". Boundaries are tested one UTF-16 code unit at a
 * time, so astral-plane letters (outside the BMP) are treated as boundaries.
 * Each entry scores its count of DISTINCT matching keywords; zero scorers are
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
export function matchTopics(catalog, text, limit = DEFAULT_MATCH_LIMIT) {
    const max = Math.floor(limit);
    if (!(max >= 1))
        return [];
    const haystack = text.slice(0, MAX_MATCH_TEXT_LENGTH).toLowerCase();
    const scored = [];
    for (const entry of catalog) {
        if (!entry.enabled)
            continue;
        let score = 0;
        for (const keyword of new Set(entry.keywords)) {
            if (containsWord(haystack, keyword))
                score += 1;
        }
        if (score > 0)
            scored.push({ entry, score });
    }
    // Array.prototype.sort is stable, so equal scores keep catalog order.
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, max).map((s) => s.entry);
}
//# sourceMappingURL=catalog.js.map