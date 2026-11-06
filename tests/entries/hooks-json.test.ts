import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ROOT } from "./spawn-helpers.js";

interface HookCommand {
  type?: string;
  command?: string;
  args?: string[];
  timeout?: number;
}
interface Group {
  matcher?: string;
  hooks: HookCommand[];
}
interface Manifest {
  description?: unknown;
  hooks: Record<string, Group[]>;
}

const manifest = JSON.parse(
  readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8"),
) as Manifest;

function scriptOf(group: Group): string | undefined {
  return group.hooks[0]?.args?.[0];
}

describe("hooks/hooks.json", () => {
  test("is a wrapper with a description and a hooks map", () => {
    expect(typeof manifest.description).toBe("string");
    expect(Object.keys(manifest.hooks).sort()).toEqual([
      "PostCompact",
      "PostToolUse",
      "SessionStart",
      "Stop",
      "UserPromptSubmit",
    ]);
  });

  test("SessionStart has two groups, both running entry-session-start", () => {
    const groups = manifest.hooks["SessionStart"] ?? [];
    expect(groups.map((g) => g.matcher)).toEqual([
      "startup|resume|clear|fork",
      "compact",
    ]);
    for (const g of groups) {
      expect(scriptOf(g)).toBe(
        "${CLAUDE_PLUGIN_ROOT}/dist/hooks/entry-session-start.js",
      );
    }
  });

  test.each([
    ["UserPromptSubmit", "entry-user-prompt-submit.js", undefined],
    [
      "PostToolUse",
      "entry-post-tool-use.js",
      "Write|Edit|Bash|Skill|Agent|EnterPlanMode|ExitPlanMode",
    ],
    ["Stop", "entry-stop.js", undefined],
    ["PostCompact", "entry-post-compact.js", undefined],
  ])("%s has one group running %s", (event, file, matcher) => {
    const groups = manifest.hooks[event] ?? [];
    expect(groups).toHaveLength(1);
    expect(groups[0]?.matcher).toBe(matcher);
    expect(scriptOf(groups[0] as Group)).toBe(
      `\${CLAUDE_PLUGIN_ROOT}/dist/hooks/${file}`,
    );
  });

  test("every hook uses exec form with node and a timeout", () => {
    for (const groups of Object.values(manifest.hooks)) {
      for (const group of groups) {
        expect(group.hooks.length).toBeGreaterThan(0);
        for (const hook of group.hooks) {
          expect(hook.type).toBe("command");
          expect(hook.command).toBe("node");
          expect(hook.args).toHaveLength(1);
          expect(hook.args?.[0]).toMatch(
            /^\$\{CLAUDE_PLUGIN_ROOT\}\/dist\/hooks\/entry-[a-z-]+\.js$/u,
          );
          expect(typeof hook.timeout).toBe("number");
          expect(hook.timeout).toBeGreaterThan(0);
        }
      }
    }
  });

  test("every referenced script exists after the build", () => {
    for (const groups of Object.values(manifest.hooks)) {
      for (const group of groups) {
        for (const hook of group.hooks) {
          const resolved = (hook.args?.[0] ?? "").replace(
            "${CLAUDE_PLUGIN_ROOT}",
            ROOT,
          );
          expect(
            existsSync(resolved),
            `${resolved} missing: run pnpm build`,
          ).toBe(true);
        }
      }
    }
  });
});
