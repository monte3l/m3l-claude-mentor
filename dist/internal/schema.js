/**
 * Core value types for the mentor state: mastery levels, evidence, topic ids
 * and catalog entries, each with a pure parser that validates untrusted input.
 *
 * Parsers never throw on plain data such as JSON-parsed values, and never
 * echo the raw input in a failure `reason`. They do not defend against exotic
 * objects: a throwing getter or a revoked Proxy may propagate its error.
 */
/**
 * Mastery levels, ordered from least to most mastery.
 *
 * @example
 * ```ts
 * import { LEVELS } from "./schema.js";
 * LEVELS[0]; // "Unseen"
 * ```
 */
export const LEVELS = [
    "Unseen",
    "Introduced",
    "Claimed",
    "Recalled",
    "Understood",
    "Applied",
    "Fluent",
];
/**
 * The channels through which evidence of mastery is gathered.
 *
 * @example
 * ```ts
 * import { CHANNELS } from "./schema.js";
 * CHANNELS.includes("quiz"); // true
 * ```
 */
export const CHANNELS = [
    "observed",
    "explain-back",
    "quiz",
    "self-report",
];
/**
 * The dimensions of mastery a topic can require.
 *
 * @example
 * ```ts
 * import { DIMENSIONS } from "./schema.js";
 * DIMENSIONS.length; // 3
 * ```
 */
export const DIMENSIONS = ["apply", "understand", "recall"];
/**
 * The kinds of topic in the catalog.
 *
 * @example
 * ```ts
 * import { TOPIC_TYPES } from "./schema.js";
 * TOPIC_TYPES.includes("feature"); // true
 * ```
 */
export const TOPIC_TYPES = [
    "terminology",
    "concept",
    "feature",
    "practice",
    "fast-moving",
];
/**
 * The teaching styles the mentor can use.
 *
 * @example
 * ```ts
 * import { STYLES } from "./schema.js";
 * STYLES[0]; // "socratic"
 * ```
 */
export const STYLES = [
    "socratic",
    "explain-demo",
    "recall-quiz",
    "reference",
];
const TOPIC_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_TOPIC_ID_LENGTH = 64;
const MAX_SESSION_ID_LENGTH = 128;
const MAX_TITLE_LENGTH = 120;
const MAX_KEYWORD_LENGTH = 40;
const MAX_KEYWORDS = 20;
function ok(value) {
    return { ok: true, value };
}
function fail(reason) {
    return { ok: false, reason };
}
/** A non-null, non-array object, viewed as a read-only record. */
function asRecord(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return null;
    }
    return value;
}
/**
 * Reads an own field exactly once. Returns `undefined` for a field that is
 * absent or only inherited, so callers treat "missing" uniformly.
 */
function ownField(record, key) {
    return Object.hasOwn(record, key) ? record[key] : undefined;
}
function isMember(set, value) {
    return (typeof value === "string" && set.includes(value));
}
/**
 * Validates a topic id: a string of 1 to 64 chars matching kebab-case
 * (`^[a-z0-9]+(-[a-z0-9]+)*$`).
 *
 * @param value - Untrusted input.
 * @returns The branded id, or a reason that does not echo the input.
 *
 * @example
 * ```ts
 * import { parseTopicId } from "./schema.js";
 * parseTopicId("context-window").ok; // true
 * parseTopicId("Context Window").ok; // false
 * ```
 */
export function parseTopicId(value) {
    if (typeof value !== "string")
        return fail("topic id must be a string");
    if (value.length === 0 || value.length > MAX_TOPIC_ID_LENGTH) {
        return fail("topic id must be 1 to 64 characters");
    }
    if (!TOPIC_ID_PATTERN.test(value)) {
        return fail("topic id must be lowercase kebab-case");
    }
    return ok(value);
}
/**
 * Validates a session id: a string of 1 to 128 chars of ASCII letters,
 * digits, `_` or `-`.
 *
 * @param value - Untrusted input.
 * @returns The branded id, or a reason that does not echo the input.
 *
 * @example
 * ```ts
 * import { parseSessionId } from "./schema.js";
 * parseSessionId("sess_1").ok; // true
 * parseSessionId("a b").ok; // false
 * ```
 */
export function parseSessionId(value) {
    if (typeof value !== "string")
        return fail("session id must be a string");
    if (value.length === 0 || value.length > MAX_SESSION_ID_LENGTH) {
        return fail("session id must be 1 to 128 characters");
    }
    if (!SESSION_ID_PATTERN.test(value)) {
        return fail("session id may contain only letters, digits, _ and -");
    }
    return ok(value);
}
/**
 * Validates one evidence record. Each field is read once from an own
 * property; extra keys are ignored and not copied.
 *
 * @param value - Untrusted input.
 * @returns A fresh {@link Evidence}, or a reason naming the bad field.
 *
 * @example
 * ```ts
 * import { parseEvidence } from "./schema.js";
 * const r = parseEvidence({
 *   channel: "quiz",
 *   topic: "plan-mode",
 *   result: "negative",
 *   at: 0,
 *   session: "sess_1",
 * });
 * r.ok; // true
 * ```
 */
export function parseEvidence(value) {
    const record = asRecord(value);
    if (record === null)
        return fail("evidence must be an object");
    const channel = ownField(record, "channel");
    if (!isMember(CHANNELS, channel))
        return fail("evidence channel is invalid");
    const topic = parseTopicId(ownField(record, "topic"));
    if (!topic.ok)
        return fail(`evidence topic is invalid: ${topic.reason}`);
    const result = ownField(record, "result");
    if (result !== "positive" && result !== "negative") {
        return fail("evidence result must be positive or negative");
    }
    const at = ownField(record, "at");
    if (typeof at !== "number" || !Number.isFinite(at) || at < 0) {
        return fail("evidence at must be a finite, non-negative number");
    }
    const session = parseSessionId(ownField(record, "session"));
    if (!session.ok) {
        return fail(`evidence session is invalid: ${session.reason}`);
    }
    return ok({
        channel,
        topic: topic.value,
        result,
        at,
        session: session.value,
    });
}
/**
 * The position of a level in {@link LEVELS} (0 for `Unseen`).
 *
 * @example
 * ```ts
 * import { levelRank } from "./schema.js";
 * levelRank("Recalled"); // 3
 * ```
 */
export function levelRank(level) {
    return LEVELS.indexOf(level);
}
/**
 * Compares two levels for `Array.prototype.sort`: negative when `a` is below
 * `b`, zero when equal, positive when above.
 *
 * @example
 * ```ts
 * import { compareLevels, type Level } from "./schema.js";
 * const sorted = (["Fluent", "Unseen"] as Level[]).sort(compareLevels);
 * // ["Unseen", "Fluent"]
 * ```
 */
export function compareLevels(a, b) {
    return levelRank(a) - levelRank(b);
}
const RECALL_ONLY = ["recall"];
const UNDERSTAND_RECALL = ["understand", "recall"];
const APPLY_UNDERSTAND = ["apply", "understand"];
const NONE = [];
/**
 * The mastery dimensions a topic of the given type must demonstrate.
 *
 * @example
 * ```ts
 * import { requiredDimensions } from "./schema.js";
 * requiredDimensions("concept"); // ["understand", "recall"]
 * requiredDimensions("fast-moving"); // []
 * ```
 */
export function requiredDimensions(type) {
    switch (type) {
        case "terminology":
            return RECALL_ONLY;
        case "concept":
            return UNDERSTAND_RECALL;
        case "feature":
        case "practice":
            return APPLY_UNDERSTAND;
        case "fast-moving":
            return NONE;
        default: {
            const exhaustive = type;
            throw new TypeError(`unhandled topic type ${String(exhaustive)}`);
        }
    }
}
/**
 * Validates a keyword list: an array of at most 20 strings, each trimmed and
 * lowercased to 1..40 chars. Shared by catalog entries and user overrides so
 * both apply the same rules.
 *
 * @param value - Untrusted input.
 * @param field - Field name used in a failure reason.
 * @returns The normalized keywords, or a reason naming the field.
 *
 * @example
 * ```ts
 * import { parseKeywords } from "./schema.js";
 * parseKeywords(["  Plan Mode "], "keywords"); // { ok: true, value: ["plan mode"] }
 * ```
 */
export function parseKeywords(value, field) {
    if (!Array.isArray(value))
        return fail(`${field} must be an array`);
    const items = value;
    const length = items.length;
    if (length > MAX_KEYWORDS) {
        return fail(`${field} may hold at most ${String(MAX_KEYWORDS)} items`);
    }
    const keywords = [];
    for (let i = 0; i < length; i++) {
        // A hole would otherwise read through to Array.prototype.
        if (!Object.hasOwn(items, i)) {
            return fail(`${field}[${String(i)}] is missing`);
        }
        const item = items[i];
        if (typeof item !== "string") {
            return fail(`${field}[${String(i)}] must be a string`);
        }
        const keyword = item.toLowerCase().trim();
        if (keyword.length === 0 || keyword.length > MAX_KEYWORD_LENGTH) {
            return fail(`${field}[${String(i)}] must be 1 to ${String(MAX_KEYWORD_LENGTH)} characters after trimming`);
        }
        keywords.push(keyword);
    }
    return ok(keywords);
}
function parseDependencies(value, ownId) {
    if (!Array.isArray(value))
        return fail("dependencies must be an array");
    const items = value;
    const length = items.length;
    const seen = new Set();
    for (let i = 0; i < length; i++) {
        // A hole would otherwise read through to Array.prototype.
        if (!Object.hasOwn(items, i)) {
            return fail(`dependencies[${String(i)}] is missing`);
        }
        const item = items[i];
        const dep = parseTopicId(item);
        if (!dep.ok) {
            return fail(`dependencies[${String(i)}] is invalid: ${dep.reason}`);
        }
        if (dep.value === ownId) {
            return fail(`dependencies[${String(i)}] is the entry's own id`);
        }
        if (seen.has(dep.value)) {
            return fail(`dependencies[${String(i)}] is a duplicate`);
        }
        seen.add(dep.value);
    }
    return ok([...seen]);
}
/**
 * Validates one catalog entry. Each field is read once from an own property;
 * extra keys are ignored. `style` is omitted from the result when absent.
 *
 * @param value - Untrusted input.
 * @returns A fresh {@link CatalogEntry}, or a reason naming the bad field.
 *
 * @example
 * ```ts
 * import { parseCatalogEntry } from "./schema.js";
 * const r = parseCatalogEntry({
 *   id: "claude-md",
 *   title: "CLAUDE.md",
 *   type: "feature",
 *   dependencies: [],
 *   keywords: ["CLAUDE.md"],
 *   targetLevel: "Applied",
 *   enabled: true,
 * });
 * if (r.ok) r.value.keywords; // ["claude.md"]
 * ```
 */
export function parseCatalogEntry(value) {
    const record = asRecord(value);
    if (record === null)
        return fail("entry must be an object");
    const id = parseTopicId(ownField(record, "id"));
    if (!id.ok)
        return fail(`entry id is invalid: ${id.reason}`);
    const rawTitle = ownField(record, "title");
    if (typeof rawTitle !== "string")
        return fail("entry title must be a string");
    const title = rawTitle.trim();
    if (title.length === 0 || title.length > MAX_TITLE_LENGTH) {
        return fail(`entry title must be 1 to ${String(MAX_TITLE_LENGTH)} characters after trimming`);
    }
    const type = ownField(record, "type");
    if (!isMember(TOPIC_TYPES, type))
        return fail("entry type is invalid");
    const dependencies = parseDependencies(ownField(record, "dependencies"), id.value);
    if (!dependencies.ok)
        return fail(`entry ${dependencies.reason}`);
    const keywords = parseKeywords(ownField(record, "keywords"), "keywords");
    if (!keywords.ok)
        return fail(`entry ${keywords.reason}`);
    const targetLevel = ownField(record, "targetLevel");
    if (!isMember(LEVELS, targetLevel)) {
        return fail("entry targetLevel is invalid");
    }
    const hasStyle = Object.hasOwn(record, "style");
    const style = hasStyle ? record["style"] : undefined;
    if (hasStyle && !isMember(STYLES, style)) {
        return fail("entry style is invalid");
    }
    const enabled = ownField(record, "enabled");
    if (typeof enabled !== "boolean") {
        return fail("entry enabled must be a boolean");
    }
    return ok({
        id: id.value,
        title,
        type,
        dependencies: dependencies.value,
        keywords: keywords.value,
        targetLevel,
        ...(isMember(STYLES, style) ? { style } : {}),
        enabled,
    });
}
//# sourceMappingURL=schema.js.map