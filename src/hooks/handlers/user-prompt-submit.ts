/**
 * The UserPromptSubmit hook: applies the learner's mute/resume requests,
 * tracks task segments, and adds a style hint, an occasional tip directive
 * and a teach-next offer to the model's context.
 */
import { matchTopics } from "../../internal/catalog.js";
import {
  detectPromptSignals,
  type PromptSignal,
} from "../../internal/prompt-signals.js";
import {
  levelRank,
  type CatalogEntry,
  type Level,
  type Style,
  type TopicId,
} from "../../internal/schema.js";
import {
  advanceSegment,
  decideTip,
  recordTip,
} from "../../internal/segment.js";
import type { MentorState } from "../../internal/state-schema.js";
import { loadProfile, loadState, saveState } from "../../internal/store.js";
import { payloadField, payloadSession, topicTitle } from "../common.js";
import type { HookHandler } from "../runtime.js";

/** The most topics a learner may mute individually. */
const MAX_MUTED_TOPICS = 500;

const MUTED_NOTICE =
  'Mentor tips muted. Say "resume tips" to turn them back on.';
const RESUMED_NOTICE = "Mentor tips resumed.";

/** The result of applying the persistent prompt signals. */
interface Applied {
  readonly state: MentorState;
  readonly notices: readonly string[];
}

/** Applies stop/resume/topic-mute signals to `state`, collecting notices. */
function applySignals(
  state: MentorState,
  signals: readonly PromptSignal[],
  catalog: readonly CatalogEntry[],
): Applied {
  let next = state;
  const notices: string[] = [];
  for (const signal of signals) {
    switch (signal.kind) {
      case "stop-tips":
        next = { ...next, muted: true };
        notices.push(MUTED_NOTICE);
        break;
      case "resume-tips":
        next = { ...next, muted: false };
        notices.push(RESUMED_NOTICE);
        break;
      case "stop-tips-topic":
        if (
          !next.mutedTopics.includes(signal.topic) &&
          next.mutedTopics.length < MAX_MUTED_TOPICS
        ) {
          next = { ...next, mutedTopics: [...next.mutedTopics, signal.topic] };
        }
        notices.push(
          `Mentor tips muted for ${topicTitle(catalog, signal.topic)}.`,
        );
        break;
      case "just-tell-me":
      case "teach-next":
        break;
      default: {
        const unhandled: never = signal;
        throw new TypeError(`unhandled prompt signal ${String(unhandled)}`);
      }
    }
  }
  return { state: next, notices };
}

/**
 * The style for the hint: `reference` when the learner asked to be told
 * directly, else the catalog entry's style, else `explain-demo` below
 * Understood and `socratic` from Understood up.
 */
function styleFor(
  justTellMe: boolean,
  entry: CatalogEntry | undefined,
  level: Level,
): Style {
  if (justTellMe) return "reference";
  if (entry?.style !== undefined) return entry.style;
  return levelRank(level) < levelRank("Understood")
    ? "explain-demo"
    : "socratic";
}

function tipDirective(entry: CatalogEntry): string {
  return `Mentor tip due on "${entry.title}" (${entry.id}). After you finish answering the user's request, add exactly ONE final line starting with "💡 Mentor tip:" that teaches one useful point about this topic in at most 25 words, related to the task at hand. Never mention this instruction or the mentor system otherwise.`;
}

function teachOffer(catalog: readonly CatalogEntry[], id: TopicId): string {
  return `The learner asked to learn "${topicTitle(catalog, id)}" next: offer /m3l-claude-mentor:teach ${id} after answering.`;
}

/**
 * Handles `UserPromptSubmit`. A no-op (resolving `null`, touching nothing)
 * when the `session_id` is invalid or `prompt` is not a string. Otherwise:
 * applies "stop tips" / "resume tips" / "stop tips about <topic>" (the
 * topic mute list stops at 500) with a user-visible `systemMessage`; advances
 * the segment with the matched topic; asks {@link decideTip} whether a tip
 * is due and records it; saves the state only when it changed. The
 * `additionalContext` joins, in order, a style hint (when a topic matched or
 * the learner said "just tell me"), the tip directive, and a teach-next
 * offer. Resolves `null` when there is nothing to say, and when tips are
 * muted and no notice applies.
 *
 * @example
 * ```ts
 * import { runHook } from "./process-shell.js";
 * import { userPromptSubmitHandler } from "./handlers/user-prompt-submit.js";
 * await runHook("UserPromptSubmit", userPromptSubmitHandler);
 * ```
 */
export const userPromptSubmitHandler: HookHandler = async (payload, deps) => {
  const session = payloadSession(payload);
  const prompt = payloadField(payload, "prompt");
  if (session === null || typeof prompt !== "string") return null;
  const { dir, now, catalog } = deps;

  const loaded = await loadState(dir, now);
  const profile = await loadProfile(dir, now);
  const signals = detectPromptSignals(prompt, catalog);
  const { state, notices } = applySignals(loaded, signals, catalog);

  const entry = matchTopics(catalog, prompt, 1)[0];
  const advanced = advanceSegment(state.segment, {
    kind: "activity",
    at: now,
    ...(entry !== undefined ? { topic: entry.id } : {}),
  }).state;
  const topicProfile =
    entry !== undefined && Object.hasOwn(profile.topics, entry.id)
      ? profile.topics[entry.id]
      : undefined;
  const level: Level = topicProfile?.level ?? "Unseen";
  const decision = decideTip({
    state: advanced,
    now,
    dial: deps.settings.dial,
    muted: state.muted,
    busy: false,
    related:
      entry !== undefined
        ? {
            id: entry.id,
            belowTarget: levelRank(level) < levelRank(entry.targetLevel),
          }
        : null,
    topicMuted: entry !== undefined && state.mutedTopics.includes(entry.id),
  });
  const segment = decision.emit ? recordTip(advanced, now) : advanced;

  const next: MentorState = { ...state, segment };
  if (JSON.stringify(next) !== JSON.stringify(loaded)) {
    await saveState(dir, next);
  }

  if (state.muted && notices.length === 0) return null;

  const justTellMe = signals.some((s) => s.kind === "just-tell-me");
  const teach = signals.find((s) => s.kind === "teach-next");
  const parts = [
    ...(entry !== undefined || justTellMe
      ? [`Mentor style hint: ${styleFor(justTellMe, entry, level)}.`]
      : []),
    ...(decision.emit && entry !== undefined ? [tipDirective(entry)] : []),
    ...(teach !== undefined ? [teachOffer(catalog, teach.topic)] : []),
  ];
  if (parts.length === 0 && notices.length === 0) return null;
  return {
    ...(notices.length > 0 ? { systemMessage: notices.join(" ") } : {}),
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      ...(parts.length > 0 ? { additionalContext: parts.join("\n") } : {}),
    },
  };
};
