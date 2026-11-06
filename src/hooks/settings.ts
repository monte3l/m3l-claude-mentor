/**
 * The plugin's user options as seen by a hook, read from the
 * `CLAUDE_PLUGIN_OPTION_*` environment variables Claude Code sets.
 */

/** Environment variable carrying the `dial` user option. */
const DIAL_ENV = "CLAUDE_PLUGIN_OPTION_DIAL";

/** Environment variable carrying the `transcriptAnalysis` user option. */
const TRANSCRIPT_ANALYSIS_ENV = "CLAUDE_PLUGIN_OPTION_TRANSCRIPTANALYSIS";

/**
 * The hook-relevant user options.
 *
 * @example
 * ```ts
 * import type { HookSettings } from "./settings.js";
 * const settings: HookSettings = { dial: 3, transcriptAnalysis: false };
 * ```
 */
export interface HookSettings {
  /** How talkative the mentor is: 0 (silent) to 5 (most tips). */
  readonly dial: 0 | 1 | 2 | 3 | 4 | 5;
  /** Whether tool use is analysed for evidence of skill. */
  readonly transcriptAnalysis: boolean;
}

/**
 * The settings used when an option is unset or unparseable: dial 2,
 * transcript analysis on. Frozen.
 *
 * @example
 * ```ts
 * import { DEFAULT_SETTINGS } from "./settings.js";
 * DEFAULT_SETTINGS.dial; // 2
 * ```
 */
export const DEFAULT_SETTINGS: HookSettings = Object.freeze({
  dial: 2,
  transcriptAnalysis: true,
});

/** Reads `env[key]` once, as an own property; `undefined` otherwise. */
function ownString(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
): string | undefined {
  if (!Object.hasOwn(env, key)) return undefined;
  const value: unknown = env[key];
  return typeof value === "string" ? value : undefined;
}

function parseDial(raw: string | undefined): HookSettings["dial"] {
  const text = raw?.trim() ?? "";
  switch (text) {
    case "0":
      return 0;
    case "1":
      return 1;
    case "2":
      return 2;
    case "3":
      return 3;
    case "4":
      return 4;
    case "5":
      return 5;
    default:
      return DEFAULT_SETTINGS.dial;
  }
}

function parseFlag(raw: string | undefined, fallback: boolean): boolean {
  const text = raw?.trim().toLowerCase();
  if (text === "true" || text === "1") return true;
  if (text === "false" || text === "0") return false;
  return fallback;
}

/**
 * Reads the hook settings from the environment. Each variable is read once,
 * as an own property, and trimmed. `CLAUDE_PLUGIN_OPTION_DIAL` must be a
 * single digit 0 to 5 (so `"2.0"`, `"03"` and `"+3"` fall back); the
 * transcript flag accepts `true`/`1` and `false`/`0`, case-insensitively.
 * Anything else, including unset or empty, yields the {@link
 * DEFAULT_SETTINGS} value for that option. Never throws.
 *
 * @param env - The environment to read, such as `process.env`.
 * @returns The settings.
 *
 * @example
 * ```ts
 * import { readSettings } from "./settings.js";
 * readSettings({ CLAUDE_PLUGIN_OPTION_DIAL: "4" }); // { dial: 4, transcriptAnalysis: true }
 * ```
 */
export function readSettings(
  env: Readonly<Record<string, string | undefined>>,
): HookSettings {
  return {
    dial: parseDial(ownString(env, DIAL_ENV)),
    transcriptAnalysis: parseFlag(
      ownString(env, TRANSCRIPT_ANALYSIS_ENV),
      DEFAULT_SETTINGS.transcriptAnalysis,
    ),
  };
}
