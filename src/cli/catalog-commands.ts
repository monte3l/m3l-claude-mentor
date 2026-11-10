import type { CatalogOverride } from "../internal/catalog.js";
import {
  LEVELS,
  STYLES,
  type Level,
  type Style,
  type TopicId,
  type TopicType,
} from "../internal/schema.js";
import { loadProfile, loadState, saveCatalogFile } from "../internal/store.js";
import {
  CliUsageError,
  requireOneOf,
  requireTopicId,
  type ParsedArgs,
} from "./args.js";
import {
  loadMergedCatalog,
  requireCatalogEntry,
  type CommandEnv,
} from "./env.js";

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
export async function topics(
  env: CommandEnv,
): Promise<{ readonly topics: readonly CatalogTopicView[] }> {
  const { entries } = await loadMergedCatalog(env);
  const profile = await loadProfile(env.dir, env.now);
  const state = await loadState(env.dir, env.now);
  const muted = new Set<string>(state.mutedTopics);
  return {
    topics: entries.map((entry) => {
      const stored = Object.hasOwn(profile.topics, entry.id)
        ? profile.topics[entry.id]
        : undefined;
      return {
        id: entry.id,
        title: entry.title,
        type: entry.type,
        targetLevel: entry.targetLevel,
        ...(entry.style !== undefined ? { style: entry.style } : {}),
        enabled: entry.enabled,
        dependencies: entry.dependencies,
        keywords: entry.keywords,
        level: stored?.level ?? "Unseen",
        introduced: stored?.introduced ?? false,
        muted: muted.has(entry.id),
      };
    }),
  };
}

const OVERRIDE_OPTIONS = ["enabled", "target", "style"] as const;

/** `--enabled`, which must be exactly `true` or `false`, when given. */
function optionalEnabled(args: ParsedArgs): boolean | undefined {
  if (!args.values.has("enabled")) return undefined;
  return requireOneOf(args, "enabled", ["true", "false"] as const) === "true";
}

/**
 * The override fields the arguments set, or `null` for `--reset`. All
 * validation happens here, before anything is read or written.
 */
function requestedChange(args: ParsedArgs): CatalogOverride | null {
  const given = OVERRIDE_OPTIONS.filter((name) => args.values.has(name));
  if (args.booleans.has("reset")) {
    if (given.length > 0) throw new CliUsageError();
    return null;
  }
  if (given.length === 0) throw new CliUsageError();
  const enabled = optionalEnabled(args);
  const targetLevel = args.values.has("target")
    ? requireOneOf(args, "target", LEVELS)
    : undefined;
  const style = args.values.has("style")
    ? requireOneOf(args, "style", STYLES)
    : undefined;
  return {
    ...(enabled !== undefined ? { enabled } : {}),
    ...(targetLevel !== undefined ? { targetLevel } : {}),
    ...(style !== undefined ? { style } : {}),
  };
}

/** `overrides` without the entry for `topic`. */
function withoutTopic(
  overrides: Readonly<Record<string, CatalogOverride>>,
  topic: TopicId,
): Readonly<Record<string, CatalogOverride>> {
  return Object.fromEntries(
    Object.entries(overrides).filter(([id]) => id !== topic),
  );
}

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
export async function setTopicOverride(
  args: ParsedArgs,
  env: CommandEnv,
): Promise<{ readonly topic: TopicId; readonly override: CatalogOverride }> {
  const topic = requireTopicId(args);
  const change = requestedChange(args);
  const { file, entries } = await loadMergedCatalog(env);
  requireCatalogEntry(entries, topic);
  const overrides = file.user.overrides;
  const existing = Object.hasOwn(overrides, topic)
    ? overrides[topic]
    : undefined;
  if (change === null) {
    if (existing !== undefined) {
      await saveCatalogFile(env.dir, {
        ...file,
        user: { ...file.user, overrides: withoutTopic(overrides, topic) },
      });
    }
    return { topic, override: {} };
  }
  const override: CatalogOverride = { ...existing, ...change };
  await saveCatalogFile(env.dir, {
    ...file,
    user: { ...file.user, overrides: { ...overrides, [topic]: override } },
  });
  return { topic, override };
}
