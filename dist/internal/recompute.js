/**
 * Pure re-derivation of every evidenced topic's stored level from its
 * evidence, used by the SessionStart hook so levels follow observed usage.
 */
import { reconcile } from "./reconcile.js";
import { levelRank, MAX_EVIDENCE_EVENTS, } from "./schema.js";
import { MAX_TOPICS } from "./state-schema.js";
/** Each topic's events in input order, keeping only the newest cap. */
function groupByTopic(events) {
    const groups = new Map();
    for (const event of events) {
        const group = groups.get(event.topic);
        if (group === undefined)
            groups.set(event.topic, [event]);
        else
            group.push(event);
    }
    const capped = new Map();
    for (const [topic, group] of groups) {
        capped.set(topic, group.length > MAX_EVIDENCE_EVENTS
            ? group.slice(-MAX_EVIDENCE_EVENTS)
            : group);
    }
    return capped;
}
/**
 * Re-derives the level of every ENABLED catalog topic that has at least one
 * event, with {@link reconcile} (no claim; the newest 10,000 events of the
 * topic; the `halfLifeDays`/`fluencySessions` overrides when set). An
 * existing entry at another level gets the new level and keeps `introduced`,
 * `passes` and `lastPassAt` (with `raiseOnly`, only a HIGHER derived level
 * replaces the stored one; a lower one is ignored); a missing entry is created (`introduced: false`,
 * `lastPassAt: null`, `passes: 0`) only when the level is above `Unseen` and
 * the profile holds fewer than 500 topics. Topics with no events, and events
 * for unknown or disabled topics, are left alone. The calibration is carried
 * through. Pure: inputs are never mutated, and the same `profile` object is
 * returned when nothing changed.
 *
 * @param input - The profile, evidence, catalog, scoring overrides and clock.
 * @returns The (possibly) updated profile and the changed topics.
 * @throws RangeError when `now` is not finite and non-negative, or as
 * {@link reconcile} does for invalid scoring overrides.
 *
 * @example
 * ```ts
 * import { recomputeProfile } from "./recompute.js";
 * const { profile, changed } = recomputeProfile({
 *   profile: stored,
 *   events,
 *   catalog,
 *   scoring: {},
 *   now: Date.now(),
 * });
 * ```
 */
export function recomputeProfile(input) {
    const { profile, catalog, scoring, now } = input;
    const raiseOnly = input.raiseOnly === true;
    if (typeof now !== "number" || !Number.isFinite(now) || now < 0) {
        throw new RangeError("now must be a finite, non-negative number");
    }
    const { halfLifeDays, fluencySessions } = scoring;
    const byTopic = groupByTopic(input.events);
    const topics = new Map(Object.entries(profile.topics));
    const changed = [];
    for (const entry of catalog) {
        if (!entry.enabled)
            continue;
        const events = byTopic.get(entry.id);
        if (events === undefined)
            continue;
        const previous = topics.get(entry.id);
        const { level } = reconcile({
            type: entry.type,
            events,
            introduced: previous?.introduced ?? false,
            now,
            ...(halfLifeDays !== undefined ? { halfLifeDays } : {}),
            ...(fluencySessions !== undefined ? { fluencySessions } : {}),
        });
        if (previous !== undefined) {
            const delta = levelRank(level) - levelRank(previous.level);
            if (delta === 0 || (raiseOnly && delta < 0))
                continue;
            topics.set(entry.id, { ...previous, level });
        }
        else {
            if (level === "Unseen" || topics.size >= MAX_TOPICS)
                continue;
            topics.set(entry.id, {
                introduced: false,
                level,
                lastPassAt: null,
                passes: 0,
            });
        }
        changed.push(entry.id);
    }
    if (changed.length === 0)
        return { profile, changed };
    return {
        profile: { ...profile, topics: Object.fromEntries(topics) },
        changed,
    };
}
//# sourceMappingURL=recompute.js.map