/**
 * Scoring constants that `catalog.json` may override, with a pure parser that
 * validates them before they reach the mastery scorer.
 */
import { CHANNELS } from "./schema.js";
const MS_PER_DAY = 86_400_000;
const MAX_FLUENCY_SESSIONS = 1000;
function ok(value) {
    return { ok: true, value };
}
function fail(reason) {
    return { ok: false, reason };
}
function asRecord(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return null;
    }
    return value;
}
function parseWeights(value) {
    const record = asRecord(value);
    if (record === null)
        return fail("weights must be an object");
    const weights = new Map();
    let sum = 0;
    let selfReport = 0;
    for (const channel of CHANNELS) {
        if (!Object.hasOwn(record, channel)) {
            return fail(`weights.${channel} is missing`);
        }
        const weight = record[channel];
        if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0) {
            return fail(`weights.${channel} must be a finite, non-negative number`);
        }
        weights.set(channel, weight);
        sum += weight;
        if (channel === "self-report")
            selfReport = weight;
    }
    if (!Number.isFinite(sum) || sum <= 0) {
        return fail("weights must sum to a finite number greater than 0");
    }
    for (const [channel, weight] of weights) {
        if (channel !== "self-report" && selfReport > weight) {
            return fail(`weights.self-report must not exceed weights.${channel}`);
        }
    }
    return ok(Object.fromEntries(weights));
}
function parseHalfLifeDays(value) {
    if (typeof value !== "number" ||
        !Number.isFinite(value) ||
        value <= 0 ||
        !Number.isFinite(value * MS_PER_DAY)) {
        return fail("halfLifeDays must be a positive number that stays finite in milliseconds");
    }
    return ok(value);
}
function parseFluencySessions(value) {
    if (typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > MAX_FLUENCY_SESSIONS) {
        return fail(`fluencySessions must be an integer from 1 to ${String(MAX_FLUENCY_SESSIONS)}`);
    }
    return ok(value);
}
/**
 * Validates the scoring overrides from `catalog.json`. Every key is optional
 * and omitted from the result when absent; unknown keys are ignored and not
 * copied. Each field is read once from an own property. Rules: `weights`
 * holds all four {@link CHANNELS}, each finite and non-negative, summing to a
 * finite value above 0, with `self-report` no greater than any other channel;
 * `halfLifeDays` is positive and stays finite when converted to
 * milliseconds; `fluencySessions` is an integer from 1 to 1000. A failure
 * reason names the field and never echoes its value.
 *
 * @param value - Untrusted input, typically JSON-parsed.
 * @returns A fresh {@link ScoringConfig}, or a reason naming the bad field.
 *
 * @example
 * ```ts
 * import { parseScoringConfig } from "./scoring-config.js";
 * const r = parseScoringConfig({ halfLifeDays: 30 });
 * if (r.ok) r.value; // { halfLifeDays: 30 }
 * ```
 */
export function parseScoringConfig(value) {
    const record = asRecord(value);
    if (record === null)
        return fail("scoring config must be an object");
    let weights;
    if (Object.hasOwn(record, "weights")) {
        const parsed = parseWeights(record["weights"]);
        if (!parsed.ok)
            return fail(parsed.reason);
        weights = parsed.value;
    }
    let halfLifeDays;
    if (Object.hasOwn(record, "halfLifeDays")) {
        const parsed = parseHalfLifeDays(record["halfLifeDays"]);
        if (!parsed.ok)
            return fail(parsed.reason);
        halfLifeDays = parsed.value;
    }
    let fluencySessions;
    if (Object.hasOwn(record, "fluencySessions")) {
        const parsed = parseFluencySessions(record["fluencySessions"]);
        if (!parsed.ok)
            return fail(parsed.reason);
        fluencySessions = parsed.value;
    }
    return ok({
        ...(weights !== undefined ? { weights } : {}),
        ...(halfLifeDays !== undefined ? { halfLifeDays } : {}),
        ...(fluencySessions !== undefined ? { fluencySessions } : {}),
    });
}
//# sourceMappingURL=scoring-config.js.map