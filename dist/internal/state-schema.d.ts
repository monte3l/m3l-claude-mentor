/**
 * The persisted shapes of `state.json` and `profile.json`, their defaults,
 * and pure parsers that validate them on load.
 *
 * Parsers follow the conventions of `./schema.ts`: plain data in, a
 * {@link Parsed} result out, never throwing on plain (JSON-parsed) data. Each
 * field is read once from an own property, extra keys are ignored and never
 * copied, and a failure reason names the field without echoing its value.
 * They do not defend against exotic objects: a throwing getter or a revoked
 * Proxy may propagate its error.
 */
import type { Calibration } from "./reconcile.js";
import { type Level, type Parsed, type TopicId } from "./schema.js";
import { type SegmentState } from "./segment.js";
/**
 * The schema version this module reads and writes. A file with any other
 * version is rejected rather than misread.
 *
 * @example
 * ```ts
 * import { SCHEMA_VERSION } from "./state-schema.js";
 * SCHEMA_VERSION; // 1
 * ```
 */
export declare const SCHEMA_VERSION = 1;
/**
 * The ambient engine's persisted state (`state.json`). Timestamps in the
 * future are accepted by {@link parseState}; loaders pull them back to the
 * present with {@link clampStateToNow}.
 *
 * @example
 * ```ts
 * import { defaultState, type MentorState } from "./state-schema.js";
 * const s: MentorState = defaultState(Date.now());
 * ```
 */
export interface MentorState {
    readonly schemaVersion: 1;
    readonly muted: boolean;
    /** Distinct topic ids, at most 500. */
    readonly mutedTopics: readonly TopicId[];
    /** Distinct strings of 1 to 1024 chars without NUL, at most 200. */
    readonly excludedProjects: readonly string[];
    /** `null`, or 1 to 64 chars of letters, digits, `.`, `+` or `-`. */
    readonly lastChangelogVersion: string | null;
    readonly segment: SegmentState;
}
/**
 * The learner's progress on one topic.
 *
 * @example
 * ```ts
 * import type { TopicProfile } from "./state-schema.js";
 * const t: TopicProfile = {
 *   introduced: true,
 *   level: "Recalled",
 *   lastPassAt: null,
 *   passes: 0,
 * };
 * ```
 */
export interface TopicProfile {
    readonly introduced: boolean;
    readonly level: Level;
    /** `null`, or a finite, non-negative timestamp (ms). */
    readonly lastPassAt: number | null;
    /** Consecutive recall passes: an integer from 0 to 1,000,000,000. */
    readonly passes: number;
}
/**
 * The learner's persisted profile (`profile.json`).
 *
 * @example
 * ```ts
 * import { defaultProfile, type Profile } from "./state-schema.js";
 * const p: Profile = defaultProfile();
 * ```
 */
export interface Profile {
    readonly schemaVersion: 1;
    /** Keyed by valid topic id; at most 500 entries. */
    readonly topics: Readonly<Record<string, TopicProfile>>;
    /** Both counts are safe, non-negative integers. */
    readonly calibration: Calibration;
}
/**
 * The most topic entries a profile may hold (`profile.json` `topics`).
 *
 * @example
 * ```ts
 * import { MAX_TOPICS } from "./state-schema.js";
 * MAX_TOPICS; // 500
 * ```
 */
export declare const MAX_TOPICS: number;
/**
 * Creates the state for a learner with no history: unmuted, empty lists, no
 * changelog version, and a first segment from {@link newSegment}.
 *
 * @param now - Current timestamp in milliseconds; finite and non-negative.
 * @throws RangeError when `now` is non-finite or negative.
 *
 * @example
 * ```ts
 * import { defaultState } from "./state-schema.js";
 * defaultState(1_000).segment.startedAt; // 1_000
 * ```
 */
export declare function defaultState(now: number): MentorState;
/**
 * Validates a persisted {@link SegmentState}: `segmentId` an integer from 0
 * to `Number.MAX_SAFE_INTEGER - 1`; `startedAt` and `lastActivityAt` finite
 * and non-negative with `startedAt <= lastActivityAt`; `tipsEmitted` a safe,
 * non-negative integer; `lastTipAt` `null` or finite and non-negative;
 * `lastTopic` `null` or a valid topic id. This parser is pure and has no
 * clock, so future-dated timestamps are accepted; the loaders clamp them
 * with {@link clampStateToNow}.
 *
 * @param value - Untrusted input.
 * @returns A fresh {@link SegmentState}, or a reason naming the bad field.
 *
 * @example
 * ```ts
 * import { parseSegmentState } from "./state-schema.js";
 * parseSegmentState({
 *   segmentId: 0,
 *   startedAt: 0,
 *   lastActivityAt: 0,
 *   tipsEmitted: 0,
 *   lastTipAt: null,
 *   lastTopic: null,
 * }).ok; // true
 * ```
 */
export declare function parseSegmentState(value: unknown): Parsed<SegmentState>;
/**
 * Whether `value` is a well-formed changelog version, the rule
 * `lastChangelogVersion` follows: a string of 1 to 64 characters of ASCII
 * letters, digits, `.`, `+` or `-`.
 *
 * @param value - Untrusted input.
 *
 * @example
 * ```ts
 * import { isChangelogVersion } from "./state-schema.js";
 * isChangelogVersion("1.2.3-rc.1"); // true
 * isChangelogVersion("1.2 3"); // false
 * ```
 */
export declare function isChangelogVersion(value: unknown): value is string;
/**
 * Validates a persisted {@link MentorState}. `schemaVersion` must be exactly
 * `1`; any other value fails with "unsupported schemaVersion", so a file
 * from a newer release is rejected rather than misread. Lists are returned
 * as fresh copies.
 *
 * @param value - Untrusted input, typically JSON-parsed `state.json`.
 * @returns A fresh {@link MentorState}, or a reason naming the bad field.
 *
 * @example
 * ```ts
 * import { defaultState, parseState } from "./state-schema.js";
 * parseState(defaultState(0)).ok; // true
 * parseState({ schemaVersion: 2 }).ok; // false
 * ```
 */
export declare function parseState(value: unknown): Parsed<MentorState>;
/**
 * Creates an empty profile: no topics and a zero calibration. Each call
 * returns fresh objects.
 *
 * @example
 * ```ts
 * import { defaultProfile } from "./state-schema.js";
 * defaultProfile().calibration; // { confirmed: 0, refuted: 0 }
 * ```
 */
export declare function defaultProfile(): Profile;
/**
 * Validates a persisted {@link Profile}. `schemaVersion` must be exactly `1`.
 * Every `topics` key must be a valid topic id (so `__proto__` fails), with
 * at most 500 entries; an array in place of the record fails. The result's
 * records are built fresh, so a parsed `__proto__` key cannot pollute them.
 *
 * @param value - Untrusted input, typically JSON-parsed `profile.json`.
 * @returns A fresh {@link Profile}, or a reason naming the bad field.
 *
 * @example
 * ```ts
 * import { defaultProfile, parseProfile } from "./state-schema.js";
 * parseProfile(defaultProfile()).ok; // true
 * ```
 */
export declare function parseProfile(value: unknown): Parsed<Profile>;
/**
 * Returns a copy of `state` with every segment timestamp later than `now`
 * (`startedAt`, `lastActivityAt`, and `lastTipAt` when non-null) set to
 * `now`. Earlier timestamps and every other field are carried over
 * unchanged, and `startedAt <= lastActivityAt` still holds. The input is
 * never mutated. Pure: the caller supplies the clock.
 *
 * @param state - A state from {@link parseState} or {@link defaultState}.
 * @param now - Current timestamp in milliseconds; finite and non-negative.
 * @throws RangeError when `now` is non-finite or negative.
 *
 * @example
 * ```ts
 * import { clampStateToNow, defaultState } from "./state-schema.js";
 * clampStateToNow(defaultState(5_000), 1_000).segment.startedAt; // 1_000
 * ```
 */
export declare function clampStateToNow(state: MentorState, now: number): MentorState;
/**
 * Returns a copy of `profile` with every topic `lastPassAt` later than `now`
 * set to `now`; `null` and earlier values, and every other field, are
 * carried over unchanged. The input is never mutated. Pure: the caller
 * supplies the clock.
 *
 * @param profile - A profile from {@link parseProfile} or
 * {@link defaultProfile}.
 * @param now - Current timestamp in milliseconds; finite and non-negative.
 * @throws RangeError when `now` is non-finite or negative.
 *
 * @example
 * ```ts
 * import { clampProfileToNow, defaultProfile } from "./state-schema.js";
 * clampProfileToNow(defaultProfile(), Date.now()).topics; // {}
 * ```
 */
export declare function clampProfileToNow(profile: Profile, now: number): Profile;
//# sourceMappingURL=state-schema.d.ts.map