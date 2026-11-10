import { type Calibration, type ClaimOutcome, type Diagnosis } from "../internal/reconcile.js";
import { type CatalogEntry, type Level, type TopicId } from "../internal/schema.js";
import type { CatalogFile } from "../internal/catalog-file.js";
import type { Profile, TopicProfile } from "../internal/state-schema.js";
import { type ParsedArgs } from "./args.js";
import { type CommandEnv } from "./env.js";
/**
 * One topic as printed by `get-profile`.
 *
 * @example
 * ```ts
 * import type { TopicView } from "./profile-commands.js";
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
 * import { getProfile, type ProfileView } from "./profile-commands.js";
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
export declare function getProfile(env: CommandEnv): Promise<ProfileView>;
/**
 * The output of `recompute`.
 *
 * @example
 * ```ts
 * import { recompute, type RecomputeView } from "./profile-commands.js";
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
 * `claimedLevel` is given. Reads evidence; writes nothing: the caller saves
 * the returned profile once.
 *
 * Known limitation: only the evidence tail window `readEvidence` returns
 * (its default `maxEvents`) is read, so a topic's oldest events can fall out
 * of it on a long history.
 *
 * @example
 * ```ts
 * import { recomputeTopic } from "./profile-commands.js";
 * const { profile, view } = await recomputeTopic(env, file, entry, stored);
 * await saveProfile(env.dir, profile);
 * ```
 */
export declare function recomputeTopic(env: CommandEnv, file: CatalogFile, entry: CatalogEntry, profile: Profile, claimedLevel?: Level): Promise<{
    readonly profile: Profile;
    readonly view: RecomputeView;
    readonly passes: number;
}>;
/**
 * The optional `--claim` value as a Level.
 *
 * @throws CliUsageError when `--claim` is given but is not a Level.
 *
 * @example
 * ```ts
 * import { optionalClaim } from "./profile-commands.js";
 * const claimed = optionalClaim(args); // undefined without --claim
 * ```
 */
export declare function optionalClaim(args: ParsedArgs): Level | undefined;
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
export declare function recompute(args: ParsedArgs, env: CommandEnv): Promise<RecomputeView>;
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
export declare function introduce(args: ParsedArgs, env: CommandEnv): Promise<{
    readonly topic: TopicId;
    readonly level: Level;
}>;
/**
 * `profile` with one spaced-review result applied to `topic`: a pass
 * increments `passes` and stamps `lastPassAt = now`; a fail resets
 * `passes` to 0 and leaves `lastPassAt` alone. A topic the profile lacks
 * starts as Unseen and not introduced. Pure; returns the updated profile and
 * the topic's new `passes`.
 *
 * @example
 * ```ts
 * import { applyPass } from "./profile-commands.js";
 * const { profile: next, passes } = applyPass(profile, topic, "pass", Date.now());
 * ```
 */
export declare function applyPass(profile: Profile, topic: TopicId, result: "pass" | "fail", now: number): {
    readonly profile: Profile;
    readonly passes: number;
};
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
export declare function recordPass(args: ParsedArgs, env: CommandEnv): Promise<{
    readonly topic: TopicId;
    readonly passes: number;
}>;
//# sourceMappingURL=profile-commands.d.ts.map