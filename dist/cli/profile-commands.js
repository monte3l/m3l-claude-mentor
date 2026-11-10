import { isReviewDue } from "../internal/mastery.js";
import { calibrationScore, reconcile, updateCalibration, } from "../internal/reconcile.js";
import { compareLevels, LEVELS, } from "../internal/schema.js";
import { loadProfile, loadState, readEvidence, saveProfile, } from "../internal/store.js";
import { requireOneOf, requireTopicId } from "./args.js";
import { loadMergedCatalog, requireCatalogEntry, } from "./env.js";
const UNSEEN_TOPIC = {
    introduced: false,
    level: "Unseen",
    lastPassAt: null,
    passes: 0,
};
function existingTopic(profile, topic) {
    return Object.hasOwn(profile.topics, topic)
        ? profile.topics[topic]
        : undefined;
}
function withTopic(profile, topic, value) {
    return { ...profile, topics: { ...profile.topics, [topic]: value } };
}
/**
 * `get-profile`: the stored profile merged with the state's mute and
 * exclusion settings and last changelog version; topics sorted by id. The
 * merged catalog is loaded so that a `catalog.json` that no longer merges
 * is reported.
 *
 * @example
 * ```ts
 * import { getProfile } from "./profile-commands.js";
 * const { topics } = await getProfile(env);
 * ```
 */
export async function getProfile(env) {
    await loadMergedCatalog(env);
    const profile = await loadProfile(env.dir, env.now);
    const state = await loadState(env.dir, env.now);
    const topics = Object.entries(profile.topics)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([id, topic]) => ({
        id,
        level: topic.level,
        introduced: topic.introduced,
        passes: topic.passes,
        lastPassAt: topic.lastPassAt,
        reviewDue: topic.lastPassAt !== null &&
            isReviewDue(topic.lastPassAt, topic.passes, env.now),
    }));
    return {
        topics,
        calibration: profile.calibration,
        calibrationScore: calibrationScore(profile.calibration),
        muted: state.muted,
        mutedTopics: state.mutedTopics,
        excludedProjects: state.excludedProjects,
        lastChangelogVersion: state.lastChangelogVersion,
    };
}
function optionalClaim(args) {
    return args.values.has("claim")
        ? requireOneOf(args, "claim", LEVELS)
        : undefined;
}
/**
 * `recompute --topic <id> [--claim <Level>]`: re-derives the topic's level
 * from its evidence with the catalog's scoring overrides, saves it (keeping
 * `introduced`, `passes` and `lastPassAt`), and counts a `confirmed` or
 * `refuted` outcome in the calibration only when `--claim` was given.
 * `evidenceSkipped` counts malformed evidence lines that were skipped.
 *
 * Known limitations: only the evidence tail window `readEvidence` returns
 * (its default `maxEvents`) is read, so a topic's oldest events can fall out
 * of it on a long history; and the profile update is a read-modify-write
 * with no lock, so two concurrent writers race and the last one wins.
 *
 * @throws CliUsageError for a malformed or unknown topic or a bad claim.
 *
 * @example
 * ```ts
 * import { recompute } from "./profile-commands.js";
 * const { level, claim } = await recompute(args, env);
 * ```
 */
export async function recompute(args, env) {
    const topic = requireTopicId(args);
    const claimedLevel = optionalClaim(args);
    const { file, entries } = await loadMergedCatalog(env);
    const entry = requireCatalogEntry(entries, topic);
    const { halfLifeDays, fluencySessions } = file.scoring;
    const profile = await loadProfile(env.dir, env.now);
    const { events, skipped } = await readEvidence(env.dir);
    const previous = existingTopic(profile, topic) ?? UNSEEN_TOPIC;
    const result = reconcile({
        type: entry.type,
        events: events.filter((event) => event.topic === topic),
        introduced: previous.introduced,
        now: env.now,
        ...(claimedLevel !== undefined ? { claimedLevel } : {}),
        ...(halfLifeDays !== undefined ? { halfLifeDays } : {}),
        ...(fluencySessions !== undefined ? { fluencySessions } : {}),
    });
    const calibration = claimedLevel === undefined
        ? profile.calibration
        : updateCalibration(profile.calibration, result.claim);
    await saveProfile(env.dir, {
        ...withTopic(profile, topic, { ...previous, level: result.level }),
        calibration,
    });
    return {
        topic,
        level: result.level,
        previousLevel: previous.level,
        claim: result.claim,
        diagnoses: result.diagnoses,
        evidenceSkipped: skipped,
    };
}
/**
 * `introduce --topic <id>`: marks the topic introduced, raising its level to
 * `Introduced` when it is lower and never lowering it.
 *
 * @throws CliUsageError for a malformed or unknown topic.
 *
 * @example
 * ```ts
 * import { introduce } from "./profile-commands.js";
 * const { level } = await introduce(args, env);
 * ```
 */
export async function introduce(args, env) {
    const topic = requireTopicId(args);
    const { entries } = await loadMergedCatalog(env);
    requireCatalogEntry(entries, topic);
    const profile = await loadProfile(env.dir, env.now);
    const previous = existingTopic(profile, topic) ?? UNSEEN_TOPIC;
    const level = compareLevels(previous.level, "Introduced") >= 0
        ? previous.level
        : "Introduced";
    await saveProfile(env.dir, withTopic(profile, topic, { ...previous, introduced: true, level }));
    return { topic, level };
}
/**
 * `record-pass --topic <id> --result <pass|fail>`: a pass increments
 * `passes` and stamps `lastPassAt = now`; a fail resets `passes` to 0 and
 * leaves `lastPassAt` alone.
 *
 * @throws CliUsageError for a malformed or unknown topic or a bad result.
 *
 * @example
 * ```ts
 * import { recordPass } from "./profile-commands.js";
 * const { passes } = await recordPass(args, env);
 * ```
 */
export async function recordPass(args, env) {
    const topic = requireTopicId(args);
    const result = requireOneOf(args, "result", ["pass", "fail"]);
    const { entries } = await loadMergedCatalog(env);
    requireCatalogEntry(entries, topic);
    const profile = await loadProfile(env.dir, env.now);
    const previous = existingTopic(profile, topic) ?? UNSEEN_TOPIC;
    const next = result === "pass"
        ? { ...previous, passes: previous.passes + 1, lastPassAt: env.now }
        : { ...previous, passes: 0 };
    await saveProfile(env.dir, withTopic(profile, topic, next));
    return { topic, passes: next.passes };
}
//# sourceMappingURL=profile-commands.js.map