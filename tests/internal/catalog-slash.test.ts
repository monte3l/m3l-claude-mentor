import { describe, expect, test } from "vitest";
import { matchTopics, parseCatalog } from "../../src/internal/catalog.js";

function catalogWith(keywords: readonly string[]) {
  const r = parseCatalog([
    {
      id: "t",
      title: "T",
      type: "concept",
      dependencies: [],
      keywords,
      targetLevel: "Understood",
      enabled: true,
    },
  ]);
  if (!r.ok) throw new Error(`fixture invalid: ${r.reason}`);
  return r.value;
}

const hits = (keyword: string, text: string): number =>
  matchTopics(catalogWith([keyword]), text).length;

describe("slash keywords need an opening boundary before the slash", () => {
  test.each([
    ["/init", "/init"],
    ["start of text", "/init now"],
    ["a space", "use /init here"],
    ["a tab", "use\t/init here"],
    ["a newline", "use\n/init here"],
    ["(", "(/init)"],
    ["[", "[/init]"],
    ["{", "{/init}"],
    ["a single quote", "'/init'"],
    ["a double quote", '"/init"'],
    ["a backtick", "`/init`"],
  ])("matches after %s", (_n, text) => {
    expect(hits("/init", text)).toBe(1);
  });

  test.each([
    [".", "run ./init.sh"],
    ["~", "look in ~/init"],
    ["-", "a-/init"],
    ["_", "a_/init"],
    ["a letter", "src/init"],
    ["a digit", "v2/init"],
    [". (dir)", "./init"],
  ])("does not match after %s", (_n, text) => {
    expect(hits("/init", text)).toBe(0);
  });

  test("the trailing boundary still applies", () => {
    expect(hits("/init", "use /initialize")).toBe(0);
  });

  test("non-slash keywords keep the old boundary rule (a slash is a boundary)", () => {
    expect(hits("mcp", "see src/mcp/server")).toBe(1);
    expect(hits("mcp", "see ./mcp")).toBe(1);
  });
});
