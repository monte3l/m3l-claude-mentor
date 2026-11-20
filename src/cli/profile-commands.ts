import { isReviewDue } from "../internal/mastery.ts";
import {
  calibrationScore,
  reconcile,
  updateCalibration,
  type Calibration,
  type ClaimOutcome,
  type Diagnosis,
} from "../internal/reconcile.ts";
import {
  compareLevels,
  LEVELS,
  type CatalogEntry,
  type Level,
  type TopicId,
} from "../internal/schema.ts";
import type { CatalogFile } from "../internal/catalog-file.ts";
import type { Profile, TopicProfile } from "../internal/state-schema.ts";
import {
  loadProfile,
  loadState,
  readEvidence,
  saveProfile,
} from "../internal/store.ts";
import { loadBundledTracks } from "../internal/bundled-tracks.ts";
import { trackTopicWeights } from "../internal/track-weights.ts";
import { excludeVoidedEvidence } from "../internal/voids.ts";
import { requireOneOf, requireTopicId, type ParsedArgs } from "./args.ts";
import {
  loadMergedCatalog,
  lockedState,
  requireCatalogEntry,
  type CommandEnv,
} from "./env.ts";

const UNSEEN_TOPIC: TopicProfile = {
  introduced: false,
  level: "Unseen",
  lastPassAt: null,
  passes: 0,
};

function existingTopic(
  profile: Profile,
  topic: TopicId,
): TopicProfile | undefined {
  return Object.hasOwn(profile.topics, topic)
    ? profile.topics[topic]
    : undefined;
}

function withTopic(
  profile: Profile,
  topic: TopicId,
  value: TopicProfile,
): Profile {
  return { ...profile, topics: { ...profile.topics, [topic]: value } };
}

/**
 * One topic as printed by `get-profile`.
 *
 * @example
 * ```ts
 * import type { TopicView } from "./profile-commands.ts";
 * const view: TopicView = {
 *   id: "plan-mode",
 *   level: "Introduced",
 *   introduced: true,
 *   passes: 0,
 *   lastPassAt: null,
 *   reviewDue: false,
 * };
 * ```
 */
export interface TopicView extends TopicProfile {
  readonly id: string;
  readonly reviewDue: boolean;
}

/**
 * The output of `get-profile`.
 *
 * @example
 * ```ts
 * import { getProfile, type ProfileView } from "./profile-commands.ts";
 * const view: ProfileView = await getProfile(env);
 * ```
 */
export interface ProfileView {
  readonly topics: readonly TopicView[];
  readonly calibration: Calibration;
  readonly calibrationScore: number;
  readonly muted: boolean;
  readonly mutedTopics: readonly string[];
  readonly excludedProjects: readonly string[];
  /** The last changelog version shown, or `null` when none was recorded. */
  readonly lastChangelogVersion: string | null;
  /** The stored active exam track code, or `null` when none is set. */
  readonly activeTrack: string | null;
  /**
   * Each topic's exam weight in the active track (see `trackTopicWeights`
   * in `../internal/track-weights.ts`); `{}` when no track is active or the stored code
   * is no longer a bundled track.
   */
  readonly activeTrackTopics: Readonly<Record<string, number>>;
}

function activeTrackTopics(
  activeTrack: string | undefined,
): Readonly<Record<string, number>> {
  if (activeTrack === undefined) return {};
  const track = loadBundledTracks().find((t) => t.code === activeTrack);
  return track === undefined ? {} : trackTopicWeights(track);
}

/**
 * `get-profile`: the stored profile merged with the state's mute and
 * exclusion settings, last changelog version and active exam track (with
 * its per-topic exam weights); topics sorted by id. The
 * merged catalog is loaded so that a `catalog.json` that no longer merges
 * is reported.
 *
 * @example
 * ```ts
 * import { getProfile } from "./profile-commands.ts";
 * const { topics } = await getProfile(env);
 * ```
 */
export async function getProfile(env: CommandEnv): Promise<ProfileView> {
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
      reviewDue:
        topic.lastPassAt !== null &&
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
    activeTrack: state.activeTrack ?? null,
    activeTrackTopics: activeTrackTopics(state.activeTrack),
  };
}

/**
 * The output of `recompute`.
 *
 * @example
 * ```ts
 * import { recompute, type RecomputeView } from "./profile-commands.ts";
 * const view: RecomputeView = await recompute(args, env);
 * ```
 */
export interface RecomputeView {
  readonly topic: TopicId;
  readonly level: Level;
  readonly previousLevel: Level;
  readonly claim: ClaimOutcome;
  readonly diagnoses: readonly Diagnosis[];
  /** Malformed evidence lines skipped while reading (never echoed). */
  readonly evidenceSkipped: number;
}

/**
 * Re-derives `entry`'s level from its evidence with the catalog's scoring
 * overrides and returns `profile` updated with it (keeping the topic's
 * `introduced`, `passes` and `lastPassAt`), the `recompute` view, and the
 * topic's stored `passes`.
 * The calibration counts a `confirmed` or `refuted` outcome only when
 * `claimedLevel` is given. Quiz evidence of a voided exam submission
 * (`state.json` `voidedExams`) is not counted. Reads evidence and the state;
 * writes nothing: the caller saves the returned profile once.
 *
 * Known limitation: only the evidence tail window `readEvidence` returns
 * (its default `maxEvents`) is read, so a topic's oldest events can fall out
 * of it on a long history.
 *
 * @throws MentorStateError when `state.json` cannot be read or is invalid
 * (it is read for its void list): the recompute fails closed rather than
 * counting voided evidence.
 *
 * @example
 * ```ts
 * import { recomputeTopic } from "./profile-commands.ts";
 * const { profile, view } = await recomputeTopic(env, file, entry, stored);
 * await saveProfile(env.dir, profile);
 * ```
 */
export async function recomputeTopic(
  env: CommandEnv,
  file: CatalogFile,
  entry: CatalogEntry,
  profile: Profile,
  claimedLevel?: Level,
): Promise<{
  readonly profile: Profile;
  readonly view: RecomputeView;
  readonly passes: number;
}> {
  const topic = entry.id;
  const { halfLifeDays, fluencySessions } = file.scoring;
  const { events, skipped } = await readEvidence(env.dir);
  const { voidedExams = [] } = await loadState(env.dir, env.now);
  const counted = excludeVoidedEvidence(events, voidedExams);
  const previous = existingTopic(profile, topic) ?? UNSEEN_TOPIC;
  const result = reconcile({
    type: entry.type,
    events: counted.filter((event) => event.topic === topic),
    introduced: previous.introduced,
    now: env.now,
    ...(claimedLevel !== undefined ? { claimedLevel } : {}),
    ...(halfLifeDays !== undefined ? { halfLifeDays } : {}),
    ...(fluencySessions !== undefined ? { fluencySessions } : {}),
  });
  const calibration =
    claimedLevel === undefined
      ? profile.calibration
      : updateCalibration(profile.calibration, result.claim);
  return {
    profile: {
      ...withTopic(profile, topic, { ...previous, level: result.level }),
      calibration,
    },
    view: {
      topic,
      level: result.level,
      previousLevel: previous.level,
      claim: result.claim,
      diagnoses: result.diagnoses,
      evidenceSkipped: skipped,
    },
    passes: previous.passes,
  };
}

/**
 * The optional `--claim` value as a Level.
 *
 * @throws CliUsageError when `--claim` is given but is not a Level.
 *
 * @example
 * ```ts
 * import { optionalClaim } from "./profile-commands.ts";
 * const claimed = optionalClaim(args); // undefined without --claim
 * ```
 */
export function optionalClaim(args: ParsedArgs): Level | undefined {
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
 * of it on a long history. The profile's load, recompute and save run under
 * the data lock ({@link lockedState}), so a concurrent writer cannot
 * interleave.
 * The catalog is read before the data lock, so a concurrent
 * `set-topic-override` or import can change it in between; the next
 * `recompute` repairs any effect on the level.
 *
 * @throws CliUsageError for a malformed or unknown topic or a bad claim.
 * @throws MentorStateError when `state.json` cannot be read or is invalid
 * (its void list is needed): `recompute` fails closed rather than counting
 * voided evidence.
 *
 * @example
 * ```ts
 * import { recompute } from "./profile-commands.ts";
 * const { level, claim } = await recompute(args, env);
 * ```
 */
export async function recompute(
  args: ParsedArgs,
  env: CommandEnv,
): Promise<RecomputeView> {
  const topic = requireTopicId(args);
  const claimedLevel = optionalClaim(args);
  const { file, entries } = await loadMergedCatalog(env);
  const entry = requireCatalogEntry(entries, topic);
  return lockedState(env, async () => {
    const stored = await loadProfile(env.dir, env.now);
    const { profile, view } = await recomputeTopic(
      env,
      file,
      entry,
      stored,
      claimedLevel,
    );
    await saveProfile(env.dir, profile);
    return view;
  });
}

/**
 * `introduce --topic <id>`: marks the topic introduced, raising its level to
 * `Introduced` when it is lower and never lowering it. The profile's load
 * and save run under the data lock ({@link lockedState}).
 * The catalog is read before the data lock, so a concurrent
 * `set-topic-override` or import can change it in between; the next
 * `recompute` repairs any effect on the level.
 *
 * @throws CliUsageError for a malformed or unknown topic.
 *
 * @example
 * ```ts
 * import { introduce } from "./profile-commands.ts";
 * const { level } = await introduce(args, env);
 * ```
 */
export async function introduce(
  args: ParsedArgs,
  env: CommandEnv,
): Promise<{ readonly topic: TopicId; readonly level: Level }> {
  const topic = requireTopicId(args);
  const { entries } = await loadMergedCatalog(env);
  requireCatalogEntry(entries, topic);
  const level = await lockedState(env, async () => {
    const profile = await loadProfile(env.dir, env.now);
    const previous = existingTopic(profile, topic) ?? UNSEEN_TOPIC;
    const raised: Level =
      compareLevels(previous.level, "Introduced") >= 0
        ? previous.level
        : "Introduced";
    await saveProfile(
      env.dir,
      withTopic(profile, topic, {
        ...previous,
        introduced: true,
        level: raised,
      }),
    );
    return raised;
  });
  return { topic, level };
}

/**
 * `profile` with one spaced-review result applied to `topic`: a pass
 * increments `passes` and stamps `lastPassAt = now`; a fail resets
 * `passes` to 0 and leaves `lastPassAt` alone. A topic the profile lacks
 * starts as Unseen and not introduced. Pure; returns the updated profile and
 * the topic's new `passes`.
 *
 * @example
 * ```ts
 * import { applyPass } from "./profile-commands.ts";
 * const { profile: next, passes } = applyPass(profile, topic, "pass", Date.now());
 * ```
 */
export function applyPass(
  profile: Profile,
  topic: TopicId,
  result: "pass" | "fail",
  now: number,
): { readonly profile: Profile; readonly passes: number } {
  const previous = existingTopic(profile, topic) ?? UNSEEN_TOPIC;
  const next: TopicProfile =
    result === "pass"
      ? { ...previous, passes: previous.passes + 1, lastPassAt: now }
      : { ...previous, passes: 0 };
  return { profile: withTopic(profile, topic, next), passes: next.passes };
}

/**
 * `record-pass --topic <id> --result <pass|fail>`: a pass increments
 * `passes` and stamps `lastPassAt = now`; a fail resets `passes` to 0 and
 * leaves `lastPassAt` alone. The profile's load and save run under the
 * data lock ({@link lockedState}).
 * The catalog is read before the data lock, so a concurrent
 * `set-topic-override` or import can change it in between; the next
 * `recompute` repairs any effect on the level.
 *
 * @throws CliUsageError for a malformed or unknown topic or a bad result.
 *
 * @example
 * ```ts
 * import { recordPass } from "./profile-commands.ts";
 * const { passes } = await recordPass(args, env);
 * ```
 */
export async function recordPass(
  args: ParsedArgs,
  env: CommandEnv,
): Promise<{ readonly topic: TopicId; readonly passes: number }> {
  const topic = requireTopicId(args);
  const result = requireOneOf(args, "result", ["pass", "fail"] as const);
  const { entries } = await loadMergedCatalog(env);
  requireCatalogEntry(entries, topic);
  const passes = await lockedState(env, async () => {
    const { profile, passes: next } = applyPass(
      await loadProfile(env.dir, env.now),
      topic,
      result,
      env.now,
    );
    await saveProfile(env.dir, profile);
    return next;
  });
  return { topic, passes };
}
