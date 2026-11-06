import { describe, expect, test } from "vitest";
import { assertValidDataDir } from "../../src/internal/paths.js";
import { MentorStateError } from "../../src/internal/errors.js";

function thrown(dir: unknown): unknown {
  try {
    assertValidDataDir(dir as string);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("assertValidDataDir", () => {
  test.each([
    ["an absolute dir", "/var/data/m3l"],
    ["a dir with a trailing slash", "/var/data/m3l/"],
    ["a dir with spaces inside", "/var/my data/m3l"],
  ])("accepts %s and returns undefined", (_name, dir) => {
    expect(assertValidDataDir(dir)).toBeUndefined();
  });

  test.each([
    ["a number", 5],
    ["undefined", undefined],
    ["null", null],
    ["an object", {}],
    ["the empty string", ""],
    ["whitespace only", "   \t"],
    ["a relative path", "relative/dir"],
    ["a dot", "."],
    ["a dot-dot path", "../up"],
    ["a path containing NUL", "/var/data\0/m3l"],
    ["the filesystem root", "/"],
    ["a path that resolves to the root", "/var/.."],
    ["a root with dot segments", "/./"],
  ])("rejects %s with DATA_DIR_INVALID", (_name, dir) => {
    const error = thrown(dir);
    expect(error).toBeInstanceOf(MentorStateError);
    expect((error as MentorStateError).code).toBe("DATA_DIR_INVALID");
  });

  test("the message is fixed and does not echo the rejected path", () => {
    const error = thrown("secret-relative-name\0x") as MentorStateError;
    expect(error.message).not.toContain("secret-relative-name");
  });
});
