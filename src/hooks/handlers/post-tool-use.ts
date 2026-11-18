/**
 * The PostToolUse hook: records observed usage of Claude Code features as
 * evidence. It never prints anything.
 */
import {
  extractUsageSignals,
  signalToEvidence,
  type UsageSignal,
} from "../../internal/signals.ts";
import { withStateLock } from "../../internal/lock.ts";
import {
  appendEvidence,
  loadState,
  readEvidence,
} from "../../internal/store.ts";
import { isProjectExcluded } from "../../internal/project-exclusion.ts";
import { payloadSession } from "../common.ts";
import type { HookHandler } from "../runtime.ts";

/** How many recent evidence events the per-session rate limit inspects. */
const RATE_LIMIT_WINDOW = 500;

/**
 * Handles `PostToolUse`. A no-op (resolving `null` without touching disk)
 * when the `session_id` is invalid, transcript analysis is off, or the event
 * yields no usage signal for an enabled catalog topic. Otherwise it loads the
 * state and fails closed on project exclusion: when any project is excluded
 * and the payload `cwd` is unknown (`null`) or lies inside an excluded
 * project (matched lexically and through resolved symlinks, see
 * {@link isProjectExcluded}), it records nothing.
 * Else it appends one positive `observed` event per remaining signal,
 * skipping a topic that already has an `observed` event from the same
 * session among the last 500 events. The rate-limit read and the appends run
 * together under the data lock (`withStateLock`), so parallel `PostToolUse`
 * calls for the same session and topic append exactly one event; the
 * exclusion check's state read stays outside (read only), so an
 * `exclude-project` committed while this hook runs can still be followed by
 * one append, ordered as if the append had come first. A lock timeout
 * propagates: one `LOCK_TIMEOUT` stderr line, nothing appended. Always
 * resolves `null`; never recomputes levels or writes state.
 *
 * @example
 * ```ts
 * import { runHook } from "./process-shell.ts";
 * import { postToolUseHandler } from "./handlers/post-tool-use.ts";
 * await runHook("PostToolUse", postToolUseHandler);
 * ```
 */
export const postToolUseHandler: HookHandler = async (payload, deps) => {
  const session = payloadSession(payload);
  if (session === null || !deps.settings.transcriptAnalysis) return null;

  const enabled = new Set(
    deps.catalog.filter((entry) => entry.enabled).map((entry) => entry.id),
  );
  const signals: readonly UsageSignal[] = extractUsageSignals(payload).filter(
    (signal) => enabled.has(signal.topic),
  );
  if (signals.length === 0) return null;

  const { excludedProjects } = await loadState(deps.dir, deps.now);
  const cwd = deps.cwd;
  if (
    excludedProjects.length > 0 &&
    (cwd === null || isProjectExcluded(excludedProjects, cwd))
  ) {
    return null;
  }

  await withStateLock(
    deps.dir,
    async () => {
      const { events } = await readEvidence(deps.dir, {
        maxEvents: RATE_LIMIT_WINDOW,
      });
      const seen = new Set<string>(
        events
          .filter((e) => e.channel === "observed" && e.session === session)
          .map((e) => e.topic),
      );
      for (const signal of signals) {
        if (seen.has(signal.topic)) continue;
        seen.add(signal.topic);
        await appendEvidence(
          deps.dir,
          signalToEvidence(signal, session, deps.now),
        );
      }
    },
    deps.lockOptions,
  );
  return null;
};
