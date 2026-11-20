/**
 * Voided exam submissions: pure filters that hide a voided submission's
 * quiz evidence and exam items from scoring, without rewriting either log.
 * A submission is identified by the `(session, at)` pair every evidence
 * event and exam item of one `exam-answer` share.
 */

import type { ExamItem } from "./exam-schema.ts";
import type { Evidence, SessionId } from "./schema.ts";

/**
 * One voided exam submission, as stored in `state.json` `voidedExams`.
 *
 * @example
 * ```ts
 * import { parseSessionId } from "./schema.ts";
 * import type { VoidedExam } from "./voids.ts";
 * const r = parseSessionId("sess-1");
 * if (r.ok) {
 *   const v: VoidedExam = { session: r.value, at: 1_700_000_000_000 };
 * }
 * ```
 */
export interface VoidedExam {
  readonly session: SessionId;
  /** Epoch milliseconds of the submission: a safe, non-negative integer. */
  readonly at: number;
}

/**
 * A lookup key for one `(session, at)` pair; `\0` never occurs in either, so
 * two distinct pairs never share a key.
 *
 * @param session - The submission's session id.
 * @param at - The submission's epoch milliseconds.
 *
 * @example
 * ```ts
 * import { pairKey } from "./voids.ts";
 * const seen = new Set([pairKey("sess-1", 1_000)]);
 * seen.has(pairKey("sess-1", 1_000)); // true
 * ```
 */
export function pairKey(session: string, at: number): string {
  return `${session}\0${String(at)}`;
}

function voidKeys(voids: readonly VoidedExam[]): ReadonlySet<string> {
  return new Set(voids.map((v) => pairKey(v.session, v.at)));
}

/**
 * Drops the `quiz`-channel events whose `(session, at)` matches a void;
 * events of every other channel are kept even on a matching pair. Returns a
 * new array in the original order; the input is never mutated.
 *
 * @param events - Evidence events, typically from `readEvidence`.
 * @param voids - The stored void list.
 *
 * @example
 * ```ts
 * import { excludeVoidedEvidence } from "./voids.ts";
 * const counted = excludeVoidedEvidence(events, state.voidedExams ?? []);
 * ```
 */
export function excludeVoidedEvidence(
  events: readonly Evidence[],
  voids: readonly VoidedExam[],
): Evidence[] {
  const keys = voidKeys(voids);
  return events.filter(
    (event) =>
      event.channel !== "quiz" || !keys.has(pairKey(event.session, event.at)),
  );
}

/**
 * Drops the exam items whose `(session, at)` matches a void. Returns a new
 * array in the original order; the input is never mutated.
 *
 * @param items - Exam items, typically from `readExamItems`.
 * @param voids - The stored void list.
 *
 * @example
 * ```ts
 * import { excludeVoidedItems } from "./voids.ts";
 * const counted = excludeVoidedItems(items, state.voidedExams ?? []);
 * ```
 */
export function excludeVoidedItems(
  items: readonly ExamItem[],
  voids: readonly VoidedExam[],
): ExamItem[] {
  const keys = voidKeys(voids);
  return items.filter((item) => !keys.has(pairKey(item.session, item.at)));
}
