import type { ExamItem } from "../internal/exam-schema.ts";
import { readExamItems } from "../internal/exam-store.ts";
import { computeReadiness, type Readiness } from "../internal/readiness.ts";
import { loadProfile, loadState } from "../internal/store.ts";
import type { Track } from "../internal/tracks.ts";
import type { ParsedArgs } from "./args.ts";
import { loadMergedCatalog, type CommandEnv } from "./env.ts";
import { optionalLimit, resolveTrack } from "./exam-shared.ts";

/**
 * `readiness [--track <code>]`: the exam readiness of the track named by
 * `--track`, or of the stored active track, computed over the stored
 * profile, the merged catalog and the exam item log. Read-only; never
 * locks. The result is the {@link Readiness} object unchanged, so `index`
 * is absent when evidence is insufficient.
 *
 * @throws CliUsageError when `--track` is malformed.
 * @throws MentorStateError `VALIDATION_FAILED` when the code is not a
 * bundled track, or `--track` is absent and there is no active track or it
 * is no longer bundled; whatever loading the state, catalog, profile or log throws.
 *
 * @example
 * ```ts
 * import { readiness } from "./exam-report-commands.ts";
 * const { status, index } = await readiness(args, env);
 * ```
 */
export async function readiness(
  args: ParsedArgs,
  env: CommandEnv,
): Promise<Readiness> {
  const state = await loadState(env.dir, env.now);
  const track = resolveTrack(args, state.activeTrack);
  const { entries } = await loadMergedCatalog(env);
  const profile = await loadProfile(env.dir, env.now);
  const { items } = await readExamItems(env.dir);
  return computeReadiness({
    track,
    catalog: entries,
    profile,
    items,
    now: env.now,
  });
}

/**
 * Raw item counts for one objective, as printed by `exam-items`.
 *
 * @example
 * ```ts
 * import type { ObjectiveItemsView } from "./exam-report-commands.ts";
 * const o: ObjectiveItemsView = { id: "D1.1", items: 4, correct: 3 };
 * ```
 */
export interface ObjectiveItemsView {
  readonly id: string;
  readonly items: number;
  readonly correct: number;
}

/**
 * Raw item counts for one domain, as printed by `exam-items`.
 *
 * @example
 * ```ts
 * import type { DomainItemsView } from "./exam-report-commands.ts";
 * const d: DomainItemsView = {
 *   id: "D2", name: "Tools", weight: 18, items: 0, correct: 0,
 *   lastAt: null, objectives: [],
 * };
 * ```
 */
export interface DomainItemsView {
  readonly id: string;
  readonly name: string;
  readonly weight: number;
  readonly items: number;
  readonly correct: number;
  /** The newest counted item's `at`, or `null` when the domain has none. */
  readonly lastAt: number | null;
  /** Every objective of the domain, in track order, zeros included. */
  readonly objectives: readonly ObjectiveItemsView[];
}

/**
 * The output of `exam-items`.
 *
 * @example
 * ```ts
 * import type { ExamItemsView } from "./exam-report-commands.ts";
 * const empty: ExamItemsView = { track: "CCAR-F", total: 0, domains: [] };
 * ```
 */
export interface ExamItemsView {
  readonly track: string;
  /** How many items were counted (this track, known domain and objective). */
  readonly total: number;
  /** Every track domain, in track order. */
  readonly domains: readonly DomainItemsView[];
}

interface Tally {
  items: number;
  correct: number;
}

function countItems(track: Track, items: readonly ExamItem[]): ExamItemsView {
  const tallies = new Map<string, Tally>();
  const lastAt = new Map<string, number>();
  const tally = (key: string, correct: boolean): void => {
    const current = tallies.get(key) ?? { items: 0, correct: 0 };
    current.items += 1;
    if (correct) current.correct += 1;
    tallies.set(key, current);
  };
  let total = 0;
  for (const item of items) {
    if (item.track !== track.code) continue;
    const domain = track.domains.find((d) => d.id === item.domain);
    if (!domain?.objectives.some((o) => o.id === item.objective)) continue;
    total += 1;
    tally(`d:${domain.id}`, item.correct);
    tally(`o:${item.objective}`, item.correct);
    lastAt.set(domain.id, Math.max(lastAt.get(domain.id) ?? 0, item.at));
  }
  const counts = (key: string): Tally => {
    const found = tallies.get(key);
    return { items: found?.items ?? 0, correct: found?.correct ?? 0 };
  };
  return {
    track: track.code,
    total,
    domains: track.domains.map((domain) => ({
      id: domain.id,
      name: domain.name,
      weight: domain.weight,
      ...counts(`d:${domain.id}`),
      lastAt: lastAt.get(domain.id) ?? null,
      objectives: domain.objectives.map((objective) => ({
        id: objective.id,
        ...counts(`o:${objective.id}`),
      })),
    })),
  };
}

/**
 * `exam-items [--track <code>] [--limit <n>]`: raw per-domain and
 * per-objective item counts (no decay, no per-day cap) for the track named
 * by `--track` or the stored active track, over at most the newest `n` log
 * items. Items of other tracks, or whose domain or objective the track
 * lacks, are not counted. Read-only; never locks.
 *
 * @throws CliUsageError when `--track` is malformed, or `--limit` is not an
 * integer from 1 to 5000.
 * @throws MentorStateError `VALIDATION_FAILED` when the code is not a
 * bundled track, or `--track` is absent and there is no active track or it
 * is no longer bundled; whatever loading the state or the log throws.
 *
 * @example
 * ```ts
 * import { examItems } from "./exam-report-commands.ts";
 * const { total, domains } = await examItems(args, env);
 * ```
 */
export async function examItems(
  args: ParsedArgs,
  env: CommandEnv,
): Promise<ExamItemsView> {
  const limit = optionalLimit(args);
  const state = await loadState(env.dir, env.now);
  const track = resolveTrack(args, state.activeTrack);
  const { items } = await readExamItems(
    env.dir,
    limit !== undefined ? { maxItems: limit } : undefined,
  );
  return countItems(track, items);
}
