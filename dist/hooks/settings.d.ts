/**
 * The plugin's user options as seen by a hook, read from the
 * `CLAUDE_PLUGIN_OPTION_*` environment variables Claude Code sets.
 */
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
export declare const DEFAULT_SETTINGS: HookSettings;
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
export declare function readSettings(env: Readonly<Record<string, string | undefined>>): HookSettings;
//# sourceMappingURL=settings.d.ts.map