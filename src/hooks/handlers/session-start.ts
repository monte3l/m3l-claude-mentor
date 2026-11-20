/**
 * The SessionStart hook: re-derives evidenced topic levels, then gives the
 * model a compact summary of the learner's state at session start and after
 * compaction. It writes only `profile.json`, and only when a level is
 * raised; it never lowers a level (the explicit `recompute` CLI command
 * does) and never writes `state.json`.
 */
import { loadBundledTracks } from "../../internal/bundled-tracks.ts";
import { isUnprompted } from "../../internal/catalog.ts";
import { isLockTimeout, withStateLock } from "../../internal/lock.ts";
import { isReviewDue } from "../../internal/mastery.ts";
import { recomputeProfile } from "../../internal/recompute.ts";
import {
  levelRank,
  type CatalogEntry,
  type Level,
} from "../../internal/schema.ts";
import type { MentorState, Profile } from "../../internal/state-schema.ts";
import {
  loadCatalogFile,
  loadGoals,
  loadProfile,
  loadState,
  readEvidence,
  saveProfile,
} from "../../internal/store.ts";
import { trackTopicWeights } from "../../internal/track-weights.ts";
import { excludeVoidedEvidence } from "../../internal/voids.ts";
import { payloadField, payloadSession } from "../common.ts";
import { describeError, type HookDeps, type HookHandler } from "../runtime.ts";

const MAX_SUMMARY_CHARS = 2_000;
const MAX_BELOW_TARGET = 8;
const MAX_REVIEWS = 5;
const MAX_GOALS_CHARS = 400;
const CLOSING_LINE =
  "Use /m3l-claude-mentor:profile to see or change settings.";

/** Whether the summary follows a compaction (else it is a session start). */
function isCompact(payload: Readonly<Record<string, unknown>>): boolean {
  return payloadField(payload, "source") === "compact";
}

/** The first `max` UTF-16 units of `text`, never splitting a surrogate pair. */
function headOf(text: string, max: number): string {
  if (text.length <= max) return text;
  let head = text.slice(0, max);
  const last = head.charCodeAt(head.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) head = head.slice(0, -1);
  return head;
}

/** The profile entry of topic `id`, or `undefined` when it has none. */
function topicOf(
  profile: Profile,
  id: string,
): Profile["topics"][string] | undefined {
  return Object.hasOwn(profile.topics, id) ? profile.topics[id] : undefined;
}

/**
 * Up to {@link MAX_BELOW_TARGET} `<id>: <level> (target <target>)` lines for
 * the topics below target: every `ranked` one first, in the given order,
 * then the `others` that were touched (introduced or above Unseen), then
 * the Unseen `others`, each of those two groups in catalog order.
 */
function belowTargetLines(
  ranked: readonly CatalogEntry[],
  others: readonly CatalogEntry[],
  profile: Profile,
): string[] {
  const first: string[] = [];
  const touched: string[] = [];
  const untouched: string[] = [];
  const add = (entry: CatalogEntry, isRanked: boolean): void => {
    const topic = topicOf(profile, entry.id);
    const level: Level = topic?.level ?? "Unseen";
    if (levelRank(level) >= levelRank(entry.targetLevel)) return;
    const line = `${entry.id}: ${level} (target ${entry.targetLevel})`;
    if (isRanked) first.push(line);
    else if (topic?.introduced === true || levelRank(level) > 0) {
      touched.push(line);
    } else untouched.push(line);
  };
  for (const entry of ranked) add(entry, true);
  for (const entry of others) add(entry, false);
  return [...first, ...touched, ...untouched].slice(0, MAX_BELOW_TARGET);
}

/** Up to {@link MAX_REVIEWS} `review due: <id>` lines, in `entries` order. */
function reviewLines(
  entries: readonly CatalogEntry[],
  profile: Profile,
  now: number,
): string[] {
  const lines: string[] = [];
  for (const entry of entries) {
    if (lines.length >= MAX_REVIEWS) break;
    const topic = topicOf(profile, entry.id);
    if (topic === undefined || topic.lastPassAt === null) continue;
    if (isReviewDue(topic.lastPassAt, topic.passes, now)) {
      lines.push(`review due: ${entry.id}`);
    }
  }
  return lines;
}

/** The active exam track's code and its eligible topics, weight-ranked. */
interface TrackFocus {
  readonly code: string;
  readonly ranked: readonly CatalogEntry[];
}

/** The track focus, if any, and a note when the tracks failed to load. */
interface FocusResult {
  readonly focus?: TrackFocus;
  readonly note?: string;
}

/**
 * The active exam track's focus, or no focus when `state.activeTrack` is
 * unset or names a track that is no longer bundled. `ranked` holds the
 * enabled, unmuted catalog topics the track maps (`ambient: false` ones
 * included), by exam weight descending, then catalog order. A failure to
 * load the bundled tracks degrades to no focus and is reported as a `note`
 * (via `describeError`, so no stored data leaks), never dropped.
 */
function trackFocus(
  state: MentorState,
  catalog: readonly CatalogEntry[],
  muted: ReadonlySet<string>,
): FocusResult {
  const code = state.activeTrack;
  if (code === undefined) return {};
  let tracks: ReturnType<typeof loadBundledTracks>;
  try {
    tracks = loadBundledTracks();
  } catch (error) {
    return { note: describeError(error) };
  }
  const track = tracks.find((t) => t.code === code);
  if (track === undefined) return {};
  const weights = new Map(Object.entries(trackTopicWeights(track)));
  const weighted = catalog.flatMap((entry) => {
    const weight = weights.get(entry.id);
    return entry.enabled && !muted.has(entry.id) && weight !== undefined
      ? [{ entry, weight }]
      : [];
  });
  // Array#sort is stable, so equal weights keep catalog order.
  weighted.sort((a, b) => b.weight - a.weight);
  return { focus: { code, ranked: weighted.map(({ entry }) => entry) } };
}

/**
 * Merges the notes of independent degradations into one `note`: the
 * defined ones, in the order given, joined with `"; "`; `undefined` when
 * none is defined.
 */
function mergeNotes(
  ...notes: readonly (string | undefined)[]
): string | undefined {
  const defined = notes.filter((n): n is string => n !== undefined);
  return defined.length === 0 ? undefined : defined.join("; ");
}

/**
 * Joins the fixed head, the droppable topic lines and the fixed tail,
 * dropping topic lines from the end until the text fits
 * {@link MAX_SUMMARY_CHARS}, so no line is ever cut.
 */
function fit(
  head: readonly string[],
  topics: readonly string[],
  tail: readonly string[],
): string {
  const kept = [...topics];
  let text = [...head, ...kept, ...tail].join("\n");
  while (text.length > MAX_SUMMARY_CHARS && kept.length > 0) {
    kept.pop();
    text = [...head, ...kept, ...tail].join("\n");
  }
  return text;
}

/** The profile to summarize, and a note when the refresh had to be skipped. */
interface Refreshed {
  readonly profile: Profile;
  readonly note?: string;
}

/** The `catalog.json` scoring overrides, in `recomputeProfile`'s shape. */
async function scoringOf(
  dir: string,
): Promise<{ halfLifeDays?: number; fluencySessions?: number }> {
  const { halfLifeDays, fluencySessions } = (await loadCatalogFile(dir))
    .scoring;
  return {
    ...(halfLifeDays !== undefined ? { halfLifeDays } : {}),
    ...(fluencySessions !== undefined ? { fluencySessions } : {}),
  };
}

/**
 * Raise-only recompute of `profile` from the evidence now stored, without
 * the quiz evidence of voided exam submissions (`state.json` `voidedExams`).
 */
async function raised(
  deps: HookDeps,
  profile: Profile,
  scoring: { halfLifeDays?: number; fluencySessions?: number },
): Promise<ReturnType<typeof recomputeProfile>> {
  const { events } = await readEvidence(deps.dir);
  const { voidedExams = [] } = await loadState(deps.dir, deps.now);
  return recomputeProfile({
    profile,
    events: excludeVoidedEvidence(events, voidedExams),
    catalog: deps.catalog,
    scoring,
    now: deps.now,
    raiseOnly: true,
  });
}

/**
 * Loads the profile and re-derives every evidenced topic's level with the
 * `catalog.json` scoring overrides, RAISE-ONLY: a level is raised (or a
 * topic gains an entry) but never lowered, since a truncated or decayed
 * evidence window must not undo a level the learner earned. With no
 * evidence nothing else is read and nothing is written.
 *
 * Optimistic: the recompute first runs without the lock, and only when it
 * would raise something is the data lock taken; then the profile and the
 * evidence are re-read (the locked read is authoritative), recomputed
 * (raise-only, so repeating it is harmless) and saved. The scoring settings
 * and `deps.catalog` are read before the lock and reused inside it, so a
 * concurrent catalog edit is seen at the next event. With nothing to change
 * no lock is taken and nothing waits. On `LOCK_TIMEOUT` (by code; any other
 * error propagates) the profile as loaded is returned unrefreshed, with a
 * `note`, so the context is still injected; nothing is written.
 */
async function refreshedProfile(deps: HookDeps): Promise<Refreshed> {
  const profile = await loadProfile(deps.dir, deps.now);
  const { events } = await readEvidence(deps.dir);
  if (events.length === 0) return { profile };
  const scoring = await scoringOf(deps.dir);
  const outcome = await raised(deps, profile, scoring);
  if (outcome.changed.length === 0) return { profile: outcome.profile };
  try {
    const saved = await withStateLock(
      deps.dir,
      async () => {
        const locked = await raised(
          deps,
          await loadProfile(deps.dir, deps.now),
          scoring,
        );
        if (locked.changed.length > 0) {
          await saveProfile(deps.dir, locked.profile);
        }
        return locked.profile;
      },
      deps.lockOptions,
    );
    return { profile: saved };
  } catch (error) {
    if (!isLockTimeout(error)) throw error;
    return { profile, note: describeError(error) };
  }
}

/**
 * Handles `SessionStart`. With an invalid `session_id` it resolves `null`
 * and touches nothing. Otherwise it first re-derives the level of every
 * enabled topic that has evidence (also when tips are off, so levels stay
 * right; quiz evidence of a voided exam submission is not counted), raising
 * levels only (never lowering one), and writes
 * `profile.json` only when a level is raised; that save runs under the data
 * lock, taken only when something would be raised. If the lock times out,
 * the stored profile is summarized unrefreshed and the output carries a
 * `note` (one `LOCK_TIMEOUT` stderr line); any other failure propagates.
 * An unreadable or invalid `state.json` (read for the mute flags and the
 * void list) therefore drops the whole level refresh and the summary, even
 * with dial 0, and nothing is written; the hook shell fails open (one
 * stderr line, exit 0), so the session still starts.
 * Then it
 * resolves `null` when the learner muted the mentor or the dial is 0, and
 * otherwise returns, as
 * `additionalContext`, a plain-text summary of at most 2,000 chars: a header
 * (`session start`, or `restored after compaction` for source `compact`),
 * the dial, up to 8 below-target topics (touched ones first), up to 5 due
 * reviews, the first 400 chars of the learner's goals, and a pointer to the
 * profile command, all from the updated profile. Muted, disabled and
 * `ambient: false` topics are omitted. When `state.json` `activeTrack` names
 * a bundled exam track, the head also carries an
 * `Exam track: <code>, try /m3l-claude-mentor:exam <code> drill` line (never
 * dropped to fit), and the topics that track maps (`ambient: false` ones
 * included; still not muted or disabled ones) lead both the below-target
 * and the review lines, by exam weight descending then catalog order,
 * ahead of the other topics in their usual order, under the same caps; an
 * unset or no longer bundled code changes nothing. If the bundled tracks
 * cannot be loaded, the summary is built as if no track were active (no
 * exam line, no track ordering, `ambient: false` topics omitted) and the
 * output carries a `note` with `describeError`'s fixed text (never stored
 * data), so the failure is reported, not swallowed. When both that and the
 * `LOCK_TIMEOUT` note occur, `note` holds both, lock note first, joined
 * with `"; "`;
 * evidence content is never included; `state.json` is never written.
 *
 * @example
 * ```ts
 * import { runHook } from "./process-shell.ts";
 * import { sessionStartHandler } from "./handlers/session-start.ts";
 * await runHook("SessionStart", sessionStartHandler);
 * ```
 */
export const sessionStartHandler: HookHandler = async (payload, deps) => {
  if (payloadSession(payload) === null) return null;
  const compact = isCompact(payload);
  const { profile, note: lockNote } = await refreshedProfile(deps);
  const silent = lockNote === undefined ? null : { note: lockNote };
  if (deps.settings.dial === 0) return silent;
  const state = await loadState(deps.dir, deps.now);
  if (state.muted) return silent;
  const goals = headOf(await loadGoals(deps.dir), MAX_GOALS_CHARS);

  const muted = new Set<string>(state.mutedTopics);
  const { focus, note: trackNote } = trackFocus(state, deps.catalog, muted);
  const note = mergeNotes(lockNote, trackNote);
  const ranked = focus?.ranked ?? [];
  const inTrack = new Set(ranked.map((entry) => entry.id));
  const others = deps.catalog.filter(
    (entry) =>
      isUnprompted(entry) && !muted.has(entry.id) && !inTrack.has(entry.id),
  );
  const below = belowTargetLines(ranked, others, profile);
  const reviews = reviewLines([...ranked, ...others], profile, deps.now);

  const head = [
    `m3l-claude-mentor learner state (${compact ? "restored after compaction" : "session start"})`,
    `tip dial: ${String(deps.settings.dial)} (0 off, 5 most frequent)`,
    ...(focus === undefined
      ? []
      : [
          `Exam track: ${focus.code}, try /m3l-claude-mentor:exam ${focus.code} drill`,
        ]),
  ];
  const topics = [
    ...(below.length > 0 ? ["topics below target:", ...below] : []),
    ...reviews,
  ];
  const tail = [
    ...(goals.trim() !== "" ? ["goals:", goals] : []),
    CLOSING_LINE,
  ];
  return {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: fit(head, topics, tail),
    },
    ...(note === undefined ? {} : { note }),
  };
};
