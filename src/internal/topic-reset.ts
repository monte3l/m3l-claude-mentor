/**
 * A topic's progress trio (`level`, `passes`, `lastPassAt`) and the
 * changelog-reset fields (`resetAt`, `resetFrom`) stored beside it in
 * `profile.json`: their shapes, parsers and clock clamp. Parsers follow the
 * conventions of `./state-schema.ts`.
 */

import {
  asRecord,
  fail,
  isCount,
  isTimestamp,
  ok,
  ownField,
} from "./record-fields.ts";
import { LEVELS, type Level, type Parsed } from "./schema.ts";

const MAX_PASSES = 1_000_000_000;

/**
 * The progress values a topic holds.
 *
 * @example
 * ```ts
 * import type { TopicProgress } from "./topic-reset.ts";
 * const p: TopicProgress = { level: "Applied", passes: 2, lastPassAt: null };
 * ```
 */
export interface TopicProgress {
  readonly level: Level;
  /** An integer from 0 to 1,000,000,000. */
  readonly passes: number;
  /** `null`, or a finite, non-negative timestamp (ms). */
  readonly lastPassAt: number | null;
}

/**
 * The pre-reset values of a topic, stored as its `resetFrom`.
 *
 * @example
 * ```ts
 * import type { TopicResetSnapshot } from "./topic-reset.ts";
 * const s: TopicResetSnapshot = {
 *   level: "Applied",
 *   passes: 2,
 *   lastPassAt: null,
 *   introduced: true,
 * };
 * ```
 */
export interface TopicResetSnapshot extends TopicProgress {
  readonly introduced: boolean;
}

/**
 * A topic's reset fields: both present after a reset, both absent (no own
 * keys) otherwise.
 *
 * @example
 * ```ts
 * import type { TopicResetFields } from "./topic-reset.ts";
 * const none: TopicResetFields = {};
 * ```
 */
export interface TopicResetFields {
  /**
   * When a product change reset this topic (finite, non-negative ms).
   * Evidence recorded before it no longer counts toward the level.
   */
  readonly resetAt?: number;
  /** The values the topic held before its first outstanding reset. */
  readonly resetFrom?: TopicResetSnapshot;
}

function isLevel(value: unknown): value is Level {
  return (
    typeof value === "string" && (LEVELS as readonly string[]).includes(value)
  );
}

/**
 * Validates the `level`/`passes`/`lastPassAt` trio on `record`; a failure
 * reason starts with `prefix`.
 *
 * @example
 * ```ts
 * import { parseTopicProgress } from "./topic-reset.ts";
 * parseTopicProgress({ level: "Applied", passes: 1, lastPassAt: null }, "topic").ok; // true
 * ```
 */
export function parseTopicProgress(
  record: Readonly<Record<string, unknown>>,
  prefix: string,
): Parsed<TopicProgress> {
  const level = ownField(record, "level");
  if (!isLevel(level)) {
    return fail(`${prefix} level is invalid`);
  }

  const lastPassAt = ownField(record, "lastPassAt");
  if (lastPassAt !== null && !isTimestamp(lastPassAt)) {
    return fail(
      `${prefix} lastPassAt must be null or a finite, non-negative number`,
    );
  }

  const passes = ownField(record, "passes");
  if (!isCount(passes) || passes > MAX_PASSES) {
    return fail(
      `${prefix} passes must be an integer from 0 to ${String(MAX_PASSES)}`,
    );
  }
  return ok({ level, passes, lastPassAt });
}

function parseResetFrom(value: unknown): Parsed<TopicResetSnapshot> {
  const record = asRecord(value);
  if (record === null) return fail(`topic resetFrom must be an object`);
  const progress = parseTopicProgress(record, "topic resetFrom");
  if (!progress.ok) return fail(progress.reason);
  const introduced = ownField(record, "introduced");
  if (typeof introduced !== "boolean") {
    return fail(`topic resetFrom introduced must be a boolean`);
  }
  return ok({ ...progress.value, introduced });
}

/**
 * Validates the `resetAt`/`resetFrom` pair on a topic `record`. Both must be
 * present or both absent; absent keys stay absent in the result.
 *
 * @example
 * ```ts
 * import { parseTopicReset } from "./topic-reset.ts";
 * parseTopicReset({}); // { ok: true, value: {} }
 * parseTopicReset({ resetAt: 1 }).ok; // false
 * ```
 */
export function parseTopicReset(
  record: Readonly<Record<string, unknown>>,
): Parsed<TopicResetFields> {
  const hasResetAt = Object.hasOwn(record, "resetAt");
  const hasResetFrom = Object.hasOwn(record, "resetFrom");
  if (hasResetAt !== hasResetFrom) {
    return fail(`topic resetAt and resetFrom must be both present or absent`);
  }
  if (!hasResetAt) return ok({});

  const resetAt = ownField(record, "resetAt");
  if (!isTimestamp(resetAt)) {
    return fail(`topic resetAt must be a finite, non-negative number`);
  }
  const resetFrom = parseResetFrom(ownField(record, "resetFrom"));
  if (!resetFrom.ok) return fail(resetFrom.reason);
  return ok({ resetAt, resetFrom: resetFrom.value });
}

/**
 * Returns `at` clamped to at most `now`; `null` stays `null`.
 *
 * @example
 * ```ts
 * import { clampNullable } from "./topic-reset.ts";
 * clampNullable(5, 3); // 3
 * ```
 */
export function clampNullable(at: number | null, now: number): number | null {
  return at === null ? null : Math.min(at, now);
}

/**
 * Returns fresh reset fields with `resetAt` and `resetFrom.lastPassAt`
 * clamped to at most `now`; every other value is carried over and absent
 * keys stay absent. `now` is assumed already validated by the caller.
 *
 * @example
 * ```ts
 * import { clampTopicReset } from "./topic-reset.ts";
 * clampTopicReset({}, 0); // {}
 * ```
 */
export function clampTopicReset(
  fields: TopicResetFields,
  now: number,
): TopicResetFields {
  const { resetAt, resetFrom } = fields;
  return {
    ...(resetAt !== undefined ? { resetAt: Math.min(resetAt, now) } : {}),
    ...(resetFrom !== undefined
      ? {
          resetFrom: {
            level: resetFrom.level,
            passes: resetFrom.passes,
            lastPassAt: clampNullable(resetFrom.lastPassAt, now),
            introduced: resetFrom.introduced,
          },
        }
      : {}),
  };
}
