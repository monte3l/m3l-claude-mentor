import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Minimal frontmatter reader: top-level `key: value` lines only. */
function frontmatter(text: string): Record<string, string> {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (match?.[1] === undefined) throw new Error("no frontmatter block");
  const out: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv?.[1] !== undefined && kv[2] !== undefined) {
      out[kv[1]] = kv[2].trim().replace(/^(["'])(.*)\1$/, "$2");
    }
  }
  return out;
}

const SKILLS = [
  "ask",
  "assess",
  "exam",
  "profile",
  "quiz",
  "teach",
  "whats-new",
];

const manifest = JSON.parse(
  readFileSync(join(ROOT, ".claude-plugin", "plugin.json"), "utf8"),
) as Record<string, unknown>;

describe("plugin contract: skills", () => {
  // Presence, not equality: a new skill is a MINOR release (README bump
  // table), so additions are intentionally allowed.
  test("the skill directory set contains every frozen name", () => {
    const dirs = readdirSync(join(ROOT, "skills"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(dirs).toEqual(expect.arrayContaining([...SKILLS]));
  });

  test.each(SKILLS)("skills/%s/SKILL.md frontmatter name matches", (name) => {
    const text = readFileSync(join(ROOT, "skills", name, "SKILL.md"), "utf8");
    expect(frontmatter(text)["name"]).toBe(name);
  });
});

describe("plugin contract: plugin.json", () => {
  test("the plugin name is m3l-mentor", () => {
    expect(manifest["name"]).toBe("m3l-mentor");
  });

  // Presence, not equality: a new option is a MINOR release (README bump
  // table), so additions are intentionally allowed.
  test("userConfig contains dial and transcriptAnalysis", () => {
    const userConfig = manifest["userConfig"] as Record<string, unknown>;
    expect(Object.keys(userConfig)).toEqual(
      expect.arrayContaining(["dial", "transcriptAnalysis"]),
    );
  });

  test("dial is a number 0..5 defaulting to 2", () => {
    const userConfig = manifest["userConfig"] as Record<
      string,
      Record<string, unknown>
    >;
    expect(userConfig["dial"]).toMatchObject({
      type: "number",
      default: 2,
      min: 0,
      max: 5,
    });
  });

  test("transcriptAnalysis is a boolean defaulting to true", () => {
    const userConfig = manifest["userConfig"] as Record<
      string,
      Record<string, unknown>
    >;
    expect(userConfig["transcriptAnalysis"]).toMatchObject({
      type: "boolean",
      default: true,
    });
  });
});
