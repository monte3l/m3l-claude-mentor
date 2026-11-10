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
import { LEVELS, parseTopicId, } from "./schema.js";
import { newSegment } from "./segment.js";
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
export const SCHEMA_VERSION = 1;
/**
 * The most topic entries a profile may hold (`profile.json` `topics`).
 *
 * @example
 * ```ts
 * import { MAX_TOPICS } from "./state-schema.js";
 * MAX_TOPICS; // 500
 * ```
 */
export const MAX_TOPICS = 500;
const MAX_MUTED_TOPICS = 500;
const MAX_EXCLUDED_PROJECTS = 200;
const MAX_PROJECT_LENGTH = 1024;
const MAX_VERSION_LENGTH = 64;
const VERSION_PATTERN = /^[0-9A-Za-z.+-]+$/;
const MAX_PASSES = 1_000_000_000;
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
/** Reads an own field exactly once; `undefined` when absent or inherited. */
function ownField(record, key) {
    return Object.hasOwn(record, key) ? record[key] : undefined;
}
function isTimestamp(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function isCount(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
/**
 * Validates an array of distinct items, at most `max` long, each through
 * `parseItem`. Holes fail rather than reading through to the prototype.
 */
function parseDistinctList(value, field, max, parseItem, itemRule) {
    if (!Array.isArray(value))
        return fail(`${field} must be an array`);
    const items = value;
    const length = items.length;
    if (length > max) {
        return fail(`${field} may hold at most ${String(max)} items`);
    }
    const seen = new Set();
    for (let i = 0; i < length; i++) {
        if (!Object.hasOwn(items, i)) {
            return fail(`${field}[${String(i)}] is missing`);
        }
        const parsed = parseItem(items[i]);
        if (parsed === null) {
            return fail(`${field}[${String(i)}] ${itemRule}`);
        }
        if (seen.has(parsed)) {
            return fail(`${field}[${String(i)}] is a duplicate`);
        }
        seen.add(parsed);
    }
    return ok([...seen]);
}
function topicOrNull(item) {
    const parsed = parseTopicId(item);
    return parsed.ok ? parsed.value : null;
}
function projectOrNull(item) {
    return typeof item === "string" &&
        item.length > 0 &&
        item.length <= MAX_PROJECT_LENGTH &&
        !item.includes("\0")
        ? item
        : null;
}
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
export function defaultState(now) {
    return {
        schemaVersion: SCHEMA_VERSION,
        muted: false,
        mutedTopics: [],
        excludedProjects: [],
        lastChangelogVersion: null,
        segment: newSegment(now),
    };
}
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
export function parseSegmentState(value) {
    const record = asRecord(value);
    if (record === null)
        return fail("segment must be an object");
    const segmentId = ownField(record, "segmentId");
    if (!isCount(segmentId) || segmentId >= Number.MAX_SAFE_INTEGER) {
        return fail("segment segmentId must be an integer from 0 to MAX_SAFE_INTEGER - 1");
    }
    const startedAt = ownField(record, "startedAt");
    if (!isTimestamp(startedAt)) {
        return fail("segment startedAt must be a finite, non-negative number");
    }
    const lastActivityAt = ownField(record, "lastActivityAt");
    if (!isTimestamp(lastActivityAt)) {
        return fail("segment lastActivityAt must be a finite, non-negative number");
    }
    if (startedAt > lastActivityAt) {
        return fail("segment startedAt must not be after lastActivityAt");
    }
    const tipsEmitted = ownField(record, "tipsEmitted");
    if (!isCount(tipsEmitted)) {
        return fail("segment tipsEmitted must be a non-negative integer");
    }
    const lastTipAt = ownField(record, "lastTipAt");
    if (lastTipAt !== null && !isTimestamp(lastTipAt)) {
        return fail("segment lastTipAt must be null or a finite, non-negative number");
    }
    const rawTopic = ownField(record, "lastTopic");
    let lastTopic = null;
    if (rawTopic !== null) {
        const topic = parseTopicId(rawTopic);
        if (!topic.ok) {
            return fail(`segment lastTopic is invalid: ${topic.reason}`);
        }
        lastTopic = topic.value;
    }
    return ok({
        segmentId,
        startedAt,
        lastActivityAt,
        tipsEmitted,
        lastTipAt,
        lastTopic,
    });
}
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
export function isChangelogVersion(value) {
    return (typeof value === "string" &&
        value.length <= MAX_VERSION_LENGTH &&
        VERSION_PATTERN.test(value));
}
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
export function parseState(value) {
    const record = asRecord(value);
    if (record === null)
        return fail("state must be an object");
    const schemaVersion = ownField(record, "schemaVersion");
    if (schemaVersion !== SCHEMA_VERSION) {
        return fail("state has an unsupported schemaVersion");
    }
    const muted = ownField(record, "muted");
    if (typeof muted !== "boolean")
        return fail("state muted must be a boolean");
    const mutedTopics = parseDistinctList(ownField(record, "mutedTopics"), "mutedTopics", MAX_MUTED_TOPICS, topicOrNull, "must be a valid topic id");
    if (!mutedTopics.ok)
        return fail(`state ${mutedTopics.reason}`);
    const excludedProjects = parseDistinctList(ownField(record, "excludedProjects"), "excludedProjects", MAX_EXCLUDED_PROJECTS, projectOrNull, `must be a string of 1 to ${String(MAX_PROJECT_LENGTH)} characters without NUL`);
    if (!excludedProjects.ok)
        return fail(`state ${excludedProjects.reason}`);
    const version = ownField(record, "lastChangelogVersion");
    if (version !== null && !isChangelogVersion(version)) {
        return fail(`state lastChangelogVersion must be null or 1 to ${String(MAX_VERSION_LENGTH)} characters of letters, digits, ., + or -`);
    }
    const segment = parseSegmentState(ownField(record, "segment"));
    if (!segment.ok)
        return fail(`state ${segment.reason}`);
    return ok({
        schemaVersion: SCHEMA_VERSION,
        muted,
        mutedTopics: mutedTopics.value,
        excludedProjects: excludedProjects.value,
        lastChangelogVersion: version,
        segment: segment.value,
    });
}
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
export function defaultProfile() {
    return {
        schemaVersion: SCHEMA_VERSION,
        topics: {},
        calibration: { confirmed: 0, refuted: 0 },
    };
}
function isLevel(value) {
    return (typeof value === "string" && LEVELS.includes(value));
}
function parseTopicProfile(value) {
    const record = asRecord(value);
    if (record === null)
        return fail(`topic must be an object`);
    const introduced = ownField(record, "introduced");
    if (typeof introduced !== "boolean") {
        return fail(`topic introduced must be a boolean`);
    }
    const level = ownField(record, "level");
    if (!isLevel(level)) {
        return fail(`topic level is invalid`);
    }
    const lastPassAt = ownField(record, "lastPassAt");
    if (lastPassAt !== null && !isTimestamp(lastPassAt)) {
        return fail(`topic lastPassAt must be null or a finite, non-negative number`);
    }
    const passes = ownField(record, "passes");
    if (!isCount(passes) || passes > MAX_PASSES) {
        return fail(`topic passes must be an integer from 0 to ${String(MAX_PASSES)}`);
    }
    return ok({ introduced, level, lastPassAt, passes });
}
function parseTopics(value) {
    const record = asRecord(value);
    if (record === null)
        return fail("profile topics must be an object");
    const keys = Object.keys(record);
    if (keys.length > MAX_TOPICS) {
        return fail(`profile topics may hold at most ${String(MAX_TOPICS)} entries`);
    }
    const topics = new Map();
    for (const key of keys) {
        const id = parseTopicId(key);
        // Defence in depth: parseTopicId already rejects "__proto__" (underscores
        // are not kebab-case), but the record must never be keyed by it.
        if (key === "__proto__" || !id.ok) {
            return fail("profile topics has a key that is not a valid topic id");
        }
        const topic = parseTopicProfile(record[key]);
        if (!topic.ok)
            return fail(`profile topics entry is invalid: ${topic.reason}`);
        topics.set(id.value, topic.value);
    }
    return ok(Object.fromEntries(topics));
}
function parseCalibration(value) {
    const record = asRecord(value);
    if (record === null)
        return fail("profile calibration must be an object");
    const confirmed = ownField(record, "confirmed");
    if (!isCount(confirmed)) {
        return fail("profile calibration confirmed must be a non-negative integer");
    }
    const refuted = ownField(record, "refuted");
    if (!isCount(refuted)) {
        return fail("profile calibration refuted must be a non-negative integer");
    }
    return ok({ confirmed, refuted });
}
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
export function parseProfile(value) {
    const record = asRecord(value);
    if (record === null)
        return fail("profile must be an object");
    const schemaVersion = ownField(record, "schemaVersion");
    if (schemaVersion !== SCHEMA_VERSION) {
        return fail("profile has an unsupported schemaVersion");
    }
    const topics = parseTopics(ownField(record, "topics"));
    if (!topics.ok)
        return fail(topics.reason);
    const calibration = parseCalibration(ownField(record, "calibration"));
    if (!calibration.ok)
        return fail(calibration.reason);
    return ok({
        schemaVersion: SCHEMA_VERSION,
        topics: topics.value,
        calibration: calibration.value,
    });
}
function checkNow(now) {
    if (!Number.isFinite(now) || now < 0) {
        throw new RangeError("now must be a finite, non-negative number");
    }
}
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
export function clampStateToNow(state, now) {
    checkNow(now);
    const segment = state.segment;
    const lastTipAt = segment.lastTipAt;
    return {
        schemaVersion: state.schemaVersion,
        muted: state.muted,
        mutedTopics: state.mutedTopics,
        excludedProjects: state.excludedProjects,
        lastChangelogVersion: state.lastChangelogVersion,
        segment: {
            segmentId: segment.segmentId,
            startedAt: Math.min(segment.startedAt, now),
            lastActivityAt: Math.min(segment.lastActivityAt, now),
            tipsEmitted: segment.tipsEmitted,
            lastTipAt: lastTipAt === null ? null : Math.min(lastTipAt, now),
            lastTopic: segment.lastTopic,
        },
    };
}
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
export function clampProfileToNow(profile, now) {
    checkNow(now);
    const topics = new Map();
    for (const [id, topic] of Object.entries(profile.topics)) {
        const lastPassAt = topic.lastPassAt;
        topics.set(id, {
            introduced: topic.introduced,
            level: topic.level,
            lastPassAt: lastPassAt === null ? null : Math.min(lastPassAt, now),
            passes: topic.passes,
        });
    }
    return {
        schemaVersion: profile.schemaVersion,
        topics: Object.fromEntries(topics),
        calibration: {
            confirmed: profile.calibration.confirmed,
            refuted: profile.calibration.refuted,
        },
    };
}
//# sourceMappingURL=state-schema.js.map