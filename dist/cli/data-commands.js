import { MentorStateError } from "../internal/errors.js";
import { exportBundleToFile, importBundleFromFile, } from "../internal/export.js";
import { describeData, purgeData, } from "../internal/purge.js";
import { CHANNELS, parseEvidence } from "../internal/schema.js";
import { appendEvidence, loadGoals, loadState, saveGoals, saveState, } from "../internal/store.js";
import { CliUsageError, requireAbsolutePath, requireOneOf, requireTopicId, requireValue, } from "./args.js";
import { loadMergedCatalog, requireCatalogEntry, } from "./env.js";
/** The positional of an on/off command as a boolean. */
function onOff(args) {
    if (args.positional === "on")
        return true;
    if (args.positional === "off")
        return false;
    throw new CliUsageError();
}
/** `list` with `item` present once (`add`) or absent (`!add`), order kept. */
function toggled(list, item, add) {
    const without = list.filter((existing) => existing !== item);
    return add ? [...without, item] : without;
}
/**
 * Loads the state, applies `change` and saves it. Not atomic across
 * processes: a concurrent writer between the load and the save is
 * overwritten (last writer wins), a known limitation.
 */
async function updateState(env, change) {
    const next = change(await loadState(env.dir, env.now));
    await saveState(env.dir, next);
    return next;
}
/**
 * `show`: what the mentor stores, without content.
 *
 * @example
 * ```ts
 * import { show } from "./data-commands.js";
 * const summary = await show(env);
 * ```
 */
export function show(env) {
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
 * import { recordEvidence } from "./data-commands.js";
 * await recordEvidence(args, env); // { recorded: true }
 * ```
 */
export async function recordEvidence(args, env) {
    const topic = requireTopicId(args);
    const channel = requireOneOf(args, "channel", CHANNELS);
    const result = requireOneOf(args, "result", [
        "positive",
        "negative",
    ]);
    const parsed = parseEvidence({
        channel,
        topic,
        result,
        at: env.now,
        session: env.session,
    });
    if (!parsed.ok)
        throw new CliUsageError();
    const { entries } = await loadMergedCatalog(env);
    requireCatalogEntry(entries, topic);
    await appendEvidence(env.dir, parsed.value);
    return { recorded: true };
}
/**
 * `set-mute <on|off>`: mutes or unmutes the mentor.
 *
 * @example
 * ```ts
 * import { setMute } from "./data-commands.js";
 * await setMute(args, env); // { muted: true }
 * ```
 */
export async function setMute(args, env) {
    const muted = onOff(args);
    await updateState(env, (state) => ({ ...state, muted }));
    return { muted };
}
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
export async function setTopicMute(args, env) {
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
export async function excludeProject(args, env) {
    const add = args.positional === "add";
    if (!add && args.positional !== "remove")
        throw new CliUsageError();
    const project = requireAbsolutePath(args, "path");
    const next = await updateState(env, (state) => ({
        ...state,
        excludedProjects: toggled(state.excludedProjects, project, add),
    }));
    return { excludedProjects: next.excludedProjects.length };
}
/**
 * `get-goals`: the stored goals text (`""` when none).
 *
 * @example
 * ```ts
 * import { getGoals } from "./data-commands.js";
 * const { goals } = await getGoals(env);
 * ```
 */
export async function getGoals(env) {
    return { goals: await loadGoals(env.dir) };
}
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
export async function setGoals(args, env) {
    const text = requireValue(args, "text");
    await saveGoals(env.dir, text);
    return { bytes: Buffer.byteLength(text, "utf8") };
}
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
export async function exportData(args, env) {
    const to = requireAbsolutePath(args, "to");
    const { evidenceSkipped } = await exportBundleToFile(env.dir, env.now, to);
    return { exported: true, evidenceSkipped };
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
 * import { importData } from "./data-commands.js";
 * const summary = await importData(args, env);
 * ```
 */
export async function importData(args, env) {
    const from = requireAbsolutePath(args, "from");
    if (!args.booleans.has("replace")) {
        throw new MentorStateError("CONFIRMATION_REQUIRED", "import replaces all stored mentor data; pass --replace to confirm");
    }
    return importBundleFromFile(env.dir, from, { replace: true });
}
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
export async function purge(args, env) {
    if (!args.booleans.has("confirm")) {
        throw new MentorStateError("CONFIRMATION_REQUIRED", "purge deletes all stored mentor data; pass --confirm to confirm");
    }
    return purgeData(env.dir, { confirm: true });
}
//# sourceMappingURL=data-commands.js.map