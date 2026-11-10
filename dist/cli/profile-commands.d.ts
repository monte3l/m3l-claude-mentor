import { type Calibration, type ClaimOutcome, type Diagnosis } from "../internal/reconcile.js";
import { type Level, type TopicId } from "../internal/schema.js";
import type { TopicProfile } from "../internal/state-schema.js";
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