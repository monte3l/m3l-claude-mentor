/**
 * Field-reading primitives shared by the persisted-state parsers
 * (`./state-schema.ts`, `./topic-reset.ts`). Each reads untrusted, plain
 * (JSON-parsed) data without throwing and never walks the prototype chain.
 */

import type { Parsed } from "./schema.ts";

/**
 * Wraps a value as a successful {@link Parsed} result.
 *
 * @example
 * ```ts
 * import { ok } from "./record-fields.ts";
 * ok(1); // { ok: true, value: 1 }
 * ```
 */
export function ok<T>(value: T): Parsed<T> {
  return { ok: true, value };
}

/**
 * Wraps a reason as a failed {@link Parsed} result.
 *
 * @example
 * ```ts
 * import { fail } from "./record-fields.ts";
 * fail("bad"); // { ok: false, reason: "bad" }
 * ```
 */
export function fail<T>(reason: string): Parsed<T> {
  return { ok: false, reason };
}

/**
 * A non-null, non-array object, viewed as a read-only record; `null` for
 * anything else.
 *
 * @example
 * ```ts
 * import { asRecord } from "./record-fields.ts";
 * asRecord([]); // null
 * ```
 */
export function asRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Readonly<Record<string, unknown>>;
}

/**
 * Reads an own field exactly once; `undefined` when absent or inherited.
 *
 * @example
 * ```ts
 * import { ownField } from "./record-fields.ts";
 * ownField({ a: 1 }, "a"); // 1
 * ```
 */
export function ownField(
  record: Readonly<Record<string, unknown>>,
  key: string,
): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/**
 * Whether `value` is a finite, non-negative number (a timestamp in ms).
 *
 * @example
 * ```ts
 * import { isTimestamp } from "./record-fields.ts";
 * isTimestamp(-1); // false
 * ```
 */
export function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Whether `value` is a safe, non-negative integer.
 *
 * @example
 * ```ts
 * import { isCount } from "./record-fields.ts";
 * isCount(1.5); // false
 * ```
 */
export function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
