import { type ImportSummary } from "../internal/export.js";
import { type DataSummary, type PurgeResult } from "../internal/purge.js";
import { type TopicId } from "../internal/schema.js";
import { type ParsedArgs } from "./args.js";
import { type CommandEnv } from "./env.js";
/**
 * `show`: what the mentor stores, without content.
 *
 * @example
 * ```ts
 * import { show } from "./data-commands.js";
 * const summary = await show(env);
 * ```
 */
export declare function show(env: CommandEnv): Promise<DataSummary>;
/**
 * `record-evidence`: appends one event (`--topic`, `--channel`, `--result`)
 * at `now` in the context session.
 *
 * @throws CliUsageError for a malformed or unknown topic, channel or result.
 *
 * @example
 * ```ts
 * import { recordEvidence } from "./data-commands.js";
 * await recordEvidence(args, env); // { recorded: true }
 * ```
 */
export declare function recordEvidence(args: ParsedArgs, env: CommandEnv): Promise<{
    readonly recorded: true;
}>;
/**
 * `set-mute <on|off>`: mutes or unmutes the mentor.
 *
 * @example
 * ```ts
 * import { setMute } from "./data-commands.js";
 * await setMute(args, env); // { muted: true }
 * ```
 */
export declare function setMute(args: ParsedArgs, env: CommandEnv): Promise<{
    readonly muted: boolean;
}>;
/**
 * `set-topic-mute <on|off> --topic <id>`: adds the topic to or removes it
 * from `mutedTopics`. Muting requires a catalog topic; unmuting accepts any
 * well-formed id, so a topic dropped from the catalog can still be unmuted.
 *
 * @throws CliUsageError for a malformed id, or an unknown one when muting.
 *
 * @example
 * ```ts
 * import { setTopicMute } from "./data-commands.js";
 * await setTopicMute(args, env); // { topic: "plan-mode", muted: true }
 * ```
 */
export declare function setTopicMute(args: ParsedArgs, env: CommandEnv): Promise<{
    readonly topic: TopicId;
    readonly muted: boolean;
}>;
/**
 * `exclude-project <add|remove> --path <absolute path>`: adds the project
 * to or removes it from `excludedProjects` (the path is stored as given).
 *
 * @throws CliUsageError for a missing or non-absolute path.
 *
 * @example
 * ```ts
 * import { excludeProject } from "./data-commands.js";
 * await excludeProject(args, env); // { excludedProjects: 1 }
 * ```
 */
export declare function excludeProject(args: ParsedArgs, env: CommandEnv): Promise<{
    readonly excludedProjects: number;
}>;
/**
 * `get-goals`: the stored goals text (`""` when none).
 *
 * @example
 * ```ts
 * import { getGoals } from "./data-commands.js";
 * const { goals } = await getGoals(env);
 * ```
 */
export declare function getGoals(env: CommandEnv): Promise<{
    readonly goals: string;
}>;
/**
 * `set-goals --text <string>`: replaces the goals; reports their UTF-8 size.
 *
 * @throws CliUsageError when `--text` is missing.
 *
 * @example
 * ```ts
 * import { setGoals } from "./data-commands.js";
 * await setGoals(args, env); // { bytes: 11 }
 * ```
 */
export declare function setGoals(args: ParsedArgs, env: CommandEnv): Promise<{
    readonly bytes: number;
}>;
/**
 * `set-changelog-version --version <v>`: records the last changelog version
 * the learner was shown (1 to 64 ASCII letters, digits, `.`, `+` or `-`).
 *
 * Known limitation: the update is a read-modify-write of the state with no
 * lock, so two concurrent writers race and the last one wins.
 *
 * @throws CliUsageError when `--version` is missing or malformed (checked
 * before the state is read or written).
 *
 * @example
 * ```ts
 * import { setChangelogVersion } from "./data-commands.js";
 * await setChangelogVersion(args, env); // { lastChangelogVersion: "1.2.3" }
 * ```
 */
export declare function setChangelogVersion(args: ParsedArgs, env: CommandEnv): Promise<{
    readonly lastChangelogVersion: string;
}>;
/**
 * `export --to <absolute path>`: writes an export bundle.
 *
 * @throws CliUsageError for a missing or non-absolute path.
 *
 * @example
 * ```ts
 * import { exportData } from "./data-commands.js";
 * await exportData(args, env); // { exported: true, evidenceSkipped: 0 }
 * ```
 */
export declare function exportData(args: ParsedArgs, env: CommandEnv): Promise<{
    readonly exported: true;
    readonly evidenceSkipped: number;
}>;
/**
 * `import --from <absolute path> --replace`: replaces all stored data with
 * a bundle. Without `--replace` nothing is read or changed.
 *
 * @throws CliUsageError for a missing or non-absolute path.
 * @throws MentorStateError `CONFIRMATION_REQUIRED` without `--replace`.
 *
 * @example
 * ```ts
 * import { importData } from "./data-commands.js";
 * const summary = await importData(args, env);
 * ```
 */
export declare function importData(args: ParsedArgs, env: CommandEnv): Promise<ImportSummary>;
/**
 * `purge --confirm`: deletes everything the mentor stores. Without
 * `--confirm` nothing is deleted.
 *
 * @throws MentorStateError `CONFIRMATION_REQUIRED` without `--confirm`.
 *
 * @example
 * ```ts
 * import { purge } from "./data-commands.js";
 * const { deleted } = await purge(args, env);
 * ```
 */
export declare function purge(args: ParsedArgs, env: CommandEnv): Promise<PurgeResult>;
//# sourceMappingURL=data-commands.d.ts.map