/**
 * The PostToolUse hook: records observed usage of Claude Code features as
 * evidence. It never prints anything.
 */
import path from "node:path";
import { extractUsageSignals, signalToEvidence, } from "../../internal/signals.js";
import { appendEvidence, loadState, readEvidence, } from "../../internal/store.js";
import { payloadSession } from "../common.js";
/** How many recent evidence events the per-session rate limit inspects. */
const RATE_LIMIT_WINDOW = 500;
/** `path.normalize` without a trailing separator (except for the root). */
function normalizeDir(dir) {
    const normalized = path.normalize(dir);
    return normalized.length > 1 && normalized.endsWith(path.sep)
        ? normalized.slice(0, -path.sep.length)
        : normalized;
}
/**
 * Whether `cwd` is `excluded` or lies beneath it, compared lexically on
 * normalised paths with a separator boundary (`/a/b` covers `/a/b/c` but
 * not `/a/bc`). Symlinks are not resolved, so an excluded project should be
 * stored by its real path.
 */
function isWithin(excluded, cwd) {
    const base = normalizeDir(excluded);
    const target = normalizeDir(cwd);
    if (target === base)
        return true;
    const prefix = base.endsWith(path.sep) ? base : base + path.sep;
    return target.startsWith(prefix);
}
/**
 * Handles `PostToolUse`. A no-op (resolving `null` without touching disk)
 * when the `session_id` is invalid, transcript analysis is off, or the event
 * yields no usage signal for an enabled catalog topic. Otherwise it loads the
 * state and fails closed on project exclusion: when any project is excluded
 * and the payload `cwd` is unknown (`null`) or lies inside an excluded
 * project (lexical path match, symlinks not resolved), it records nothing.
 * Else it appends one positive `observed` event per remaining signal,
 * skipping a topic that already has an `observed` event from the same
 * session among the last 500 events. That per-session rate limit is best
 * effort: parallel `PostToolUse` calls can both pass the check and both
 * append. Always resolves `null`; never recomputes levels or writes state.
 *
 * @example
 * ```ts
 * import { runHook } from "./process-shell.js";
 * import { postToolUseHandler } from "./handlers/post-tool-use.js";
 * await runHook("PostToolUse", postToolUseHandler);
 * ```
 */
export const postToolUseHandler = async (payload, deps) => {
    const session = payloadSession(payload);
    if (session === null || !deps.settings.transcriptAnalysis)
        return null;
    const enabled = new Set(deps.catalog.filter((entry) => entry.enabled).map((entry) => entry.id));
    const signals = extractUsageSignals(payload).filter((signal) => enabled.has(signal.topic));
    if (signals.length === 0)
        return null;
    const { excludedProjects } = await loadState(deps.dir, deps.now);
    const cwd = deps.cwd;
    if (excludedProjects.length > 0 &&
        (cwd === null ||
            excludedProjects.some((excluded) => isWithin(excluded, cwd)))) {
        return null;
    }
    const { events } = await readEvidence(deps.dir, {
        maxEvents: RATE_LIMIT_WINDOW,
    });
    const seen = new Set(events
        .filter((e) => e.channel === "observed" && e.session === session)
        .map((e) => e.topic));
    for (const signal of signals) {
        if (seen.has(signal.topic))
            continue;
        seen.add(signal.topic);
        await appendEvidence(deps.dir, signalToEvidence(signal, session, deps.now));
    }
    return null;
};
//# sourceMappingURL=post-tool-use.js.map