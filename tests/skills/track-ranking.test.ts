import { describe, expect, test } from "vitest";
import {
  cliTools,
  SKILL_COMMANDS,
  hasPhrase,
  parseFrontmatter,
  readSkill,
  sectionOf,
  skillMarkdownFiles,
  toolEntries,
  usedCommands,
} from "./helpers.ts";

/** The text of step 1 in the `## Steps` section (up to step 2). */
function stepOne(name: string): string {
  const steps = sectionOf(readSkill(name), "Steps") ?? "";
  const start = steps.indexOf("1. ");
  const end = steps.indexOf("\n2. ");
  if (start === -1 || end === -1) throw new Error(`${name}: no step 1`);
  return steps.slice(start, end);
}

describe.each(["teach", "quiz"])("%s skill: exam-track ranking", (name) => {
  test("step 1 reads activeTrackTopics and offers its topics first, by weight descending", () => {
    const one = stepOne(name);
    expect(hasPhrase(one, "activeTrackTopics")).toBe(true);
    expect(hasPhrase(one, "non-empty", true)).toBe(true);
    expect(hasPhrase(one, "offered first", true)).toBe(true);
    expect(hasPhrase(one, "weight descending", true)).toBe(true);
  });

  test("get-profile is run through the standard CLI recipe", () => {
    const used = skillMarkdownFiles(name).flatMap((f) => usedCommands(f.body));
    expect(used).toContain("get-profile");
  });

  test("allowed-tools stays exactly the subcommands the skill runs", () => {
    const { data } = parseFrontmatter(readSkill(name));
    expect(toolEntries(data["allowed-tools"])).toEqual(
      cliTools(SKILL_COMMANDS[name] ?? []),
    );
  });
});

describe("teach skill: ambient:false topics", () => {
  test("step 1 makes an ambient:false topic in activeTrackTopics a valid unprompted candidate", () => {
    const one = stepOne("teach");
    expect(hasPhrase(one, "valid unprompted candidate", true)).toBe(true);
    expect(hasPhrase(one, "ambient", true)).toBe(true);
  });

  test("step 1 still excludes other ambient:false topics unless named", () => {
    const one = stepOne("teach");
    expect(hasPhrase(one, "unless `$ARGUMENTS` names it")).toBe(true);
  });
});
