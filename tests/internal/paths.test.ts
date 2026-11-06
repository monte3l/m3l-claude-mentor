import { describe, expect, test } from "vitest";
import {
  DATA_DIR_ENV,
  DATA_FILES,
  dataFilePath,
  resolveDataDir,
  type DataFile,
} from "../../src/internal/paths.js";
import { isMentorStateError } from "../../src/internal/errors.js";

function codeOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    if (isMentorStateError(error)) {
      return error.code;
    }
    throw error;
  }
  return undefined;
}

describe("constants", () => {
  test("env var name", () => {
    expect(DATA_DIR_ENV).toBe("CLAUDE_PLUGIN_DATA");
  });

  test("DATA_FILES holds the five file names and is frozen", () => {
    expect(DATA_FILES).toEqual({
      profile: "profile.json",
      state: "state.json",
      catalog: "catalog.json",
      goals: "goals.md",
      evidence: "evidence.jsonl",
    });
    expect(Object.isFrozen(DATA_FILES)).toBe(true);
  });
});

describe("resolveDataDir", () => {
  test("returns an absolute path unchanged", () => {
    expect(resolveDataDir({ CLAUDE_PLUGIN_DATA: "/var/data/m3l" })).toBe(
      "/var/data/m3l",
    );
  });

  test("strips a trailing slash", () => {
    expect(resolveDataDir({ CLAUDE_PLUGIN_DATA: "/var/data/m3l/" })).toBe(
      "/var/data/m3l",
    );
  });

  test("normalizes .. and . segments", () => {
    expect(
      resolveDataDir({ CLAUDE_PLUGIN_DATA: "/var/data/../data/./m3l" }),
    ).toBe("/var/data/m3l");
  });

  test.each([
    ["absent", {}],
    ["undefined", { CLAUDE_PLUGIN_DATA: undefined }],
    ["empty", { CLAUDE_PLUGIN_DATA: "" }],
    ["spaces", { CLAUDE_PLUGIN_DATA: "   " }],
    ["tab and newline", { CLAUDE_PLUGIN_DATA: "\t\n" }],
  ])("%s -> DATA_DIR_UNSET", (_l, env) => {
    expect(codeOf(() => resolveDataDir(env))).toBe("DATA_DIR_UNSET");
  });

  test.each([
    ["relative", "data/m3l"],
    ["dot-relative", "./data"],
    ["parent-relative", "../data"],
    ["bare name", "data"],
    ["NUL inside absolute", "/var/da\0ta"],
    ["NUL at end", "/var/data\0"],
  ])("%s -> DATA_DIR_INVALID", (_l, value) => {
    expect(codeOf(() => resolveDataDir({ CLAUDE_PLUGIN_DATA: value }))).toBe(
      "DATA_DIR_INVALID",
    );
  });

  test("messages do not echo the value", () => {
    const secret = "relative/secret-marker-xyz";
    try {
      resolveDataDir({ CLAUDE_PLUGIN_DATA: secret });
      expect.unreachable();
    } catch (error) {
      expect(isMentorStateError(error)).toBe(true);
      expect((error as Error).message).not.toContain("secret-marker-xyz");
    }
  });

  test("has no fallback: unset never yields a path", () => {
    expect(() => resolveDataDir({})).toThrowError();
  });

  test("reads the env var exactly once", () => {
    let reads = 0;
    const env = {
      get CLAUDE_PLUGIN_DATA(): string {
        reads += 1;
        return reads === 1 ? "/a/b" : "relative";
      },
    };
    expect(resolveDataDir(env)).toBe("/a/b");
    expect(reads).toBe(1);
  });
});

describe("resolveDataDir hardening", () => {
  test.each(["/", "//", "/..", "/../.."])(
    "filesystem root %s -> DATA_DIR_INVALID",
    (value) => {
      expect(codeOf(() => resolveDataDir({ CLAUDE_PLUGIN_DATA: value }))).toBe(
        "DATA_DIR_INVALID",
      );
    },
  );

  test("a Windows-style path is not absolute here", () => {
    expect(
      codeOf(() => resolveDataDir({ CLAUDE_PLUGIN_DATA: "C:\\data" })),
    ).toBe("DATA_DIR_INVALID");
  });

  test("an inherited env var is not read", () => {
    const env = Object.create({ CLAUDE_PLUGIN_DATA: "/x" }) as Record<
      string,
      string | undefined
    >;
    expect(codeOf(() => resolveDataDir(env))).toBe("DATA_DIR_UNSET");
  });
});

describe("dataFilePath validation", () => {
  test.each([
    "../x",
    "__proto__",
    "toString",
    "",
    "constructor",
    "profile.json",
  ])("unknown file %s -> VALIDATION_FAILED", (file) => {
    expect(codeOf(() => dataFilePath("/d", file as DataFile))).toBe(
      "VALIDATION_FAILED",
    );
  });
});

describe("dataFilePath", () => {
  test.each([
    ["profile", "/d/profile.json"],
    ["state", "/d/state.json"],
    ["catalog", "/d/catalog.json"],
    ["goals", "/d/goals.md"],
    ["evidence", "/d/evidence.jsonl"],
  ] as const satisfies readonly (readonly [DataFile, string])[])(
    "%s joins under the directory",
    (file, expected) => {
      expect(dataFilePath("/d", file)).toBe(expected);
    },
  );

  test("tolerates a trailing slash on dir", () => {
    expect(dataFilePath("/d/", "state")).toBe("/d/state.json");
  });
});
