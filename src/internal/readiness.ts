/**
 * Exam readiness: a pure, deterministic, I/O-free estimate of how prepared
 * the learner is for one certification {@link Track}, per weighted domain.
 *
 * Each domain blends two signals: **coverage** (the learner's mastery level
 * on the topics its objectives map to) and **accuracy** (the recency-weighted
 * share of correct exam items logged for it). The overall index weights the
 * domains by their exam weight. It is a study aid, never a score prediction:
 * every result carries `notAScorePrediction: true`.
 */
import type { ExamItem } from "./exam-schema.ts";
import { checkFinite, recencyFactor } from "./mastery.ts";
import type { CatalogEntry, Level } from "./schema.ts";
import type { Profile } from "./state-schema.ts";
import type { Track, TrackDomain, TrackObjective } from "./tracks.ts";

/**
 * The coverage credit, from 0 to 1, that a topic at each mastery level earns.
 *
 * @example
 * ```ts
 * import { LEVEL_CREDIT } from "./readiness.ts";
 * LEVEL_CREDIT.Understood; // 0.8
 * ```
 */
export const LEVEL_CREDIT: Readonly<Record<Level, number>> = Object.freeze({
  Unseen: 0,
  Introduced: 0.1,
  Claimed: 0.1,
  Recalled: 0.5,
  Understood: 0.8,
  Applied: 1,
  Fluent: 1,
});

/**
 * The half-life, in days, of an exam item's weight in a domain's accuracy.
 *
 * @example
 * ```ts
 * import { DAY_MS } from "./mastery.ts";
 * import { ITEM_HALF_LIFE_DAYS } from "./readiness.ts";
 * const halfLifeMs = ITEM_HALF_LIFE_DAYS * DAY_MS;
 * ```
 */
export const ITEM_HALF_LIFE_DAYS = 21;

/**
 * The effective (decay-weighted) item count a domain needs before its
 * accuracy enters its mastery; below it the domain is `lowEvidence`.
 *
 * @example
 * ```ts
 * import { MIN_DOMAIN_ITEMS } from "./readiness.ts";
 * const evidenced = (effectiveItems: number) => effectiveItems >= MIN_DOMAIN_ITEMS;
 * ```
 */
export const MIN_DOMAIN_ITEMS = 4;

/**
 * The total effective item count, across all domains, below which readiness
 * reports `insufficient-evidence` instead of an index.
 *
 * @example
 * ```ts
 * import { MIN_TOTAL_ITEMS } from "./readiness.ts";
 * MIN_TOTAL_ITEMS; // 15
 * ```
 */
export const MIN_TOTAL_ITEMS = 15;

/**
 * The exam weight (out of 100) that domains with at least
 * {@link MIN_DOMAIN_ITEMS} effective items must hold together before
 * readiness reports an index.
 *
 * @example
 * ```ts
 * import { MIN_EVIDENCE_WEIGHT_SHARE } from "./readiness.ts";
 * MIN_EVIDENCE_WEIGHT_SHARE; // 60
 * ```
 */
export const MIN_EVIDENCE_WEIGHT_SHARE = 60;

/**
 * The share of an evidenced domain's mastery that comes from accuracy; the
 * rest (`1 - ACCURACY_BLEND`) comes from coverage.
 *
 * @example
 * ```ts
 * import { ACCURACY_BLEND } from "./readiness.ts";
 * const mastery = (accuracy: number, coverage: number) =>
 *   ACCURACY_BLEND * accuracy + (1 - ACCURACY_BLEND) * coverage;
 * ```
 */
export const ACCURACY_BLEND = 0.6;

/**
 * Readiness for one track domain.
 *
 * @example
 * ```ts
 * import type { DomainReadiness } from "./readiness.ts";
 * const gap = (d: DomainReadiness): number => d.weight * (1 - d.mastery);
 * ```
 */
export interface DomainReadiness {
  /** The track domain id, such as `D1`. */
  readonly id: string;
  readonly name: string;
  /** The domain's exam weight, copied unchanged from the track. */
  readonly weight: number;
  /** Mean over the domain's objectives of their best topic credit; 0 to 1. */
  readonly coverage: number;
  /** Decay-weighted share of correct items, 0 to 1; `null` with no items. */
  readonly accuracy: number | null;
  /** The sum of the domain's item decay weights. */
  readonly effectiveItems: number;
  /** `true` when {@link DomainReadiness.effectiveItems} is below {@link MIN_DOMAIN_ITEMS}. */
  readonly lowEvidence: boolean;
  /** The blended (or, with low evidence, coverage-only) mastery; 0 to 1. */
  readonly mastery: number;
}

/**
 * Readiness for a whole track. `index` is present only when `status` is
 * `"ok"`; it is an own key of the object only then.
 *
 * @example
 * ```ts
 * import type { Readiness } from "./readiness.ts";
 * const headline = (r: Readiness): string =>
 *   r.index === undefined ? "not enough evidence yet" : `${String(r.index)}/100`;
 * ```
 */
export interface Readiness {
  /** The track code, such as `CCAR-F`. */
  readonly track: string;
  /** The exam guide this readiness was computed against. */
  readonly guide: { readonly version: string; readonly effective: string };
  readonly status: "ok" | "insufficient-evidence";
  /** An integer from 0 to 100; present only when `status` is `"ok"`. */
  readonly index?: number;
  /** One entry per track domain, in track order. */
  readonly domains: readonly DomainReadiness[];
  /** Up to 3 domain ids, largest `weight * (1 - mastery)` first. */
  readonly weakest: readonly string[];
  /** The sum of every counted item's decay weight. */
  readonly totalEffectiveItems: number;
  /** Always `true`: this is a study aid, never an exam score prediction. */
  readonly notAScorePrediction: true;
}

/**
 * The inputs to {@link computeReadiness}. None of them is mutated.
 *
 * @example
 * ```ts
 * import { defaultProfile } from "./state-schema.ts";
 * import type { ReadinessInput } from "./readiness.ts";
 * declare const base: Omit<ReadinessInput, "profile">;
 * const input: ReadinessInput = { ...base, profile: defaultProfile() };
 * ```
 */
export interface ReadinessInput {
  readonly track: Track;
  /** The merged catalog; only enabled entries earn coverage. */
  readonly catalog: readonly CatalogEntry[];
  /** A topic absent from the profile counts as `Unseen`. */
  readonly profile: Profile;
  /**
   * The exam item log; items of other tracks, unknown domains, or with an
   * objective outside their own domain in the track are ignored.
   */
  readonly items: readonly ExamItem[];
  /** Epoch milliseconds; must be finite. */
  readonly now: number;
}

const WEAKEST_COUNT = 3;
const TOTAL_WEIGHT = 100;

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
}

function topicCredit(
  topic: string,
  enabled: ReadonlySet<string>,
  profile: Profile,
): number {
  if (!enabled.has(topic) || !Object.hasOwn(profile.topics, topic)) return 0;
  const level = profile.topics[topic]?.level;
  return level === undefined ? 0 : LEVEL_CREDIT[level];
}

function objectiveCredit(
  objective: TrackObjective,
  enabled: ReadonlySet<string>,
  profile: Profile,
): number {
  let best = 0;
  for (const topic of objective.topics) {
    best = Math.max(best, topicCredit(topic, enabled, profile));
  }
  return best;
}

interface Tally {
  weight: number;
  correct: number;
}

/**
 * Weights the items by recency per domain. An item is ignored when it
 * belongs to another track, names a domain the track lacks, or names an
 * objective that is not one of its own domain's objectives in the track.
 */
function tallyItems(
  input: ReadinessInput,
  objectivesByDomain: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlyMap<string, Tally> {
  const tallies = new Map<string, Tally>();
  for (const item of input.items) {
    if (
      item.track !== input.track.code ||
      objectivesByDomain.get(item.domain)?.has(item.objective) !== true
    ) {
      continue;
    }
    const w = recencyFactor(input.now - item.at, ITEM_HALF_LIFE_DAYS);
    const tally = tallies.get(item.domain) ?? { weight: 0, correct: 0 };
    tally.weight += w;
    if (item.correct) tally.correct += w;
    tallies.set(item.domain, tally);
  }
  return tallies;
}

function domainReadiness(
  domain: TrackDomain,
  tally: Tally | undefined,
  enabled: ReadonlySet<string>,
  profile: Profile,
): DomainReadiness {
  const credits = domain.objectives.map((o) =>
    objectiveCredit(o, enabled, profile),
  );
  const coverage =
    credits.length === 0
      ? 0
      : clampUnit(credits.reduce((s, c) => s + c, 0) / credits.length);
  const effectiveItems = tally?.weight ?? 0;
  const accuracy =
    tally === undefined || !(effectiveItems > 0)
      ? null
      : clampUnit(tally.correct / effectiveItems);
  const lowEvidence = !(effectiveItems >= MIN_DOMAIN_ITEMS);
  const mastery =
    lowEvidence || accuracy === null
      ? coverage
      : clampUnit(ACCURACY_BLEND * accuracy + (1 - ACCURACY_BLEND) * coverage);
  return {
    id: domain.id,
    name: domain.name,
    weight: domain.weight,
    coverage,
    accuracy,
    effectiveItems,
    lowEvidence,
    mastery,
  };
}

function weakestDomains(domains: readonly DomainReadiness[]): string[] {
  return domains
    .map((d, order) => ({ id: d.id, order, gap: d.weight * (1 - d.mastery) }))
    .sort((a, b) => b.gap - a.gap || a.order - b.order)
    .slice(0, WEAKEST_COUNT)
    .map((d) => d.id);
}

/**
 * Computes the learner's readiness for `input.track`.
 *
 * Per domain: coverage is the mean, over its objectives, of the best
 * {@link LEVEL_CREDIT} among each objective's enabled catalog topics. Each of
 * the track's items for a known domain weighs `0.5 ** (age / 21 days)` (a
 * future item weighs 1); accuracy is the weighted share of correct items. A
 * domain with at least {@link MIN_DOMAIN_ITEMS} effective items has mastery
 * `0.6 * accuracy + 0.4 * coverage`; otherwise its mastery is its coverage
 * and it is flagged `lowEvidence`.
 *
 * The status is `"insufficient-evidence"` (with no `index` key) when the
 * total effective items fall below {@link MIN_TOTAL_ITEMS} or the evidenced
 * domains hold less than {@link MIN_EVIDENCE_WEIGHT_SHARE} of the weight;
 * otherwise `index` is `round(Σ weight * mastery)`, from 0 to 100. `weakest`
 * is reported either way, ties broken by track order.
 *
 * @throws RangeError when `input.now` is not finite.
 *
 * @example
 * ```ts
 * import { loadBundledCatalog } from "./bundled-catalog.ts";
 * import { loadBundledTracks } from "./bundled-tracks.ts";
 * import { computeReadiness } from "./readiness.ts";
 * import { defaultProfile } from "./state-schema.ts";
 * const track = loadBundledTracks()[0];
 * if (track !== undefined) {
 *   const r = computeReadiness({
 *     track,
 *     catalog: await loadBundledCatalog(),
 *     profile: defaultProfile(),
 *     items: [],
 *     now: Date.now(),
 *   });
 *   r.status; // "insufficient-evidence"
 * }
 * ```
 */
export function computeReadiness(input: ReadinessInput): Readiness {
  checkFinite("now", input.now);
  const { track, profile } = input;
  const enabled: ReadonlySet<string> = new Set(
    input.catalog.filter((e) => e.enabled).map((e) => e.id),
  );
  const tallies = tallyItems(
    input,
    new Map(
      track.domains.map((d) => [d.id, new Set(d.objectives.map((o) => o.id))]),
    ),
  );
  const domains = track.domains.map((d) =>
    domainReadiness(d, tallies.get(d.id), enabled, profile),
  );

  let totalEffectiveItems = 0;
  let evidencedWeight = 0;
  let weighted = 0;
  for (const d of domains) {
    totalEffectiveItems += d.effectiveItems;
    if (!d.lowEvidence) evidencedWeight += d.weight;
    weighted += d.weight * d.mastery;
  }
  const ok =
    totalEffectiveItems >= MIN_TOTAL_ITEMS &&
    evidencedWeight >= MIN_EVIDENCE_WEIGHT_SHARE;
  const index = Math.min(Math.max(Math.round(weighted), 0), TOTAL_WEIGHT);

  return {
    track: track.code,
    guide: { version: track.guide.version, effective: track.guide.effective },
    status: ok ? "ok" : "insufficient-evidence",
    ...(ok ? { index } : {}),
    domains,
    weakest: weakestDomains(domains),
    totalEffectiveItems,
    notAScorePrediction: true,
  };
}
