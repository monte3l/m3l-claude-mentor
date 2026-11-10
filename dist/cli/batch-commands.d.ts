import type { ClaimOutcome, Diagnosis } from "../internal/reconcile.js";
import { type Level, type TopicId } from "../internal/schema.js";
import { type ParsedArgs } from "./args.js";
import { type CommandEnv } from "./env.js";
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
export declare function recordBatch(args: ParsedArgs, env: CommandEnv): Promise<BatchView>;
//# sourceMappingURL=batch-commands.d.ts.map