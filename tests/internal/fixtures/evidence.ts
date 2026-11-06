import {
  parseEvidence,
  type Channel,
  type Evidence,
} from "../../../src/internal/schema.js";

/** One day in milliseconds, hand-written so tests do not import it. */
export const DAY = 86_400_000;

/** A fixed "now" far enough from zero that every test age stays non-negative. */
export const NOW = 1_000 * DAY;

/** Converts days to milliseconds. */
export function days(n: number): number {
  return n * DAY;
}

/**
 * Builds a valid `Evidence` aged `ageMs` before {@link NOW}.
 * A negative `ageMs` yields an event in the future (clock skew).
 */
export function ev(
  channel: Channel,
  result: "positive" | "negative" = "positive",
  ageMs = 0,
  session = "s1",
  topic = "plan-mode",
): Evidence {
  const parsed = parseEvidence({
    channel,
    topic,
    result,
    at: NOW - ageMs,
    session,
  });
  if (!parsed.ok) {
    throw new Error(`bad fixture: ${parsed.reason}`);
  }
  return parsed.value;
}

/** `n` identical events (same session, same age). */
export function repeat(
  n: number,
  channel: Channel,
  result: "positive" | "negative" = "positive",
  ageMs = 0,
  session = "s1",
): Evidence[] {
  return Array.from({ length: n }, () => ev(channel, result, ageMs, session));
}
