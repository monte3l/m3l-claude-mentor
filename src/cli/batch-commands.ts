import { MentorStateError } from "../internal/errors.js";
import type { ClaimOutcome, Diagnosis } from "../internal/reconcile.js";
import {
  CHANNELS,
  parseEvidence,
  type Evidence,
  type Level,
  type TopicId,
} from "../internal/schema.js";
import { appendEvidence, loadProfile, saveProfile } from "../internal/store.js";
import {
  CliUsageError,
  requireOneOf,
  requireTopicId,
  requireValue,
  type ParsedArgs,
} from "./args.js";
import {
  loadMergedCatalog,
  requireCatalogEntry,
  type CommandEnv,
} from "./env.js";
import {
  applyPass,
  optionalClaim,
  recomputeTopic,
} from "./profile-commands.js";

const MAX_BATCH_EVENTS = 10;
const RESULTS = ["positive", "negative"] as const;

/** One `<channel>:<result>` token, or a usage error. */
function parseEventToken(
  token: string,
  topic: TopicId,
  env: CommandEnv,
): Evidence {
  const parts = token.split(":");
  const [channel, result] = parts;
  const knownChannel = CHANNELS.find((candidate) => candidate === channel);
  const knownResult = RESULTS.find((candidate) => candidate === result);
  if (
    parts.length !== 2 ||
    knownChannel === undefined ||
    knownResult === undefined
  ) {
    throw new CliUsageError();
  }
  const parsed = parseEvidence({
    channel: knownChannel,
    topic,
    result: knownResult,
    at: env.now,
    session: env.session,
  });
  if (!parsed.ok) throw new CliUsageError();
  return parsed.value;
}

/** `--events`: 1 to 10 comma-separated tokens, without whitespace. */
function parseEvents(
  args: ParsedArgs,
  topic: TopicId,
  env: CommandEnv,
): readonly Evidence[] {
  const tokens = requireValue(args, "events").split(",");
  if (tokens.length > MAX_BATCH_EVENTS) throw new CliUsageError();
  return tokens.map((token) => parseEventToken(token, topic, env));
}

/** Appends `events` in order; reports how many were written on failure. */
async function appendAll(
  env: CommandEnv,
  events: readonly Evidence[],
): Promise<void> {
  let recorded = 0;
  try {
    for (const event of events) {
      await appendEvidence(env.dir, event);
      recorded += 1;
    }
  } catch (cause) {
    throw new MentorStateError(
      "WRITE_FAILED",
      `record-batch recorded ${String(recorded)} of ${String(events.length)} events; no pass or recompute was applied`,
      { cause },
    );
  }
}

/**
 * The output of `record-batch`: the `recompute` view plus the number of
 * events appended and the topic's stored `passes` after the command.
 *
 * @example
 * ```ts
 * import { recordBatch, type BatchView } from "./batch-commands.js";
 * const view: BatchView = await recordBatch(args, env);
 * ```
 */
export interface BatchView {
  readonly topic: TopicId;
  readonly recorded: number;
  readonly passes: number;
  readonly level: Level;
  readonly previousLevel: Level;
  readonly claim: ClaimOutcome;
  readonly diagnoses: readonly Diagnosis[];
  readonly evidenceSkipped: number;
}

/**
 * `record-batch`, with `--topic <id>`, `--events <channel:result,...>`
 * and optionally `--pass <pass|fail>` and `--claim <Level>`: records one
 * learning interaction in one call. Every argument is validated, the topic
 * must be in the merged catalog, and `profile.json` is read, before anything
 * is written, so a bad argument or an unreadable profile writes nothing.
 * Then, in order: each event is appended (at `now`, in the context
 * session); the pass update of `record-pass` is applied when `--pass` is
 * given; the topic is recomputed exactly like `recompute` (the calibration
 * changes only with `--claim`); and the profile is saved once with all of
 * it.
 *
 * Known limitation: the profile update is a read-modify-write with no lock,
 * so two concurrent writers race and the last one wins.
 *
 * @throws CliUsageError for a malformed or unknown topic, an events list
 * that is empty, longer than 10 or holds a bad token, or a bad `--pass` or
 * `--claim`.
 * @throws MentorStateError `WRITE_FAILED` ("recorded k of n events") when an
 * append fails after `k` events were written; the profile is then untouched.
 * @throws MentorStateError from reading the evidence back or saving the
 * profile (for example a read-only data directory). Such a failure comes
 * AFTER all n events were appended, so they stay recorded without the pass
 * update or the recompute, and a retry records them again.
 *
 * @example
 * ```ts
 * import { recordBatch } from "./batch-commands.js";
 * const { recorded, level } = await recordBatch(args, env);
 * ```
 */
export async function recordBatch(
  args: ParsedArgs,
  env: CommandEnv,
): Promise<BatchView> {
  const topic = requireTopicId(args);
  const events = parseEvents(args, topic, env);
  const pass = args.values.has("pass")
    ? requireOneOf(args, "pass", ["pass", "fail"] as const)
    : undefined;
  const claimedLevel = optionalClaim(args);
  const { file, entries } = await loadMergedCatalog(env);
  const entry = requireCatalogEntry(entries, topic);

  const stored = await loadProfile(env.dir, env.now);

  await appendAll(env, events);
  const passed =
    pass === undefined
      ? stored
      : applyPass(stored, topic, pass, env.now).profile;
  const { profile, view, passes } = await recomputeTopic(
    env,
    file,
    entry,
    passed,
    claimedLevel,
  );
  await saveProfile(env.dir, profile);
  return {
    topic: view.topic,
    recorded: events.length,
    passes,
    level: view.level,
    previousLevel: view.previousLevel,
    claim: view.claim,
    diagnoses: view.diagnoses,
    evidenceSkipped: view.evidenceSkipped,
  };
}
