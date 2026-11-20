import { loadBundledTracks } from "../internal/bundled-tracks.ts";
import { DAY_MS } from "../internal/mastery.ts";
import { loadState, saveState } from "../internal/store.ts";
import {
  checkTrackAgainstCatalog,
  type Track,
  type TrackGuide,
} from "../internal/tracks.ts";
import { CliUsageError, type ParsedArgs } from "./args.ts";
import { loadMergedCatalog, lockedState, type CommandEnv } from "./env.ts";
import { findBundledTrack, requireTrackCode } from "./exam-shared.ts";

const REVIEW_STALE_DAYS = 120;

/**
 * One domain of a track as printed by `tracks`.
 *
 * @example
 * ```ts
 * import type { TrackDomainView } from "./exam-track-commands.ts";
 * const d: TrackDomainView = { id: "D1", name: "Agents", weight: 27, objectives: 7 };
 * ```
 */
export interface TrackDomainView {
  readonly id: string;
  readonly name: string;
  readonly weight: number;
  /** How many objectives the domain has. */
  readonly objectives: number;
}

/**
 * One bundled track as printed by `tracks`.
 *
 * @example
 * ```ts
 * import { tracks, type TrackView } from "./exam-track-commands.ts";
 * const rows: readonly TrackView[] = (await tracks(env)).tracks;
 * ```
 */
export interface TrackView {
  readonly code: string;
  readonly title: string;
  readonly tier: Track["tier"];
  readonly assumes: string | null;
  readonly guide: TrackGuide;
  /** The guide's `effective` month or date starts after now. */
  readonly effectiveFuture: boolean;
  /** More than 120 days have passed since the guide's `reviewedAt`. */
  readonly reviewStale: boolean;
  readonly domains: readonly TrackDomainView[];
  /** Mapped topic ids the merged catalog lacks; sorted. */
  readonly unknownTopics: readonly string[];
  /** Ids of objectives with no known, enabled topic; sorted. */
  readonly disabledObjectives: readonly string[];
}

/**
 * The output of `tracks`.
 *
 * @example
 * ```ts
 * import { tracks, type TracksView } from "./exam-track-commands.ts";
 * const { active }: TracksView = await tracks(env);
 * ```
 */
export interface TracksView {
  /** The stored active track code, or `null` when none is set. */
  readonly active: string | null;
  readonly tracks: readonly TrackView[];
}

/** First instant (UTC) of a `YYYY-MM` or `YYYY-MM-DD` value. */
function startOf(effective: string): number {
  return Date.parse(effective.length === 7 ? `${effective}-01` : effective);
}

function trackView(
  track: Track,
  check: ReturnType<typeof checkTrackAgainstCatalog>,
  now: number,
): TrackView {
  return {
    code: track.code,
    title: track.title,
    tier: track.tier,
    assumes: track.assumes,
    guide: { ...track.guide },
    effectiveFuture: startOf(track.guide.effective) > now,
    reviewStale:
      now - Date.parse(track.guide.reviewedAt) > REVIEW_STALE_DAYS * DAY_MS,
    domains: track.domains.map((domain) => ({
      id: domain.id,
      name: domain.name,
      weight: domain.weight,
      objectives: domain.objectives.length,
    })),
    unknownTopics: check.unknownTopics,
    disabledObjectives: check.disabledObjectives,
  };
}

/**
 * `tracks`: every bundled exam track in loader order, each checked against
 * the merged catalog, plus the stored active track. Read-only; never locks.
 *
 * @throws MentorStateError from loading the catalog, the state or the
 * bundled tracks.
 *
 * @example
 * ```ts
 * import { tracks } from "./exam-track-commands.ts";
 * const { active, tracks: rows } = await tracks(env);
 * ```
 */
export async function tracks(env: CommandEnv): Promise<TracksView> {
  const { entries } = await loadMergedCatalog(env);
  const state = await loadState(env.dir, env.now);
  return {
    active: state.activeTrack ?? null,
    tracks: loadBundledTracks().map((track) =>
      trackView(track, checkTrackAgainstCatalog(track, entries), env.now),
    ),
  };
}

/**
 * `set-track --code <code> | --clear`: stores `code` as the active exam
 * track, or removes it, keeping every other state field. The state's load
 * and save run under the data lock ({@link lockedState}).
 *
 * @throws CliUsageError unless exactly one of `--code` and `--clear` is
 * given, or when the code is malformed.
 * @throws MentorStateError `VALIDATION_FAILED` when the code is not a
 * bundled track (nothing is written).
 *
 * @example
 * ```ts
 * import { setTrack } from "./exam-track-commands.ts";
 * const { active } = await setTrack(args, env); // e.g. "CCAR-F"
 * ```
 */
export async function setTrack(
  args: ParsedArgs,
  env: CommandEnv,
): Promise<{ readonly active: string | null }> {
  const clear = args.booleans.has("clear");
  if (clear === args.values.has("code")) throw new CliUsageError();
  const code = clear
    ? undefined
    : findBundledTrack(requireTrackCode(args, "code")).code;
  await lockedState(env, async () => {
    const { activeTrack: _previous, ...rest } = await loadState(
      env.dir,
      env.now,
    );
    await saveState(env.dir, {
      ...rest,
      ...(code !== undefined ? { activeTrack: code } : {}),
    });
  });
  return { active: code ?? null };
}
