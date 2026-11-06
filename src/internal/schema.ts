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
export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

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
] as const;

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
export const CHANNELS = [
  "observed",
  "explain-back",
  "quiz",
  "self-report",
] as const;

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
export const DIMENSIONS = ["apply", "understand", "recall"] as const;

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
export const TOPIC_TYPES = [
  "terminology",
  "concept",
  "feature",
  "practice",
  "fast-moving",
] as const;

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
export const STYLES = [
  "socratic",
  "explain-demo",
  "recall-quiz",
  "reference",
] as const;

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
export type TopicId = string & { readonly __brand: "TopicId" };

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
export type SessionId = string & { readonly __brand: "SessionId" };

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

const TOPIC_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_TOPIC_ID_LENGTH = 64;
const MAX_SESSION_ID_LENGTH = 128;
const MAX_TITLE_LENGTH = 120;
const MAX_KEYWORD_LENGTH = 40;
const MAX_KEYWORDS = 20;

function ok<T>(value: T): Parsed<T> {
  return { ok: true, value };
}

function fail<T>(reason: string): Parsed<T> {
  return { ok: false, reason };
}

/** A non-null, non-array object, viewed as a read-only record. */
function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Readonly<Record<string, unknown>>;
}

/**
 * Reads an own field exactly once. Returns `undefined` for a field that is
 * absent or only inherited, so callers treat "missing" uniformly.
 */
function ownField(
  record: Readonly<Record<string, unknown>>,
  key: string,
): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function isMember<T extends string>(
  set: readonly T[],
  value: unknown,
): value is T {
  return (
    typeof value === "string" && (set as readonly string[]).includes(value)
  );
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
export function parseTopicId(value: unknown): Parsed<TopicId> {
  if (typeof value !== "string") return fail("topic id must be a string");
  if (value.length === 0 || value.length > MAX_TOPIC_ID_LENGTH) {
    return fail("topic id must be 1 to 64 characters");
  }
  if (!TOPIC_ID_PATTERN.test(value)) {
    return fail("topic id must be lowercase kebab-case");
  }
  return ok(value as TopicId);
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
export function parseSessionId(value: unknown): Parsed<SessionId> {
  if (typeof value !== "string") return fail("session id must be a string");
  if (value.length === 0 || value.length > MAX_SESSION_ID_LENGTH) {
    return fail("session id must be 1 to 128 characters");
  }
  if (!SESSION_ID_PATTERN.test(value)) {
    return fail("session id may contain only letters, digits, _ and -");
  }
  return ok(value as SessionId);
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
export function parseEvidence(value: unknown): Parsed<Evidence> {
  const record = asRecord(value);
  if (record === null) return fail("evidence must be an object");

  const channel = ownField(record, "channel");
  if (!isMember(CHANNELS, channel)) return fail("evidence channel is invalid");

  const topic = parseTopicId(ownField(record, "topic"));
  if (!topic.ok) return fail(`evidence topic is invalid: ${topic.reason}`);

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
export function levelRank(level: Level): number {
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
export function compareLevels(a: Level, b: Level): number {
  return levelRank(a) - levelRank(b);
}

const RECALL_ONLY: readonly Dimension[] = ["recall"];
const UNDERSTAND_RECALL: readonly Dimension[] = ["understand", "recall"];
const APPLY_UNDERSTAND: readonly Dimension[] = ["apply", "understand"];
const NONE: readonly Dimension[] = [];

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
export function requiredDimensions(type: TopicType): readonly Dimension[] {
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
      const exhaustive: never = type;
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
export function parseKeywords(
  value: unknown,
  field: string,
): Parsed<readonly string[]> {
  if (!Array.isArray(value)) return fail(`${field} must be an array`);
  const items: readonly unknown[] = value;
  const length = items.length;
  if (length > MAX_KEYWORDS) {
    return fail(`${field} may hold at most ${String(MAX_KEYWORDS)} items`);
  }
  const keywords: string[] = [];
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
      return fail(
        `${field}[${String(i)}] must be 1 to ${String(MAX_KEYWORD_LENGTH)} characters after trimming`,
      );
    }
    keywords.push(keyword);
  }
  return ok(keywords);
}

function parseDependencies(
  value: unknown,
  ownId: TopicId,
): Parsed<readonly TopicId[]> {
  if (!Array.isArray(value)) return fail("dependencies must be an array");
  const items: readonly unknown[] = value;
  const length = items.length;
  const seen = new Set<TopicId>();
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
export function parseCatalogEntry(value: unknown): Parsed<CatalogEntry> {
  const record = asRecord(value);
  if (record === null) return fail("entry must be an object");

  const id = parseTopicId(ownField(record, "id"));
  if (!id.ok) return fail(`entry id is invalid: ${id.reason}`);

  const rawTitle = ownField(record, "title");
  if (typeof rawTitle !== "string") return fail("entry title must be a string");
  const title = rawTitle.trim();
  if (title.length === 0 || title.length > MAX_TITLE_LENGTH) {
    return fail(
      `entry title must be 1 to ${String(MAX_TITLE_LENGTH)} characters after trimming`,
    );
  }

  const type = ownField(record, "type");
  if (!isMember(TOPIC_TYPES, type)) return fail("entry type is invalid");

  const dependencies = parseDependencies(
    ownField(record, "dependencies"),
    id.value,
  );
  if (!dependencies.ok) return fail(`entry ${dependencies.reason}`);

  const keywords = parseKeywords(ownField(record, "keywords"), "keywords");
  if (!keywords.ok) return fail(`entry ${keywords.reason}`);

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
