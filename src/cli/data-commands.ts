import { MentorStateError } from "../internal/errors.ts";
import {
  exportBundleToFile,
  importBundleFromFile,
  type ImportSummary,
} from "../internal/export.ts";
import {
  describeData,
  purgeData,
  type DataSummary,
  type PurgeResult,
} from "../internal/purge.ts";
import {
  canonicalProject,
  foldProjectCase,
  normalizeProjectPath,
  type ProjectPathOptions,
} from "../internal/project-exclusion.ts";
import { CHANNELS, parseEvidence, type TopicId } from "../internal/schema.ts";
import {
  isChangelogVersion,
  MAX_PROJECT_LENGTH,
  type MentorState,
} from "../internal/state-schema.ts";
import {
  appendEvidence,
  loadGoals,
  loadState,
  saveGoals,
  saveState,
} from "../internal/store.ts";
import {
  CliUsageError,
  requireAbsolutePath,
  requireOneOf,
  requireTopicId,
  requireValue,
  type ParsedArgs,
} from "./args.ts";
import {
  cliLockOptions,
  loadMergedCatalog,
  lockedState,
  requireCatalogEntry,
  type CommandEnv,
} from "./env.ts";

/** The positional of an on/off command as a boolean. */
function onOff(args: ParsedArgs): boolean {
  if (args.positional === "on") return true;
  if (args.positional === "off") return false;
  throw new CliUsageError();
}

/** `list` with `item` present once (`add`) or absent (`!add`), order kept. */
function toggled<T>(list: readonly T[], item: T, add: boolean): readonly T[] {
  const without = list.filter((existing) => existing !== item);
  return add ? [...without, item] : without;
}

/**
 * Loads the state, applies `change` and saves it, all under the data lock
 * ({@link lockedState}), so a concurrent writer cannot interleave. `change`
 * runs inside the lock: keep it quick, and do slow work (filesystem lookups
 * such as `realpath`) before calling this, as {@link excludeProject} does.
 */
function updateState(
  env: CommandEnv,
  change: (state: MentorState) => MentorState,
): Promise<MentorState> {
  return lockedState(env, async () => {
    const next = change(await loadState(env.dir, env.now));
    await saveState(env.dir, next);
    return next;
  });
}

/**
 * `show`: what the mentor stores, without content.
 *
 * @example
 * ```ts
 * import { show } from "./data-commands.ts";
 * const summary = await show(env);
 * ```
 */
export function show(env: CommandEnv): Promise<DataSummary> {
  return describeData(env.dir, env.now);
}

/**
 * `record-evidence`: appends one event (`--topic`, `--channel`, `--result`)
 * at `now` in the context session.
 *
 * @throws CliUsageError for a malformed or unknown topic, channel or result.
 *
 * @example
 * ```ts
 * import { recordEvidence } from "./data-commands.ts";
 * await recordEvidence(args, env); // { recorded: true }
 * ```
 */
export async function recordEvidence(
  args: ParsedArgs,
  env: CommandEnv,
): Promise<{ readonly recorded: true }> {
  const topic = requireTopicId(args);
  const channel = requireOneOf(args, "channel", CHANNELS);
  const result = requireOneOf(args, "result", [
    "positive",
    "negative",
  ] as const);
  const parsed = parseEvidence({
    channel,
    topic,
    result,
    at: env.now,
    session: env.session,
  });
  if (!parsed.ok) throw new CliUsageError();
  const { entries } = await loadMergedCatalog(env);
  requireCatalogEntry(entries, topic);
  await lockedState(env, () => appendEvidence(env.dir, parsed.value));
  return { recorded: true };
}

/**
 * `set-mute <on|off>`: mutes or unmutes the mentor.
 *
 * @example
 * ```ts
 * import { setMute } from "./data-commands.ts";
 * await setMute(args, env); // { muted: true }
 * ```
 */
export async function setMute(
  args: ParsedArgs,
  env: CommandEnv,
): Promise<{ readonly muted: boolean }> {
  const muted = onOff(args);
  await updateState(env, (state) => ({ ...state, muted }));
  return { muted };
}

/**
 * `set-topic-mute <on|off> --topic <id>`: adds the topic to or removes it
 * from `mutedTopics`. Muting requires a catalog topic; unmuting accepts any
 * well-formed id, so a topic dropped from the catalog can still be unmuted.
 * The state update runs under the data lock; the catalog check for muting
 * reads the catalog before it, so a concurrent `set-topic-override` or
 * import can change the catalog in between.
 *
 * @throws CliUsageError for a malformed id, or an unknown one when muting.
 *
 * @example
 * ```ts
 * import { setTopicMute } from "./data-commands.ts";
 * await setTopicMute(args, env); // { topic: "plan-mode", muted: true }
 * ```
 */
export async function setTopicMute(
  args: ParsedArgs,
  env: CommandEnv,
): Promise<{ readonly topic: TopicId; readonly muted: boolean }> {
  const muted = onOff(args);
  const topic = requireTopicId(args);
  if (muted) {
    const { entries } = await loadMergedCatalog(env);
    requireCatalogEntry(entries, topic);
  }
  await updateState(env, (state) => ({
    ...state,
    mutedTopics: toggled(state.mutedTopics, topic, muted),
  }));
  return { topic, muted };
}

/**
 * `exclude-project <add|remove> --path <absolute path>`: adds the project
 * to or removes it from `excludedProjects`.
 *
 * `add` stores the canonical form ({@link canonicalProject}: the real path
 * with symlinks resolved, or the normalised path when it cannot be
 * resolved). When that canonical form is longer than
 * {@link MAX_PROJECT_LENGTH}, the lexically normalised given path is stored
 * instead; it still excludes the project, since the hook compares real forms
 * when it runs. A project is never listed twice: `add` first drops every
 * stored entry naming the same project, and `remove` drops exactly those.
 * A stored entry names the same project when its normalised or canonical
 * form equals the canonical form, the normalised given path or the path as
 * given, so a legacy entry (a trailing separator, a symlink path) is matched
 * too. On `darwin` and `win32` that comparison is case-insensitive
 * ({@link foldProjectCase}) and `add` keeps the latest spelling; elsewhere
 * it is case-sensitive, including on a Linux case-insensitive mount (a
 * known limit). Symlinks of the entries already stored are resolved before
 * the data lock is taken (from an unlocked read of the state); under the
 * lock the authoritative state is re-read and only entries added since then
 * are resolved there.
 *
 * @param options - Optional `platform` (default `process.platform`) and
 *   `realpath` overrides; real callers pass nothing.
 * @throws CliUsageError for a missing or non-absolute path.
 *
 * @example
 * ```ts
 * import { excludeProject } from "./data-commands.ts";
 * await excludeProject(args, env); // { excludedProjects: 1 }
 * ```
 */
export async function excludeProject(
  args: ParsedArgs,
  env: CommandEnv,
  options: ProjectPathOptions = {},
): Promise<{ readonly excludedProjects: number }> {
  const add = args.positional === "add";
  if (!add && args.positional !== "remove") throw new CliUsageError();
  const project = requireAbsolutePath(args, "path");
  const resolver: Pick<ProjectPathOptions, "realpath"> = options;
  const key = (p: string): string => foldProjectCase(p, options.platform);
  const canonical = canonicalProject(project, resolver);
  const normalized = normalizeProjectPath(project);
  const forms = new Set([canonical, normalized, project].map(key));
  const sameProject = (entry: string): boolean =>
    forms.has(key(normalizeProjectPath(entry))) ||
    forms.has(key(canonicalProject(entry, resolver)));
  const toStore =
    canonical.length > MAX_PROJECT_LENGTH ? normalized : canonical;
  // Resolve the entries stored now outside the lock (realpath can be slow);
  // inside, only an entry added concurrently since this read is resolved.
  const before = await loadState(env.dir, env.now);
  const known = new Map(
    before.excludedProjects.map((entry) => [entry, sameProject(entry)]),
  );
  const next = await updateState(env, (state) => {
    const kept = state.excludedProjects.filter(
      (entry) => !(known.get(entry) ?? sameProject(entry)),
    );
    return { ...state, excludedProjects: add ? [...kept, toStore] : kept };
  });
  return { excludedProjects: next.excludedProjects.length };
}

/**
 * `get-goals`: the stored goals text (`""` when none).
 *
 * @example
 * ```ts
 * import { getGoals } from "./data-commands.ts";
 * const { goals } = await getGoals(env);
 * ```
 */
export async function getGoals(
  env: CommandEnv,
): Promise<{ readonly goals: string }> {
  return { goals: await loadGoals(env.dir) };
}

/**
 * `set-goals --text <string>`: replaces the goals; reports their UTF-8 size.
 *
 * @throws CliUsageError when `--text` is missing.
 *
 * @example
 * ```ts
 * import { setGoals } from "./data-commands.ts";
 * await setGoals(args, env); // { bytes: 11 }
 * ```
 */
export async function setGoals(
  args: ParsedArgs,
  env: CommandEnv,
): Promise<{ readonly bytes: number }> {
  const text = requireValue(args, "text");
  await lockedState(env, () => saveGoals(env.dir, text));
  return { bytes: Buffer.byteLength(text, "utf8") };
}

/**
 * `set-changelog-version --version <v>`: records the last changelog version
 * the learner was shown (1 to 64 ASCII letters, digits, `.`, `+` or `-`).
 *
 * @throws CliUsageError when `--version` is missing or malformed (checked
 * before the state is read or written).
 *
 * @example
 * ```ts
 * import { setChangelogVersion } from "./data-commands.ts";
 * await setChangelogVersion(args, env); // { lastChangelogVersion: "1.2.3" }
 * ```
 */
export async function setChangelogVersion(
  args: ParsedArgs,
  env: CommandEnv,
): Promise<{ readonly lastChangelogVersion: string }> {
  const version = requireValue(args, "version");
  if (!isChangelogVersion(version)) throw new CliUsageError();
  await updateState(env, (state) => ({
    ...state,
    lastChangelogVersion: version,
  }));
  return { lastChangelogVersion: version };
}

/**
 * `export --to <absolute path>`: writes an export bundle and reports how
 * many evidence and exam item lines were skipped as torn or invalid.
 *
 * @throws CliUsageError for a missing or non-absolute path.
 *
 * @example
 * ```ts
 * import { exportData } from "./data-commands.ts";
 * await exportData(args, env);
 * // { exported: true, evidenceSkipped: 0, examItemsSkipped: 0 }
 * ```
 */
export async function exportData(
  args: ParsedArgs,
  env: CommandEnv,
): Promise<{
  readonly exported: true;
  readonly evidenceSkipped: number;
  readonly examItemsSkipped: number;
}> {
  const to = requireAbsolutePath(args, "to");
  const { evidenceSkipped, examItemsSkipped } = await exportBundleToFile(
    env.dir,
    env.now,
    to,
  );
  return { exported: true, evidenceSkipped, examItemsSkipped };
}

/**
 * `import --from <absolute path> --replace`: replaces all stored data with
 * a bundle. Without `--replace` nothing is read or changed.
 *
 * @throws CliUsageError for a missing or non-absolute path.
 * @throws MentorStateError `CONFIRMATION_REQUIRED` without `--replace`.
 *
 * @example
 * ```ts
 * import { importData } from "./data-commands.ts";
 * const summary = await importData(args, env);
 * ```
 */
export async function importData(
  args: ParsedArgs,
  env: CommandEnv,
): Promise<ImportSummary> {
  const from = requireAbsolutePath(args, "from");
  if (!args.booleans.has("replace")) {
    throw new MentorStateError(
      "CONFIRMATION_REQUIRED",
      "import replaces all stored mentor data; pass --replace to confirm",
    );
  }
  // importBundleFromFile takes the lock itself: never wrap it in lockedState.
  return importBundleFromFile(
    env.dir,
    from,
    { replace: true },
    { lock: cliLockOptions(env) },
  );
}

/**
 * `purge --confirm`: deletes everything the mentor stores. Without
 * `--confirm` nothing is deleted.
 *
 * @throws MentorStateError `CONFIRMATION_REQUIRED` without `--confirm`.
 *
 * @example
 * ```ts
 * import { purge } from "./data-commands.ts";
 * const { deleted } = await purge(args, env);
 * ```
 */
export async function purge(
  args: ParsedArgs,
  env: CommandEnv,
): Promise<PurgeResult> {
  if (!args.booleans.has("confirm")) {
    throw new MentorStateError(
      "CONFIRMATION_REQUIRED",
      "purge deletes all stored mentor data; pass --confirm to confirm",
    );
  }
  // purgeData takes the lock itself: never wrap it in lockedState.
  return purgeData(env.dir, { confirm: true }, { lock: cliLockOptions(env) });
}
