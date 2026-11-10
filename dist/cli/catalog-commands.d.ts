import type { CatalogOverride } from "../internal/catalog.js";
import { type Level, type Style, type TopicId, type TopicType } from "../internal/schema.js";
import { type ParsedArgs } from "./args.js";
import { type CommandEnv } from "./env.js";
/**
 * One topic as printed by `topics`: the merged catalog entry joined with the
 * learner's stored level and the state's per-topic mute.
 *
 * @example
 * ```ts
 * import type { CatalogTopicView } from "./catalog-commands.js";
 * const view: CatalogTopicView = {
 *   id: "plan-mode",
 *   title: "Plan mode",
 *   type: "feature",
 *   targetLevel: "Applied",
 *   enabled: true,
 *   dependencies: [],
 *   keywords: ["plan mode"],
 *   level: "Unseen",
 *   introduced: false,
 *   muted: false,
 * };
 * ```
 */
export interface CatalogTopicView {
    readonly id: TopicId;
    readonly title: string;
    readonly type: TopicType;
    readonly targetLevel: Level;
    /** Present only when the merged entry has a style. */
    readonly style?: Style;
    readonly enabled: boolean;
    readonly dependencies: readonly TopicId[];
    readonly keywords: readonly string[];
    /** The stored level, or `Unseen` when the profile has none. */
    readonly level: Level;
    readonly introduced: boolean;
    readonly muted: boolean;
}
/**
 * `topics`: every entry of the merged catalog (bundled entries with the
 * user's overrides applied, then custom topics), in catalog order, joined
 * with the profile and the state. Disabled entries are listed with
 * `enabled: false`. Nothing is written.
 *
 * @throws MentorStateError when `catalog.json` fails to load or merge.
 *
 * @example
 * ```ts
 * import { topics } from "./catalog-commands.js";
 * const { topics: rows } = await topics(env);
 * ```
 */
export declare function topics(env: CommandEnv): Promise<{
    readonly topics: readonly CatalogTopicView[];
}>;
/**
 * `set-topic-override`, with `--topic <id>` and any of
 * `--enabled <true|false>`, `--target <Level>`, `--style <style>`, or
 * `--reset` alone: edits the topic's override in
 * `catalog.json`, keeping custom topics, scoring and other overrides. The
 * given fields merge into any existing override for the topic; `--reset`
 * (allowed with `--topic` only) removes it, and is a no-op that writes
 * nothing when the topic has no override. Every argument is validated, and
 * the topic must be in the merged catalog, before anything is written.
 *
 * Known limitation: the update is a read-modify-write with no lock, so two
 * concurrent writers race and the last one wins.
 *
 * @returns The topic and its stored override (`{}` after `--reset`).
 * @throws CliUsageError for a malformed or unknown topic, a bad value, no
 * option, or `--reset` with another option.
 * @throws MentorStateError when `catalog.json` fails to load, merge or save.
 *
 * @example
 * ```ts
 * import { setTopicOverride } from "./catalog-commands.js";
 * const { override } = await setTopicOverride(args, env);
 * // override: { enabled: false }
 * ```
 */
export declare function setTopicOverride(args: ParsedArgs, env: CommandEnv): Promise<{
    readonly topic: TopicId;
    readonly override: CatalogOverride;
}>;
//# sourceMappingURL=catalog-commands.d.ts.map