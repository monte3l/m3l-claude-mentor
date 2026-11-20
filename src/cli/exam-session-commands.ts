import { MentorStateError, type MentorErrorCode } from "../internal/errors.ts";
import {
  EXAM_ITEM_MODES,
  MAX_PENDING_ITEMS,
  isPendingExpired,
  parseExamItem,
  parsePendingExam,
  type ExamItem,
  type PendingExam,
  type PendingItem,
} from "../internal/exam-schema.ts";
import {
  appendExamItem,
  clearPending,
  loadPending,
  savePending,
} from "../internal/exam-store.ts";
import type {
  CatalogEntry,
  Evidence,
  Level,
  TopicId,
} from "../internal/schema.ts";
import { loadProfile, saveProfile } from "../internal/store.ts";
import { ITEM_KINDS, type Track } from "../internal/tracks.ts";
import {
  CliUsageError,
  requireOneOf,
  requireValue,
  type ParsedArgs,
} from "./args.ts";
import { appendAll } from "./batch-commands.ts";
import { loadMergedCatalog, lockedState, type CommandEnv } from "./env.ts";
import { findBundledTrack, requireTrackCode } from "./exam-shared.ts";
import { recomputeTopic } from "./profile-commands.ts";

const LETTERS_PATTERN = /^[A-F](,[A-F])*$/;
const MAX_MULTIPLE_LETTERS = 5;

/**
 * Comma-separated option letters, upper-cased, sorted and distinct, or a
 * usage error (a repeated letter is a usage error too).
 */
function parseLetters(text: string): readonly string[] {
  const upper = text.toUpperCase();
  if (!LETTERS_PATTERN.test(upper)) throw new CliUsageError();
  const letters = upper.split(",").sort();
  if (new Set(letters).size !== letters.length) throw new CliUsageError();
  return letters;
}

/**
 * The codes `loadPending` throws for a file that exists but cannot be
 * read as a pending exam (bad JSON, wrong shape, oversize): a stale file,
 * as opposed to an I/O or data-directory failure.
 */
const UNREADABLE_PENDING_CODES: ReadonlySet<MentorErrorCode> = new Set([
  "PARSE_FAILED",
  "VALIDATION_FAILED",
  "TOO_LARGE",
]);

function isUnreadablePending(error: unknown): boolean {
  return (
    error instanceof MentorStateError &&
    UNREADABLE_PENDING_CODES.has(error.code)
  );
}

/** The catalog entry for `topic`, or a fixed `VALIDATION_FAILED`. */
function requireMergedEntry(
  entries: readonly CatalogEntry[],
  topic: TopicId,
  message: string,
): CatalogEntry {
  const entry = entries.find((candidate) => candidate.id === topic);
  if (entry === undefined) {
    throw new MentorStateError("VALIDATION_FAILED", message);
  }
  return entry;
}

/** One `<objective>|<topic>|<single|multiple>|<letters>` spec, syntax only. */
function parseItemSpec(spec: string): {
  readonly objective: string;
  readonly topic: string;
  readonly kind: PendingItem["kind"];
  readonly key: readonly string[];
} {
  const fields = spec.split("|");
  const [objective, topic, kindText, letters] = fields;
  const kind = ITEM_KINDS.find((candidate) => candidate === kindText);
  if (
    fields.length !== 4 ||
    objective === undefined ||
    topic === undefined ||
    kind === undefined ||
    letters === undefined
  ) {
    throw new CliUsageError();
  }
  const key = parseLetters(letters);
  const sizeOk =
    kind === "single"
      ? key.length === 1
      : key.length >= 2 && key.length <= MAX_MULTIPLE_LETTERS;
  if (!sizeOk) throw new CliUsageError();
  return { objective, topic, kind, key };
}

/** Resolves a syntactically valid item against `track`; fixed messages only. */
function resolveItem(
  track: Track,
  item: ReturnType<typeof parseItemSpec>,
): PendingItem {
  const objective = track.domains
    .flatMap((domain) => domain.objectives)
    .find((candidate) => candidate.id === item.objective);
  if (objective === undefined) {
    throw new MentorStateError(
      "VALIDATION_FAILED",
      "an item names an objective that is not in the track",
    );
  }
  const topic = objective.topics.find((candidate) => candidate === item.topic);
  if (topic === undefined) {
    throw new MentorStateError(
      "VALIDATION_FAILED",
      "an item names a topic its objective does not map",
    );
  }
  return { objective: objective.id, topic, kind: item.kind, key: item.key };
}

/**
 * `exam-begin --track <code> --mode <drill|mock> --items <spec;spec...>`:
 * stores a new pending exam (`exam-pending.json`) with `createdAt` = now,
 * replacing any existing one, expired or not. Each spec is
 * `<objective>|<topic>|<single|multiple>|<letters>`, the letters a
 * comma-separated set of `A`-`F` (exactly one for `single`, 2 to 5 for
 * `multiple`). Every argument, and every item's topic against the merged
 * topic catalog, is validated before the data lock is taken; the load and
 * save of the pending exam run under it ({@link lockedState}). An existing
 * pending file that cannot be read as a pending exam (bad JSON, wrong shape,
 * oversize) is a stale file: it is replaced and `replaced` is `true`. The
 * output never contains the answer key.
 *
 * @throws CliUsageError for a missing or malformed flag, a bad spec, or
 * fewer than 1 or more than 15 items.
 * @throws MentorStateError `VALIDATION_FAILED` (fixed messages, nothing
 * written) when the track is not bundled, an objective is not in it, a
 * topic is not mapped by its objective, or a topic is not in the merged
 * catalog; any other failure loading the existing pending exam (an I/O
 * error such as `READ_FAILED`, `DATA_DIR_INVALID`), unchanged.
 *
 * @example
 * ```ts
 * import { examBegin } from "./exam-session-commands.ts";
 * const { pending, replaced } = await examBegin(args, env);
 * ```
 */
export async function examBegin(
  args: ParsedArgs,
  env: CommandEnv,
): Promise<{ readonly pending: number; readonly replaced: boolean }> {
  const code = requireTrackCode(args, "track");
  const mode = requireOneOf(args, "mode", EXAM_ITEM_MODES);
  const specs = requireValue(args, "items").split(";");
  if (specs.length > MAX_PENDING_ITEMS) throw new CliUsageError();
  const parsedItems = specs.map(parseItemSpec);
  const track = findBundledTrack(code);
  const items = parsedItems.map((item) => resolveItem(track, item));
  const { entries } = await loadMergedCatalog(env);
  for (const item of items) {
    requireMergedEntry(
      entries,
      item.topic,
      "an item names a topic that is not in the merged topic catalog",
    );
  }
  const parsed = parsePendingExam({
    v: 1,
    track: track.code,
    mode,
    createdAt: env.now,
    items,
  });
  if (!parsed.ok) {
    throw new MentorStateError(
      "VALIDATION_FAILED",
      "the pending exam is invalid",
    );
  }
  const replaced = await lockedState(env, async () => {
    let existing: boolean;
    try {
      existing = (await loadPending(env.dir)) !== null;
    } catch (error) {
      // Deliberate swallow: an unreadable pending file is a stale exam that
      // exam-begin exists to replace. Every other failure (I/O, a bad data
      // directory, a directory in its place) is rethrown unchanged.
      if (!isUnreadablePending(error)) throw error;
      existing = true;
    }
    await savePending(env.dir, parsed.value);
    return existing;
  });
  return { pending: items.length, replaced };
}

/**
 * One scored item in the output of `exam-answer`.
 *
 * @example
 * ```ts
 * import type { ExamResultView } from "./exam-session-commands.ts";
 * const r: ExamResultView = { index: 0, correct: true, key: ["B"] };
 * ```
 */
export interface ExamResultView {
  /** The item's 0-based position in the pending exam. */
  readonly index: number;
  readonly correct: boolean;
  /** The answer key, sorted; revealed only once the exam is answered. */
  readonly key: readonly string[];
}

/**
 * The output of `exam-answer`.
 *
 * @example
 * ```ts
 * import { examAnswer, type ExamAnswerView } from "./exam-session-commands.ts";
 * const { correctCount, total }: ExamAnswerView = await examAnswer(args, env);
 * ```
 */
export interface ExamAnswerView {
  readonly results: readonly ExamResultView[];
  readonly correctCount: number;
  readonly total: number;
  /** One entry per distinct topic: the level now stored in the profile. */
  readonly levels: Readonly<Record<string, Level>>;
}

function sameLetters(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((letter, i) => letter === b[i]);
}

/** `--answers`: `;`-separated letter groups, each sorted and distinct. */
function parseAnswers(args: ParsedArgs): readonly (readonly string[])[] {
  return requireValue(args, "answers").split(";").map(parseLetters);
}

/**
 * The pending exam `exam-answer` scores, checked in a fixed order: no
 * pending exam, an unreadable one, an expired one (left in place), then a
 * group count that does not match its item count.
 */
async function requireAnswerablePending(
  env: CommandEnv,
  groupCount: number,
): Promise<PendingExam> {
  let pending: PendingExam | null;
  try {
    pending = await loadPending(env.dir);
  } catch (error) {
    if (!isUnreadablePending(error)) throw error;
    throw new MentorStateError(
      "VALIDATION_FAILED",
      "the pending exam file is unreadable; start a new exam with exam-begin",
      { cause: error },
    );
  }
  if (pending === null) {
    throw new MentorStateError("VALIDATION_FAILED", "no pending exam");
  }
  if (isPendingExpired(pending, env.now)) {
    throw new MentorStateError(
      "VALIDATION_FAILED",
      "the pending exam has expired",
    );
  }
  if (groupCount !== pending.items.length) {
    throw new MentorStateError(
      "VALIDATION_FAILED",
      "the number of answer groups does not match the pending exam's item count",
    );
  }
  return pending;
}

/** Appends every exam item; a failure reports how far it got. */
async function appendExamItems(
  env: CommandEnv,
  items: readonly ExamItem[],
): Promise<void> {
  const total = String(items.length);
  let recorded = 0;
  try {
    for (const item of items) {
      await appendExamItem(env.dir, item);
      recorded += 1;
    }
  } catch (cause) {
    throw new MentorStateError(
      "WRITE_FAILED",
      `exam-answer recorded ${total} events and ${String(recorded)} of ${total} exam items; the profile was not updated`,
      { cause },
    );
  }
}

/** `D<n>` from an objective id `D<n>.<k>`. */
function domainOf(objective: string): string {
  return objective.slice(0, objective.indexOf("."));
}

/**
 * `exam-answer --answers <letters;letters...>`: scores the pending exam and
 * records it. Groups are separated by `;` and letters by `,`
 * (case-insensitive); there must be one group per item. An item is correct
 * when its letter set equals the key exactly (multiple-response is
 * all-or-nothing).
 *
 * Every `--answers` syntax error is a usage error raised before the data
 * lock is taken. Under the lock ({@link lockedState}), in order: the
 * pending exam is checked (see the `VALIDATION_FAILED` cases below), each
 * topic is looked up in the merged catalog, the profile is read, and every
 * exam-log item is built and validated (a failure there writes nothing);
 * one `quiz` evidence event per item is appended (positive when correct);
 * one exam item per answer is appended to the exam log (no question,
 * answer or key text); each distinct topic is recomputed once exactly like
 * `record-batch` without a pass (so `passes` and `lastPassAt` are
 * untouched) and the profile is saved once; and LAST the pending exam is
 * deleted.
 *
 * The quiz evidence is NOT capped the way readiness is: mastery's quiz
 * channel has no per-day cap, so every item counts in full, and the exam
 * skill must limit how many items per topic one exam asks.
 *
 * Delivery is at-least-once: because the pending exam is cleared only after
 * everything else succeeded, a failure part-way through an append or the
 * profile save leaves it in place, so the exam can be answered again, and
 * a retry re-appends the evidence and exam items already written. A failed
 * delete after everything was recorded is reported as such: that exam must
 * not be answered again.
 *
 * @throws CliUsageError for a malformed `--answers` (an empty group, a
 * letter outside `A`-`F`, or a repeated letter in a group); nothing is
 * written and the pending exam is kept.
 * @throws MentorStateError `VALIDATION_FAILED` (fixed messages, nothing
 * written, the pending file untouched), checked in this order: there is no
 * pending exam; it is unreadable (bad JSON, wrong shape, oversize; the
 * message points at `exam-begin`); it has expired; the group count differs
 * from its item count; a topic is not in the merged catalog; an exam item
 * fails validation. `WRITE_FAILED` (the original error as `cause`) when an
 * evidence append fails ("recorded k of n events; no exam item was
 * recorded"), an exam-log append fails ("recorded n events and k of n exam
 * items; the profile was not updated"), the profile save fails ("recorded n
 * events and n of n exam items; the profile was not saved"), or the delete
 * fails ("recorded the exam but could not remove exam-pending.json; it must
 * not be answered again"). Any other read failure, unchanged.
 *
 * @example
 * ```ts
 * import { examAnswer } from "./exam-session-commands.ts";
 * const { results, correctCount, total, levels } = await examAnswer(args, env);
 * ```
 */
export async function examAnswer(
  args: ParsedArgs,
  env: CommandEnv,
): Promise<ExamAnswerView> {
  const groups = parseAnswers(args);
  const { file, entries } = await loadMergedCatalog(env);
  return lockedState(env, async () => {
    const pending = await requireAnswerablePending(env, groups.length);
    const topics: readonly TopicId[] = [
      ...new Set(pending.items.map((item) => item.topic)),
    ];
    const topicEntries = topics.map((topic) =>
      requireMergedEntry(
        entries,
        topic,
        "the pending exam names a topic that is not in the merged topic catalog",
      ),
    );
    let profile = await loadProfile(env.dir, env.now);

    const scored = pending.items.map((item, index) => ({
      item,
      correct: sameLetters(groups[index] ?? [], item.key),
    }));
    const results = scored.map(({ item, correct }, index): ExamResultView => ({
      index,
      correct,
      key: [...item.key],
    }));
    const examItems = scored.map(({ item, correct }): ExamItem => {
      const parsed = parseExamItem({
        v: 1,
        track: pending.track,
        domain: domainOf(item.objective),
        objective: item.objective,
        topic: item.topic,
        kind: item.kind,
        mode: pending.mode,
        correct,
        at: env.now,
        session: env.session,
      });
      if (!parsed.ok) {
        throw new MentorStateError(
          "VALIDATION_FAILED",
          "an exam item for the exam log is invalid",
        );
      }
      return parsed.value;
    });
    const events = scored.map(({ item, correct }): Evidence => ({
      channel: "quiz",
      topic: item.topic,
      result: correct ? "positive" : "negative",
      at: env.now,
      session: env.session,
    }));
    await appendAll(env, events, "exam-answer", "no exam item was recorded");
    await appendExamItems(env, examItems);
    const levels: Record<string, Level> = {};
    for (const entry of topicEntries) {
      const result = await recomputeTopic(env, file, entry, profile, undefined);
      profile = result.profile;
      levels[entry.id] = result.view.level;
    }
    try {
      await saveProfile(env.dir, profile);
    } catch (cause) {
      const total = String(examItems.length);
      throw new MentorStateError(
        "WRITE_FAILED",
        `exam-answer recorded ${total} events and ${total} of ${total} exam items; the profile was not saved`,
        { cause },
      );
    }
    try {
      await clearPending(env.dir);
    } catch (cause) {
      throw new MentorStateError(
        "WRITE_FAILED",
        "exam-answer recorded the exam but could not remove exam-pending.json; it must not be answered again",
        { cause },
      );
    }
    return {
      results,
      correctCount: results.filter((result) => result.correct).length,
      total: results.length,
      levels,
    };
  });
}
