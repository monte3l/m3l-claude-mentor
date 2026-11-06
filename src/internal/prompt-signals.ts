/**
 * In-session instructions detected in a `UserPromptSubmit` prompt: "just tell
 * me", stopping or resuming tips (globally or for one topic), and asking to
 * learn a topic next.
 *
 * Pure: no I/O, no environment, no clock. Output is built only from fixed
 * kinds and catalog topic ids, so no prompt text is ever returned.
 */
import { matchTopics } from "./catalog.js";
import type { CatalogEntry, TopicId } from "./schema.js";

/**
 * One instruction detected in a prompt.
 *
 * @example
 * ```ts
 * import type { PromptSignal } from "./prompt-signals.js";
 * const s: PromptSignal = { kind: "stop-tips" };
 * ```
 */
export type PromptSignal =
  | { readonly kind: "just-tell-me" }
  | { readonly kind: "stop-tips" }
  | { readonly kind: "resume-tips" }
  | { readonly kind: "stop-tips-topic"; readonly topic: TopicId }
  | { readonly kind: "teach-next"; readonly topic: TopicId };

/**
 * Only this many leading characters of a prompt are scanned.
 *
 * @example
 * ```ts
 * import { MAX_PROMPT_CHARS } from "./prompt-signals.js";
 * MAX_PROMPT_CHARS; // 4_000
 * ```
 */
export const MAX_PROMPT_CHARS = 4_000;

/**
 * The most signals {@link detectPromptSignals} returns for one prompt.
 *
 * @example
 * ```ts
 * import { MAX_PROMPT_SIGNALS } from "./prompt-signals.js";
 * MAX_PROMPT_SIGNALS; // 3
 * ```
 */
export const MAX_PROMPT_SIGNALS = 3;

/** How far past a topic phrase the topic words may run. */
const MAX_TOPIC_WORDS_CHARS = 80;

const PASTED_OPEN = "<pasted_content";
const PASTED_CLOSE = "</pasted_content";

const JUST_TELL_ME =
  /\b(?:just\s+tell\s+me|just\s+give\s+me\s+the\s+answer|skip\s+the\s+explanations?|no\s+explanations?\s+needed)\b/g;
const STOP_TOPIC =
  /\b(?:stop|no\s+more|mute|disable)\s+tips\s+(?:about|on|for)\b/g;
const STOP_GLOBAL =
  /\b(?:stop(?:\s+the)?\s+tips|no\s+more\s+tips|mute(?:\s+the)?\s+tips|disable\s+tips|turn\s+off\s+tips)\b(?!\s+(?:about|on|for)\b)/g;
const RESUME =
  /\b(?:resume\s+tips|unmute\s+tips|turn\s+tips\s+(?:back\s+)?on|enable\s+tips)\b/g;
const TEACH = /\b(?:teach\s+me|let['’]?s\s+learn)\b/g;
const SENTENCE_END = /[.!?\n]/;
/** A time phrase right after "stop tips for" makes the stop global. */
const TIME_TAIL =
  /^\s+(?:now|today|tonight|a\s+while|a\s+bit|the\s+moment|this\s+session|this\s+conversation)\b/;
/** A negation immediately before a phrase (only whitespace between). */
const NEGATED = /\b(?:don['’]?t|do\s+not|never|not)\s+$/;

interface Hit {
  readonly at: number;
  readonly key: string;
  readonly signal: PromptSignal;
}

/**
 * Lower-cases the scan window and blanks every `<pasted_content ...>` block
 * (an unterminated one runs to the end), since the user did not write it.
 */
function cleanPrompt(prompt: string): string {
  const text = prompt.slice(0, MAX_PROMPT_CHARS).toLowerCase();
  let out = "";
  let from = 0;
  for (;;) {
    const open = text.indexOf(PASTED_OPEN, from);
    if (open === -1) return out + text.slice(from);
    out += `${text.slice(from, open)} `;
    const close = text.indexOf(PASTED_CLOSE, open + PASTED_OPEN.length);
    const end = close === -1 ? -1 : text.indexOf(">", close);
    if (end === -1) return out;
    from = end + 1;
  }
}

/** The catalog topic named by the words after `end`, up to sentence end. */
function topicAfter(
  text: string,
  end: number,
  catalog: readonly CatalogEntry[],
): TopicId | undefined {
  const window = text.slice(end, end + MAX_TOPIC_WORDS_CHARS);
  const stop = window.search(SENTENCE_END);
  const words = stop === -1 ? window : window.slice(0, stop);
  return matchTopics(catalog, words, 1)[0]?.id;
}

const GLOBAL_STOP: PromptSignal = { kind: "stop-tips" };

function collectHits(text: string, catalog: readonly CatalogEntry[]): Hit[] {
  const hits: Hit[] = [];
  const push = (hit: Hit): void => {
    // The prefix is at most MAX_PROMPT_CHARS long, which bounds the scan.
    if (!NEGATED.test(text.slice(0, hit.at))) hits.push(hit);
  };
  for (const m of text.matchAll(JUST_TELL_ME)) {
    push({ at: m.index, key: "just", signal: { kind: "just-tell-me" } });
  }
  for (const m of text.matchAll(STOP_GLOBAL)) {
    push({ at: m.index, key: "stop", signal: GLOBAL_STOP });
  }
  for (const m of text.matchAll(RESUME)) {
    push({ at: m.index, key: "resume", signal: { kind: "resume-tips" } });
  }
  for (const m of text.matchAll(STOP_TOPIC)) {
    const end = m.index + m[0].length;
    if (TIME_TAIL.test(text.slice(end, end + MAX_TOPIC_WORDS_CHARS))) {
      push({ at: m.index, key: "stop", signal: GLOBAL_STOP });
      continue;
    }
    const topic = topicAfter(text, end, catalog);
    if (topic === undefined) continue;
    push({
      at: m.index,
      key: `stop:${topic}`,
      signal: { kind: "stop-tips-topic", topic },
    });
  }
  for (const m of text.matchAll(TEACH)) {
    const topic = topicAfter(text, m.index + m[0].length, catalog);
    if (topic === undefined) continue;
    push({
      at: m.index,
      key: `teach:${topic}`,
      signal: { kind: "teach-next", topic },
    });
  }
  return hits;
}

/** The last position a hit with `key` occurs at, or -1. */
function lastAt(hits: readonly Hit[], key: string): number {
  let last = -1;
  for (const h of hits) if (h.key === key && h.at > last) last = h.at;
  return last;
}

/**
 * Detects in-session instructions in a `UserPromptSubmit` prompt.
 *
 * A non-string `prompt` yields `[]`. Only the first {@link MAX_PROMPT_CHARS}
 * characters are scanned, case-insensitively, with `<pasted_content ...>`
 * blocks ignored (an unterminated block runs to the end). A topic phrase
 * ("stop tips about ...", "teach me ...", "let's learn ...") yields a signal
 * only when {@link matchTopics} finds a catalog topic in the words that follow
 * (up to the sentence end or 80 chars); otherwise it yields nothing, except
 * that a stop phrase followed by a time word ("for now", "for today", "for
 * this session", ...) is a global stop. A phrase immediately preceded by
 * "don't", "dont", "do not", "never" or "not" yields nothing. When both a
 * global stop and a resume appear, only the later one is kept. Signals are
 * ordered by first occurrence, one per kind (per topic for topic kinds), and
 * capped at {@link MAX_PROMPT_SIGNALS}. Never returns prompt text.
 *
 * This is a best-effort heuristic over free text, not a parser: a topic word
 * that merely appears in the following words is taken as the topic (an
 * accidental match is possible), and negation is recognised only directly
 * before a phrase ("I don't think you should stop tips" still stops them).
 *
 * @example
 * ```ts
 * import { detectPromptSignals } from "./prompt-signals.js";
 * detectPromptSignals("just tell me, and stop tips", []);
 * // [{ kind: "just-tell-me" }, { kind: "stop-tips" }]
 * ```
 */
export function detectPromptSignals(
  prompt: unknown,
  catalog: readonly CatalogEntry[],
): readonly PromptSignal[] {
  if (typeof prompt !== "string") return [];
  const hits = collectHits(cleanPrompt(prompt), catalog);

  const lastStop = lastAt(hits, "stop");
  const lastResume = lastAt(hits, "resume");
  const loser =
    lastStop === -1 || lastResume === -1
      ? undefined
      : lastStop > lastResume
        ? "resume"
        : "stop";

  hits.sort((a, b) => a.at - b.at);
  const seen = new Set<string>();
  const out: PromptSignal[] = [];
  for (const h of hits) {
    if (h.key === loser || seen.has(h.key)) continue;
    seen.add(h.key);
    out.push(h.signal);
    if (out.length === MAX_PROMPT_SIGNALS) break;
  }
  return out;
}
