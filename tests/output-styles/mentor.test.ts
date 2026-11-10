import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  ROOT,
  checkFastFacts,
  hasPhrase,
  parseFrontmatter,
} from "../skills/helpers.js";

const PATH = join(ROOT, "output-styles", "mentor.md");

describe("output style mentor", () => {
  test("has the documented frontmatter and no force-for-plugin", () => {
    const { data } = parseFrontmatter(readFileSync(PATH, "utf8"));
    expect(data["name"]).toBe("Mentor");
    expect(data["description"]).toBeTruthy();
    expect(data["keep-coding-instructions"]).toBe("true");
    expect(Object.hasOwn(data, "force-for-plugin")).toBe(false);
  });

  test("body states the tip format and the terse-reference switch", () => {
    const { body } = parseFrontmatter(readFileSync(PATH, "utf8"));
    for (const needle of ["💡 Mentor tip:", "one line", "just tell me"])
      expect(hasPhrase(body, needle), needle).toBe(true);
  });

  test("is at most 4000 bytes and states no model ids, prices or limits", () => {
    const bytes = readFileSync(PATH);
    expect(bytes.byteLength).toBeLessThanOrEqual(4000);
    expect(checkFastFacts(bytes.toString("utf8"))).toEqual([]);
  });
});
