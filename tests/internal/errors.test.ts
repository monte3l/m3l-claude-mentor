import { describe, expect, expectTypeOf, test } from "vitest";
import {
  MentorStateError,
  isMentorStateError,
  type MentorErrorCode,
} from "../../src/internal/errors.js";

const CODES: readonly MentorErrorCode[] = [
  "DATA_DIR_UNSET",
  "DATA_DIR_INVALID",
  "READ_FAILED",
  "PARSE_FAILED",
  "VALIDATION_FAILED",
  "WRITE_FAILED",
  "TOO_LARGE",
  "IMPORT_INVALID",
  "CONFIRMATION_REQUIRED",
];

describe("MentorStateError", () => {
  test.each(CODES)("carries code %s and message", (code) => {
    const e = new MentorStateError(code, "boom");
    expect(e.code).toBe(code);
    expect(e.message).toBe("boom");
  });

  test("is an Error named MentorStateError", () => {
    const e = new MentorStateError("READ_FAILED", "x");
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(MentorStateError);
    expect(e.name).toBe("MentorStateError");
  });

  test("forwards cause when supplied", () => {
    const cause = new Error("inner");
    const e = new MentorStateError("READ_FAILED", "x", { cause });
    expect(e.cause).toBe(cause);
  });

  test("forwards a non-Error cause as-is", () => {
    const e = new MentorStateError("READ_FAILED", "x", { cause: "str" });
    expect(e.cause).toBe("str");
  });

  test("does not define cause when none supplied", () => {
    const e = new MentorStateError("READ_FAILED", "x");
    expect(Object.hasOwn(e, "cause")).toBe(false);
    const e2 = new MentorStateError("READ_FAILED", "x", {});
    expect(Object.hasOwn(e2, "cause")).toBe(false);
  });

  test("an inherited cause in options is not forwarded", () => {
    const options = Object.create({ cause: 1 }) as { cause?: unknown };
    const e = new MentorStateError("READ_FAILED", "x", options);
    expect(Object.hasOwn(e, "cause")).toBe(false);
    expect(e.cause).toBeUndefined();
  });

  test("code is typed as MentorErrorCode", () => {
    expectTypeOf<MentorStateError["code"]>().toEqualTypeOf<MentorErrorCode>();
  });
});

describe("isMentorStateError", () => {
  test("true for a MentorStateError", () => {
    expect(isMentorStateError(new MentorStateError("TOO_LARGE", "x"))).toBe(
      true,
    );
  });

  test.each([
    ["plain Error", new Error("x")],
    ["string", "MentorStateError"],
    ["null", null],
    ["undefined", undefined],
    ["number", 3],
    ["lookalike", { name: "MentorStateError", code: "READ_FAILED" }],
  ])("false for %s", (_label, value) => {
    expect(isMentorStateError(value)).toBe(false);
  });
});
