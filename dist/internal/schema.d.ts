/**
 * Core value types for the mentor state: mastery levels, evidence, topic ids
 * and catalog entries, each with a pure parser that validates untrusted input.
 *
 * Parsers never throw on plain data such as JSON-parsed values, and never
 * echo the raw input in a failure `reason`. They do not defend against exotic
 * objects: a throwing getter or a revoked Proxy may propagate its error.
 */
/**
 * The result of a parser: the validated value, or a short reason naming the
 * offending field. The reason never contains the raw input value.
 *
 * @example
 * ```ts
 * import { parseTopicId, type Parsed, type TopicId } from "./schema.js";
 * const r: Parsed<TopicId> = parseTopicId("plan-mode");
 * if (r.ok) console.log(r.value);
 * else console.error(r.reason);
 * ```
 */
export type Parsed<T> = {
    readonly ok: true;
    readonly value: T;
} | {
    readonly ok: false;
    readonly reason: string;
};
/**
 * Mastery levels, ordered from least to most mastery.
 *
 * @example
 * ```ts
 * import { LEVELS } from "./schema.js";
 * LEVELS[0]; // "Unseen"
 * ```
 */
export declare const LEVELS: readonly ["Unseen", "Introduced", "Claimed", "Recalled", "Understood", "Applied", "Fluent"];
/**
 * A mastery level; one of {@link LEVELS}.
 *
 * @example
 * ```ts
 * import type { Level } from "./schema.js";
 * const target: Level = "Applied";
 * ```
 */
export type Level = (typeof LEVELS)[number];
/**
 * The channels through which evidence of mastery is gathered.
 *
 * @example
 * ```ts
 * import { CHANNELS } from "./schema.js";
 * CHANNELS.includes("quiz"); // true
 * ```
 */
export declare const CHANNELS: readonly ["observed", "explain-back", "quiz", "self-report"];
/**
 * An evidence channel; one of {@link CHANNELS}.
 *
 * @example
 * ```ts
 * import type { Channel } from "./schema.js";
 * const c: Channel = "explain-back";
 * ```
 */
export type Channel = (typeof CHANNELS)[number];
/**
 * The dimensions of mastery a topic can require.
 *
 * @example
 * ```ts
 * import { DIMENSIONS } from "./schema.js";
 * DIMENSIONS.length; // 3
 * ```
 */
export declare const DIMENSIONS: readonly ["apply", "understand", "recall"];
/**
 * A mastery dimension; one of {@link DIMENSIONS}.
 *
 * @example
 * ```ts
 * import type { Dimension } from "./schema.js";
 * const d: Dimension = "recall";
 * ```
 */
export type Dimension = (typeof DIMENSIONS)[number];
/**
 * The kinds of topic in the catalog.
 *
 * @example
 * ```ts
 * import { TOPIC_TYPES } from "./schema.js";
 * TOPIC_TYPES.includes("feature"); // true
 * ```
 */
export declare const TOPIC_TYPES: readonly ["terminology", "concept", "feature", "practice", "fast-moving"];
/**
 * A topic kind; one of {@link TOPIC_TYPES}.
 *
 * @example
 * ```ts
 * import type { TopicType } from "./schema.js";
 * const t: TopicType = "concept";
 * ```
 */
export type TopicType = (typeof TOPIC_TYPES)[number];
/**
 * The teaching styles the mentor can use.
 *
 * @example
 * ```ts
 * import { STYLES } from "./schema.js";
 * STYLES[0]; // "socratic"
 * ```
 */
export declare const STYLES: readonly ["socratic", "explain-demo", "recall-quiz", "reference"];
/**
 * A teaching style; one of {@link STYLES}.
 *
 * @example
 * ```ts
 * import type { Style } from "./schema.js";
 * const s: Style = "reference";
 * ```
 */
export type Style = (typeof STYLES)[number];
/**
 * A validated topic id (kebab-case, 1 to 64 chars). Obtain one only through
 * {@link parseTopicId}.
 *
 * @example
 * ```ts
 * import { parseTopicId, type TopicId } from "./schema.js";
 * const r = parseTopicId("plan-mode");
 * const id: TopicId | undefined = r.ok ? r.value : undefined;
 * ```
 */
export type TopicId = string & {
    readonly __brand: "TopicId";
};
/**
 * A validated session id (1 to 128 chars of letters, digits, `_` or `-`).
 * Obtain one only through {@link parseSessionId}.
 *
 * @example
 * ```ts
 * import { parseSessionId, type SessionId } from "./schema.js";
 * const r = parseSessionId("sess_1");
 * const id: SessionId | undefined = r.ok ? r.value : undefined;
 * ```
 */
export type SessionId = string & {
    readonly __brand: "SessionId";
};
/**
 * One observation of the learner's mastery of a topic.
 *
 * @example
 * ```ts
 * import { parseEvidence, type Evidence } from "./schema.js";
 * const r = parseEvidence({
 *   channel: "quiz",
 *   topic: "plan-mode",
 *   result: "positive",
 *   at: 1_700_000_000_000,
 *   session: "sess_1",
 * });
 * const e: Evidence | undefined = r.ok ? r.value : undefined;
 * ```
 */
export interface Evidence {
    readonly channel: Channel;
    readonly topic: TopicId;
    readonly result: "positive" | "negative";
    /** Epoch milliseconds; finite and non-negative. */
    readonly at: number;
    readonly session: SessionId;
}
/**
 * The most evidence events the mentor handles at once: the largest
 * `maxEvents` for `readEvidence` (and its default), and the largest evidence
 * list an export bundle may carry.
 *
 * @example
 * ```ts
 * import { MAX_EVIDENCE_EVENTS } from "./schema.js";
 * MAX_EVIDENCE_EVENTS; // 10_000
 * ```
 */
export declare const MAX_EVIDENCE_EVENTS = 10000;
/**
 * One topic in the catalog.
 *
 * @example
 * ```ts
 * import { parseCatalogEntry, type CatalogEntry } from "./schema.js";
 * const r = parseCatalogEntry({
 *   id: "plan-mode",
 *   title: "Plan mode",
 *   type: "feature",
 *   dependencies: [],
 *   keywords: ["plan mode"],
 *   targetLevel: "Applied",
 *   enabled: true,
 * });
 * const entry: CatalogEntry | undefined = r.ok ? r.value : undefined;
 * ```
 */
export interface CatalogEntry {
    readonly id: TopicId;
    /** Non-empty after trimming, at most 120 chars. */
    readonly title: string;
    readonly type: TopicType;
    /** Distinct topic ids, never including this entry's own id. */
    readonly dependencies: readonly TopicId[];
    /** Trimmed, lowercased, 1 to 40 chars each, at most 20 items. */
    readonly keywords: readonly string[];
    readonly targetLevel: Level;
    /** Present only when supplied. */
    readonly style?: Style;
    readonly enabled: boolean;
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
export declare function parseTopicId(value: unknown): Parsed<TopicId>;
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
export declare function parseSessionId(value: unknown): Parsed<SessionId>;
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
export declare function parseEvidence(value: unknown): Parsed<Evidence>;
/**
 * The position of a level in {@link LEVELS} (0 for `Unseen`).
 *
 * @example
 * ```ts
 * import { levelRank } from "./schema.js";
 * levelRank("Recalled"); // 3
 * ```
 */
export declare function levelRank(level: Level): number;
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
export declare function compareLevels(a: Level, b: Level): number;
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
export declare function requiredDimensions(type: TopicType): readonly Dimension[];
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
export declare function parseKeywords(value: unknown, field: string): Parsed<readonly string[]>;
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
export declare function parseCatalogEntry(value: unknown): Parsed<CatalogEntry>;
//# sourceMappingURL=schema.d.ts.map