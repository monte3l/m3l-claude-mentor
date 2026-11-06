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
export type PromptSignal = {
    readonly kind: "just-tell-me";
} | {
    readonly kind: "stop-tips";
} | {
    readonly kind: "resume-tips";
} | {
    readonly kind: "stop-tips-topic";
    readonly topic: TopicId;
} | {
    readonly kind: "teach-next";
    readonly topic: TopicId;
};
/**
 * Only this many leading characters of a prompt are scanned.
 *
 * @example
 * ```ts
 * import { MAX_PROMPT_CHARS } from "./prompt-signals.js";
 * MAX_PROMPT_CHARS; // 4_000
 * ```
 */
export declare const MAX_PROMPT_CHARS = 4000;
/**
 * The most signals {@link detectPromptSignals} returns for one prompt.
 *
 * @example
 * ```ts
 * import { MAX_PROMPT_SIGNALS } from "./prompt-signals.js";
 * MAX_PROMPT_SIGNALS; // 3
 * ```
 */
export declare const MAX_PROMPT_SIGNALS = 3;
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
export declare function detectPromptSignals(prompt: unknown, catalog: readonly CatalogEntry[]): readonly PromptSignal[];
//# sourceMappingURL=prompt-signals.d.ts.map