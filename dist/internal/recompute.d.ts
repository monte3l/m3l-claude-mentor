import { type CatalogEntry, type Evidence, type TopicId } from "./schema.js";
import { type Profile } from "./state-schema.js";
/**
 * The scoring overrides {@link recomputeProfile} honours (a subset of the
 * `catalog.json` `scoring` object); an absent field keeps the default.
 *
 * @example
 * ```ts
 * import type { RecomputeScoring } from "./recompute.js";
 * const scoring: RecomputeScoring = { halfLifeDays: 60 };
 * ```
 */
export interface RecomputeScoring {
    /** Evidence half-life in days. */
    readonly halfLifeDays?: number;
    /** Distinct sessions required for fluency. */
    readonly fluencySessions?: number;
}
/**
 * Input to {@link recomputeProfile}.
 *
 * @example
 * ```ts
 * import type { RecomputeInput } from "./recompute.js";
 * import { defaultProfile } from "./state-schema.js";
 * const input: RecomputeInput = {
 *   profile: defaultProfile(),
 *   events: [],
 *   catalog: [],
 *   scoring: {},
 *   now: Date.now(),
 * };
 * ```
 */
export interface RecomputeInput {
    /** The stored profile; never mutated. */
    readonly profile: Profile;
    /** Evidence for any topics, in file order (oldest first). */
    readonly events: readonly Evidence[];
    /** The merged catalog; disabled entries are skipped. */
    readonly catalog: readonly CatalogEntry[];
    /** Scoring overrides; may be `{}`. */
    readonly scoring: RecomputeScoring;
    /** The current time in epoch milliseconds; finite and non-negative. */
    readonly now: number;
    /**
     * When `true`, an existing entry is only ever raised: a derived level at
     * or below the stored one leaves the entry untouched. Default `false`
     * (the stored level follows the evidence both ways).
     */
    readonly raiseOnly?: boolean;
}
/**
 * The result of {@link recomputeProfile}.
 *
 * @example
 * ```ts
 * import { recomputeProfile, type RecomputeOutcome } from "./recompute.js";
 * const outcome: RecomputeOutcome = recomputeProfile(input);
 * if (outcome.changed.length > 0) {
 *   // persist outcome.profile
 * }
 * ```
 */
export interface RecomputeOutcome {
    /** The updated profile; the input object itself when nothing changed. */
    readonly profile: Profile;
    /** Topics whose level changed or that gained an entry, in catalog order. */
    readonly changed: readonly TopicId[];
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
export declare function recomputeProfile(input: RecomputeInput): RecomputeOutcome;
//# sourceMappingURL=recompute.d.ts.map