/**
 * Scoring constants that `catalog.json` may override, with a pure parser that
 * validates them before they reach the mastery scorer.
 */
import { type Channel, type Parsed } from "./schema.js";
/**
 * Optional overrides for the mastery scorer. Each key is present only when
 * configured, so the value can be spread straight into the scorer options
 * (`topicScore` takes `weights`/`halfLifeDays`; `deriveLevel` and
 * `reconcile` take `halfLifeDays`/`fluencySessions`).
 *
 * @example
 * ```ts
 * import type { ScoringConfig } from "./scoring-config.js";
 * const config: ScoringConfig = { halfLifeDays: 30, fluencySessions: 3 };
 * ```
 */
export interface ScoringConfig {
    /** Per-channel weights; `self-report` never exceeds any other channel. */
    readonly weights?: Readonly<Record<Channel, number>>;
    /** Evidence half-life in days; positive and finite in milliseconds. */
    readonly halfLifeDays?: number;
    /** Distinct sessions required for fluency; an integer from 1 to 1000. */
    readonly fluencySessions?: number;
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
export declare function parseScoringConfig(value: unknown): Parsed<ScoringConfig>;
//# sourceMappingURL=scoring-config.d.ts.map