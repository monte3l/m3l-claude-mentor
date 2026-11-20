import type { CatalogFile } from "../internal/catalog-file.ts";
import { MentorStateError } from "../internal/errors.ts";
import type { ExamItem } from "../internal/exam-schema.ts";
import { readExamItems } from "../internal/exam-store.ts";
import {
  parseSessionId,
  type CatalogEntry,
  type Level,
  type TopicId,
} from "../internal/schema.ts";
import {
  MAX_VOIDED_EXAMS,
  type MentorState,
} from "../internal/state-schema.ts";
import {
  loadProfile,
  loadState,
  saveProfile,
  saveState,
} from "../internal/store.ts";
import type { VoidedExam } from "../internal/voids.ts";
import { CliUsageError, type ParsedArgs } from "./args.ts";
import { loadMergedCatalog, lockedState, type CommandEnv } from "./env.ts";
import { recomputeTopic } from "./profile-commands.ts";

const AT_PATTERN = /^(0|[1-9][0-9]*)$/;

/** The `--at` and `--session` pair, or `undefined` when both are absent. */
function optionalPair(args: ParsedArgs): VoidedExam | undefined {
  const rawAt = args.values.get("at");
  const rawSession = args.values.get("session");
  if (rawAt === undefined && rawSession === undefined) return undefined;
  if (rawAt === undefined || rawSession === undefined) {
    throw new CliUsageError();
  }
  const at = Number(rawAt);
  if (!AT_PATTERN.test(rawAt) || !Number.isSafeInteger(at)) {
    throw new CliUsageError();
  }
  const session = parseSessionId(rawSession);
  if (!session.ok) throw new CliUsageError();
  return { session: session.value, at };
}

function requirePair(args: ParsedArgs): VoidedExam {
  const pair = optionalPair(args);
  if (pair === undefined) throw new CliUsageError();
  return pair;
}

const samePair = (a: VoidedExam, b: VoidedExam): boolean =>
  a.session === b.session && a.at === b.at;

/** The newest submission in the log: the greatest `at`, the later line on a tie. */
function latestSubmission(items: readonly ExamItem[]): VoidedExam {
  let latest: ExamItem | undefined;
  for (const item of items) {
    if (latest === undefined || item.at >= latest.at) latest = item;
  }
  if (latest === undefined) {
    throw new MentorStateError(
      "VALIDATION_FAILED",
      "there is no exam submission to void",
    );
  }
  return { session: latest.session, at: latest.at };
}

/** The merged catalog entry of each distinct topic, in first-seen order. */
function entriesOf(
  items: readonly ExamItem[],
  entries: readonly CatalogEntry[],
): CatalogEntry[] {
  const topics = [...new Set<TopicId>(items.map((item) => item.topic))];
  return topics.map((topic) => {
    const entry = entries.find((candidate) => candidate.id === topic);
    if (entry === undefined) {
      throw new MentorStateError(
        "VALIDATION_FAILED",
        "the submission names a topic that is not in the merged topic catalog",
      );
    }
    return entry;
  });
}

/** `state` with `voids` as its void list; no own key when it is empty. */
function withVoids(
  state: MentorState,
  voids: readonly VoidedExam[],
): MentorState {
  const { voidedExams: _previous, ...rest } = state;
  return voids.length > 0 ? { ...rest, voidedExams: voids } : rest;
}

/** What `applyVoids` saved: names the change in its `WRITE_FAILED` message. */
type SavedChange = "the void list" | "its removal from the void list";

/**
 * The shared tail of `exam-void` and `exam-unvoid`: saves `next`, then
 * recomputes every topic of the submission's `items` (the recompute reads
 * the void list just saved) and saves the profile once. Any failure after
 * `next` was saved (loading the profile, a recompute, saving the profile)
 * is a `WRITE_FAILED` naming the topics to `recompute` by hand; rerunning
 * the command is not a retry, since the void list already changed.
 */
async function applyVoids(
  env: CommandEnv,
  file: CatalogFile,
  topics: readonly CatalogEntry[],
  next: MentorState,
  change: SavedChange,
): Promise<Record<string, Level>> {
  await saveState(env.dir, next);
  try {
    let profile = await loadProfile(env.dir, env.now);
    const levels: Record<string, Level> = {};
    for (const entry of topics) {
      const result = await recomputeTopic(env, file, entry, profile, undefined);
      profile = result.profile;
      levels[entry.id] = result.view.level;
    }
    await saveProfile(env.dir, profile);
    return levels;
  } catch (cause) {
    const ids = topics.map((entry) => entry.id).join(", ");
    throw new MentorStateError(
      "WRITE_FAILED",
      `${change} was saved but levels were not updated for ${ids}; run recompute --topic <id> for each of them`,
      { cause },
    );
  }
}

/**
 * The output of `exam-void`.
 *
 * @example
 * ```ts
 * import type { ExamVoidView } from "./exam-void-commands.ts";
 * const view: ExamVoidView = {
 *   voided: { session: "sess-1", at: 1_000 },
 *   items: 3,
 *   levels: { "plan-mode": "Introduced" },
 * };
 * ```
 */
export interface ExamVoidView {
  readonly voided: { readonly session: string; readonly at: number };
  /** How many logged exam items the submission holds. */
  readonly items: number;
  /** Each recomputed topic's new level. */
  readonly levels: Readonly<Record<string, Level>>;
}

/**
 * `exam-void [--at <ms> --session <id>]`: voids one exam submission, the
 * one named by `--at` and `--session`, or with neither flag the newest in
 * the exam log. Its quiz evidence and exam items stop counting toward
 * levels, readiness and `exam-items`; neither log is rewritten. The pair is
 * appended to `state.json` `voidedExams`, then each distinct topic of the
 * submission is recomputed and the profile saved, all under the data lock
 * ({@link lockedState}).
 *
 * @throws CliUsageError when only one of `--at` and `--session` is given,
 * `--at` is not a non-negative integer, or `--session` is not a session id.
 * @throws MentorStateError `VALIDATION_FAILED` when the log holds no
 * submission (or none matching the flags), the submission is already
 * voided (with no flags too: the newest is never skipped), 100 submissions
 * are already voided, or a topic of the submission is no longer in the
 * merged catalog; `WRITE_FAILED` (with `cause`) when the void list was
 * saved but the levels were not updated (the profile could not be loaded,
 * a topic not recomputed, or the profile not saved): the message names the
 * submission's topic ids to `recompute --topic` by hand, and rerunning
 * `exam-void` then fails as already voided.
 *
 * @example
 * ```ts
 * import { examVoid } from "./exam-void-commands.ts";
 * const { voided, levels } = await examVoid(args, env);
 * ```
 */
export async function examVoid(
  args: ParsedArgs,
  env: CommandEnv,
): Promise<ExamVoidView> {
  const requested = optionalPair(args);
  const { file, entries } = await loadMergedCatalog(env);
  return lockedState(env, async () => {
    const { items: log } = await readExamItems(env.dir);
    const target = requested ?? latestSubmission(log);
    const items = log.filter((item) => samePair(item, target));
    if (items.length === 0) {
      throw new MentorStateError(
        "VALIDATION_FAILED",
        "no exam submission matches --at and --session",
      );
    }
    const state = await loadState(env.dir, env.now);
    const voids = state.voidedExams ?? [];
    if (voids.some((v) => samePair(v, target))) {
      throw new MentorStateError(
        "VALIDATION_FAILED",
        "that exam submission is already voided",
      );
    }
    if (voids.length >= MAX_VOIDED_EXAMS) {
      throw new MentorStateError(
        "VALIDATION_FAILED",
        `at most ${String(MAX_VOIDED_EXAMS)} exam submissions can be voided`,
      );
    }
    const topics = entriesOf(items, entries);
    const levels = await applyVoids(
      env,
      file,
      topics,
      withVoids(state, [...voids, target]),
      "the void list",
    );
    return {
      voided: { session: target.session, at: target.at },
      items: items.length,
      levels,
    };
  });
}

/**
 * The output of `exam-unvoid`.
 *
 * @example
 * ```ts
 * import type { ExamUnvoidView } from "./exam-void-commands.ts";
 * const view: ExamUnvoidView = {
 *   unvoided: { session: "sess-1", at: 1_000 },
 *   items: 3,
 *   levels: { "plan-mode": "Recalled" },
 * };
 * ```
 */
export interface ExamUnvoidView {
  readonly unvoided: { readonly session: string; readonly at: number };
  /** How many logged exam items the submission holds. */
  readonly items: number;
  /** Each recomputed topic's new level. */
  readonly levels: Readonly<Record<string, Level>>;
}

/**
 * `exam-unvoid --at <ms> --session <id>`: removes that pair from
 * `state.json` `voidedExams`, so the submission counts again, then
 * recomputes each distinct topic of its logged items and saves the
 * profile, all under the data lock ({@link lockedState}). When the list
 * becomes empty the key is dropped.
 *
 * @throws CliUsageError when either flag is missing or malformed.
 * @throws MentorStateError `VALIDATION_FAILED` when the pair is not voided,
 * the submission's items are no longer in the exam log window (nothing is
 * written), or a topic of the submission is no longer in the merged
 * catalog; `WRITE_FAILED` (with `cause`) when the removal was saved but the
 * levels were not updated: the message names the submission's topic ids to
 * `recompute --topic` by hand, and rerunning `exam-unvoid` then fails as
 * not voided.
 *
 * @example
 * ```ts
 * import { examUnvoid } from "./exam-void-commands.ts";
 * const { unvoided, levels } = await examUnvoid(args, env);
 * ```
 */
export async function examUnvoid(
  args: ParsedArgs,
  env: CommandEnv,
): Promise<ExamUnvoidView> {
  const target = requirePair(args);
  const { file, entries } = await loadMergedCatalog(env);
  return lockedState(env, async () => {
    const state = await loadState(env.dir, env.now);
    const voids = state.voidedExams ?? [];
    if (!voids.some((v) => samePair(v, target))) {
      throw new MentorStateError(
        "VALIDATION_FAILED",
        "that exam submission is not voided",
      );
    }
    const { items: log } = await readExamItems(env.dir);
    const items = log.filter((item) => samePair(item, target));
    if (items.length === 0) {
      throw new MentorStateError(
        "VALIDATION_FAILED",
        "that exam submission's items are no longer in the exam log window, so its levels cannot be recomputed",
      );
    }
    const topics = entriesOf(items, entries);
    const levels = await applyVoids(
      env,
      file,
      topics,
      withVoids(
        state,
        voids.filter((v) => !samePair(v, target)),
      ),
      "its removal from the void list",
    );
    return {
      unvoided: { session: target.session, at: target.at },
      items: items.length,
      levels,
    };
  });
}
