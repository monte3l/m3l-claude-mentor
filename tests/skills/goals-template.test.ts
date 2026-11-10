import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { SKILLS_DIR, hasPhrase, headings, readSkill } from "./helpers.js";

const PATH = join(SKILLS_DIR, "profile", "references", "goals-template.md");
const SECTIONS = [
  "Goals",
  "Time horizon",
  "Preferred depth",
  "Topics of interest",
  "Topics to avoid",
];
const MAX_GOALS_BYTES = 65_536;

/** Template problems: the text is passed to the CLI inside single quotes. */
function checkTemplate(text: string): string[] {
  const problems: string[] = [];
  if (text.includes("'")) problems.push("contains a single quote");
  if (text.includes("\0")) problems.push("contains NUL");
  if (Buffer.byteLength(text) > 2000) problems.push("over 2000 bytes");
  if (JSON.stringify(headings(text)) !== JSON.stringify(SECTIONS))
    problems.push("headings differ from the five required sections");
  return problems;
}

describe("goals template", () => {
  test("has exactly the five sections in order, small and quote-free", () => {
    expect(checkTemplate(readFileSync(PATH, "utf8"))).toEqual([]);
  });

  test("fits the CLI goals rules", () => {
    expect(readFileSync(PATH).byteLength).toBeLessThanOrEqual(MAX_GOALS_BYTES);
  });

  test("profile SKILL.md offers it with the learner's agreement", () => {
    const text = readSkill("profile");
    expect(hasPhrase(text, "references/goals-template.md")).toBe(true);
    expect(hasPhrase(text, "agreement")).toBe(true);
  });

  test.each([
    ["a single quote", "## Goals\nit's\n"],
    ["a NUL", "## Goals\n\0\n"],
    [
      "a wrong heading order",
      SECTIONS.toReversed()
        .map((h) => `## ${h}\nx`)
        .join("\n"),
    ],
    [
      "a missing section",
      SECTIONS.slice(1)
        .map((h) => `## ${h}\nx`)
        .join("\n"),
    ],
    [
      "too many bytes",
      `${SECTIONS.map((h) => `## ${h}\nx`).join("\n")}\n${"a".repeat(2000)}`,
    ],
  ])("checker flags %s", (_label, text) => {
    expect(checkTemplate(text)).not.toEqual([]);
  });

  test("checker accepts a well-formed template", () => {
    expect(
      checkTemplate(SECTIONS.map((h) => `## ${h}\nline`).join("\n")),
    ).toEqual([]);
  });
});
