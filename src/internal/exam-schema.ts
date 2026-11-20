/**
 * The persisted shapes of the exam practice data: one answered item in the
 * append-only `exam-items.jsonl` log, and the in-flight `exam-pending.json`
 * that holds the answer keys between `exam-begin` and `exam-answer`.
 *
 * Neither shape stores question text, options or rationale: an item records
 * only where it sat in the track (domain, objective, topic), how it was asked
 * and whether it was answered correctly; a pending item holds the option
 * letters of its key. Like the parsers in `./schema.ts`, every parser here
 * reads each field once from an own property, ignores and never copies extra
 * keys, returns a fresh object, and never echoes a raw value in its reason.
 */

import {
  parseSessionId,
  parseTopicId,
  type Parsed,
  type SessionId,
  type TopicId,
} from "./schema.ts";
import {
  DOMAIN_ID_PATTERN,
  OBJECTIVE_ID_PATTERN,
  TRACK_CODE_PATTERN,
} from "./track-ids.ts";
import { ITEM_KINDS, type ItemKind } from "./tracks.ts";

/**
 * The ways an exam item can be asked: a focused `drill` or a timed `mock`.
 *
 * @example
 * ```ts
 * import { EXAM_ITEM_MODES } from "./exam-schema.ts";
 * EXAM_ITEM_MODES.includes("mock"); // true
 * ```
 */
export const EXAM_ITEM_MODES = ["drill", "mock"] as const;

/**
 * The most exam items read back from the log or carried by an export bundle.
 *
 * @example
 * ```ts
 * import { MAX_EXAM_ITEMS } from "./exam-schema.ts";
 * MAX_EXAM_ITEMS; // 5000
 * ```
 */
export const MAX_EXAM_ITEMS = 5000;

/**
 * The largest line in `exam-items.jsonl`, in UTF-8 bytes, counting its
 * terminating newline.
 *
 * @example
 * ```ts
 * import { MAX_EXAM_ITEM_LINE_BYTES } from "./exam-schema.ts";
 * Buffer.byteLength("{}") + 1 <= MAX_EXAM_ITEM_LINE_BYTES; // true
 * ```
 */
export const MAX_EXAM_ITEM_LINE_BYTES = 512;

/**
 * How long a pending exam stays answerable, in milliseconds (24 hours).
 *
 * @example
 * ```ts
 * import { PENDING_TTL_MS } from "./exam-schema.ts";
 * PENDING_TTL_MS; // 86_400_000
 * ```
 */
export const PENDING_TTL_MS = 86_400_000;

/**
 * The most items one pending exam can hold; `parsePendingExam` accepts 1 to
 * this many.
 *
 * @example
 * ```ts
 * import { MAX_PENDING_ITEMS } from "./exam-schema.ts";
 * MAX_PENDING_ITEMS; // 15
 * ```
 */
export const MAX_PENDING_ITEMS = 15;

/** The option letters a key may use. */
const KEY_LETTERS = ["A", "B", "C", "D", "E", "F"] as const;

/** The largest key of a multiple-response item. */
const MAX_MULTIPLE_KEY = 5;

/**
 * One answered exam item, as one line of `exam-items.jsonl`.
 *
 * @example
 * ```ts
 * import { parseExamItem, type ExamItem } from "./exam-schema.ts";
 * const r = parseExamItem({
 *   v: 1, track: "CCAR-F", domain: "D1", objective: "D1.2", topic: "plan-mode",
 *   kind: "single", mode: "drill", correct: true, at: 0, session: "sess-1",
 * });
 * const item: ExamItem | null = r.ok ? r.value : null;
 * ```
 */
export interface ExamItem {
  readonly v: 1;
  /** A track code such as `CCAR-F`. */
  readonly track: string;
  /** A domain id such as `D1`. */
  readonly domain: string;
  /** An objective id inside {@link ExamItem.domain}, such as `D1.2`. */
  readonly objective: string;
  readonly topic: TopicId;
  readonly kind: ItemKind;
  readonly mode: (typeof EXAM_ITEM_MODES)[number];
  readonly correct: boolean;
  /** Epoch milliseconds; a non-negative safe integer. */
  readonly at: number;
  readonly session: SessionId;
}

/**
 * One item of a pending exam: where it sits and its answer key.
 *
 * @example
 * ```ts
 * import type { PendingItem } from "./exam-schema.ts";
 * const keyOf = (item: PendingItem): string => item.key.join(",");
 * ```
 */
export interface PendingItem {
  readonly objective: string;
  readonly topic: TopicId;
  readonly kind: ItemKind;
  /**
   * Distinct option letters `A`-`F`, sorted: exactly one for `single`, 2 to
   * 5 for `multiple`.
   */
  readonly key: readonly string[];
}

/**
 * The exam begun but not yet answered (`exam-pending.json`).
 *
 * @example
 * ```ts
 * import { parsePendingExam, type PendingExam } from "./exam-schema.ts";
 * const r = parsePendingExam({
 *   v: 1, track: "CCAR-F", mode: "drill", createdAt: 0,
 *   items: [{ objective: "D1.2", topic: "plan-mode", kind: "single", key: ["B"] }],
 * });
 * const pending: PendingExam | null = r.ok ? r.value : null;
 * ```
 */
export interface PendingExam {
  readonly v: 1;
  readonly track: string;
  readonly mode: (typeof EXAM_ITEM_MODES)[number];
  /** Epoch milliseconds; a non-negative safe integer. */
  readonly createdAt: number;
  /** 1 to 15 items, in the order they were asked. */
  readonly items: readonly PendingItem[];
}

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

/** Reads an own field exactly once; `undefined` when absent or inherited. */
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

function isTrackCode(value: unknown): value is string {
  return typeof value === "string" && TRACK_CODE_PATTERN.test(value);
}

function isObjectiveId(value: unknown): value is string {
  return typeof value === "string" && OBJECTIVE_ID_PATTERN.test(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Validates one exam item. `v` must be exactly `1`; `track` a track code;
 * `domain` a domain id and `objective` an objective id inside that domain;
 * `topic` a topic id; `kind` one of `ITEM_KINDS` (`./tracks.ts`); `mode` one
 * of {@link EXAM_ITEM_MODES}; `correct` a boolean; `at` a non-negative safe
 * integer; `session` a session id.
 *
 * @param value - Untrusted input, typically one JSON-parsed log line.
 * @returns A fresh {@link ExamItem}, or a reason naming the bad field
 * without echoing its value.
 *
 * @example
 * ```ts
 * import { parseExamItem } from "./exam-schema.ts";
 * parseExamItem({ v: 2 }).ok; // false
 * ```
 */
export function parseExamItem(value: unknown): Parsed<ExamItem> {
  const record = asRecord(value);
  if (record === null) return fail("exam item must be an object");
  if (ownField(record, "v") !== 1) return fail("exam item v must be 1");

  const track = ownField(record, "track");
  if (!isTrackCode(track)) return fail("exam item track must be a track code");

  const domain = ownField(record, "domain");
  if (typeof domain !== "string" || !DOMAIN_ID_PATTERN.test(domain)) {
    return fail("exam item domain must look like D<n>");
  }
  const objective = ownField(record, "objective");
  if (!isObjectiveId(objective)) {
    return fail("exam item objective must look like D<n>.<k>");
  }
  if (!objective.startsWith(`${domain}.`)) {
    return fail("exam item objective must belong to its domain");
  }

  const topic = parseTopicId(ownField(record, "topic"));
  if (!topic.ok) return fail(`exam item topic is invalid: ${topic.reason}`);

  const kind = ownField(record, "kind");
  if (!isMember(ITEM_KINDS, kind)) {
    return fail("exam item kind must be single or multiple");
  }
  const mode = ownField(record, "mode");
  if (!isMember(EXAM_ITEM_MODES, mode)) {
    return fail("exam item mode must be drill or mock");
  }
  const correct = ownField(record, "correct");
  if (typeof correct !== "boolean") {
    return fail("exam item correct must be a boolean");
  }
  const at = ownField(record, "at");
  if (!isTimestamp(at)) {
    return fail("exam item at must be a non-negative integer timestamp");
  }

  const session = parseSessionId(ownField(record, "session"));
  if (!session.ok) {
    return fail(`exam item session is invalid: ${session.reason}`);
  }

  return ok({
    v: 1,
    track,
    domain,
    objective,
    topic: topic.value,
    kind,
    mode,
    correct,
    at,
    session: session.value,
  });
}

/** Validates a key for `kind`; returns a sorted copy. */
function parseKey(value: unknown, kind: ItemKind): Parsed<readonly string[]> {
  if (!Array.isArray(value)) return fail("key must be an array of letters");
  const entries: readonly unknown[] = value;
  const letters: string[] = [];
  for (const entry of entries) {
    if (!isMember(KEY_LETTERS, entry)) {
      return fail("key entries must be single letters A to F");
    }
    if (letters.includes(entry)) return fail("key letters must be distinct");
    letters.push(entry);
  }
  switch (kind) {
    case "single":
      if (letters.length !== 1) {
        return fail("key of a single item must hold exactly one letter");
      }
      break;
    case "multiple":
      if (letters.length < 2 || letters.length > MAX_MULTIPLE_KEY) {
        return fail(
          `key of a multiple item must hold 2 to ${String(MAX_MULTIPLE_KEY)} letters`,
        );
      }
      break;
  }
  return ok(letters.sort());
}

function parsePendingItem(value: unknown): Parsed<PendingItem> {
  const record = asRecord(value);
  if (record === null) return fail("must be an object");

  const objective = ownField(record, "objective");
  if (!isObjectiveId(objective)) {
    return fail("objective must look like D<n>.<k>");
  }
  const topic = parseTopicId(ownField(record, "topic"));
  if (!topic.ok) return fail(`topic is invalid: ${topic.reason}`);

  const kind = ownField(record, "kind");
  if (!isMember(ITEM_KINDS, kind)) {
    return fail("kind must be single or multiple");
  }
  const key = parseKey(ownField(record, "key"), kind);
  if (!key.ok) return key;

  return ok({ objective, topic: topic.value, kind, key: key.value });
}

/**
 * Validates a pending exam. `v` must be exactly `1`; `track` a track code;
 * `mode` one of {@link EXAM_ITEM_MODES}; `createdAt` a non-negative safe
 * integer; `items` an array of 1 to 15 items, each with an objective id, a
 * topic id, a kind and a key of distinct letters `A`-`F` (exactly one for
 * `single`, 2 to 5 for `multiple`). Keys are returned sorted.
 *
 * @param value - Untrusted input, typically JSON-parsed `exam-pending.json`.
 * @returns A fresh {@link PendingExam}, or a reason naming the bad field
 * (and item index) without echoing its value.
 *
 * @example
 * ```ts
 * import { parsePendingExam } from "./exam-schema.ts";
 * parsePendingExam({ v: 1, items: [] }).ok; // false
 * ```
 */
export function parsePendingExam(value: unknown): Parsed<PendingExam> {
  const record = asRecord(value);
  if (record === null) return fail("pending exam must be an object");
  if (ownField(record, "v") !== 1) return fail("pending exam v must be 1");

  const track = ownField(record, "track");
  if (!isTrackCode(track)) {
    return fail("pending exam track must be a track code");
  }
  const mode = ownField(record, "mode");
  if (!isMember(EXAM_ITEM_MODES, mode)) {
    return fail("pending exam mode must be drill or mock");
  }
  const createdAt = ownField(record, "createdAt");
  if (!isTimestamp(createdAt)) {
    return fail("pending exam createdAt must be a non-negative integer");
  }

  const rawItems = ownField(record, "items");
  if (
    !Array.isArray(rawItems) ||
    rawItems.length < 1 ||
    rawItems.length > MAX_PENDING_ITEMS
  ) {
    return fail(
      `pending exam items must be an array of 1 to ${String(MAX_PENDING_ITEMS)} items`,
    );
  }
  const entries: readonly unknown[] = rawItems;
  const items: PendingItem[] = [];
  for (const [index, entry] of entries.entries()) {
    const item = parsePendingItem(entry);
    if (!item.ok) {
      return fail(`pending exam items[${String(index)}] ${item.reason}`);
    }
    items.push(item.value);
  }

  return ok({ v: 1, track, mode, createdAt, items });
}

/**
 * Whether a pending exam is older than {@link PENDING_TTL_MS} at `now`. A
 * pending exam exactly at the limit is still live, and one created after
 * `now` (a skewed clock) is never expired.
 *
 * @param pending - A pending exam from {@link parsePendingExam}.
 * @param now - Current timestamp in milliseconds.
 * @returns `true` once more than {@link PENDING_TTL_MS} has passed.
 *
 * @example
 * ```ts
 * import { PENDING_TTL_MS, isPendingExpired, type PendingExam } from "./exam-schema.ts";
 * declare const pending: PendingExam;
 * isPendingExpired(pending, pending.createdAt + PENDING_TTL_MS + 1); // true
 * ```
 */
export function isPendingExpired(pending: PendingExam, now: number): boolean {
  return now - pending.createdAt > PENDING_TTL_MS;
}
