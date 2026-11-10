import { describe, expect, test } from "vitest";
import { parseGlobalOptions } from "../../src/cli/global-options.js";

// Result shape pinned here: { ok: true, dataDir: string | null, argv } on
// success, { ok: false } for a usage error.
describe("parseGlobalOptions", () => {
  test("consumes a leading --data-dir pair and returns the rest", () => {
    expect(parseGlobalOptions(["--data-dir", "/d", "set-mute", "on"])).toEqual({
      ok: true,
      dataDir: "/d",
      argv: ["set-mute", "on"],
    });
  });

  test("no option: dataDir null and argv unchanged", () => {
    expect(parseGlobalOptions(["show"])).toEqual({
      ok: true,
      dataDir: null,
      argv: ["show"],
    });
  });

  test("empty argv is ok with dataDir null", () => {
    expect(parseGlobalOptions([])).toEqual({
      ok: true,
      dataDir: null,
      argv: [],
    });
  });

  test("only the pair: the command list is empty", () => {
    expect(parseGlobalOptions(["--data-dir", "/d"])).toEqual({
      ok: true,
      dataDir: "/d",
      argv: [],
    });
  });

  test("a value with spaces stays one token", () => {
    expect(parseGlobalOptions(["--data-dir", "/a b/c", "show"])).toEqual({
      ok: true,
      dataDir: "/a b/c",
      argv: ["show"],
    });
  });

  test("a relative value is returned as is (validated by the entry)", () => {
    expect(parseGlobalOptions(["--data-dir", "rel", "show"])).toMatchObject({
      ok: true,
      dataDir: "rel",
    });
  });

  test("--data-dir after the command is left untouched", () => {
    expect(parseGlobalOptions(["show", "--data-dir", "/d"])).toEqual({
      ok: true,
      dataDir: null,
      argv: ["show", "--data-dir", "/d"],
    });
  });

  test.each([
    ["a missing value", ["--data-dir"]],
    ["a value starting with --", ["--data-dir", "--x", "show"]],
    [
      "a repeated leading option",
      ["--data-dir", "/a", "--data-dir", "/b", "show"],
    ],
    [
      "a repeated option right after the pair",
      ["--data-dir", "/a", "--data-dir"],
    ],
  ])("%s is a usage error", (_name, argv) => {
    expect(parseGlobalOptions(argv)).toEqual({ ok: false });
  });

  test("does not mutate the input array", () => {
    const input = ["--data-dir", "/d", "show"];
    const copy = [...input];
    parseGlobalOptions(input);
    expect(input).toEqual(copy);
  });
});
