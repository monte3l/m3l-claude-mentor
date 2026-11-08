import { describe, expect, expectTypeOf, test } from "vitest";
import {
  DEFAULT_SETTINGS,
  readSettings,
  type HookSettings,
} from "../../src/hooks/settings.js";

const DIAL = "CLAUDE_PLUGIN_OPTION_DIAL";
const TA = "CLAUDE_PLUGIN_OPTION_TRANSCRIPTANALYSIS";

describe("DEFAULT_SETTINGS", () => {
  test("is dial 2 with transcript analysis on", () => {
    expect(DEFAULT_SETTINGS).toEqual({ dial: 2, transcriptAnalysis: true });
  });
});

describe("readSettings dial", () => {
  test.each([
    ["0", 0],
    ["1", 1],
    ["2", 2],
    ["3", 3],
    ["4", 4],
    ["5", 5],
    [" 3 ", 3],
    ["\t4\n", 4],
  ] as const)("accepts %j as %i", (raw, expected) => {
    expect(readSettings({ [DIAL]: raw }).dial).toBe(expected);
  });

  test.each(["6", "-1", "2.0", "", "  ", "03", "+3", "abc", "1e0", "3 4", "9"])(
    "falls back to the default 2 for %j",
    (raw) => {
      expect(readSettings({ [DIAL]: raw }).dial).toBe(2);
    },
  );

  test("falls back to the default when unset or undefined", () => {
    expect(readSettings({}).dial).toBe(2);
    expect(readSettings({ [DIAL]: undefined }).dial).toBe(2);
  });
});

describe("readSettings transcriptAnalysis", () => {
  test.each(["true", "TRUE", "True", " true ", "1", " 1 "])(
    "reads %j as true",
    (raw) => {
      expect(readSettings({ [TA]: raw }).transcriptAnalysis).toBe(true);
    },
  );

  test.each(["false", "FALSE", "False", " false ", "0", " 0 "])(
    "reads %j as false",
    (raw) => {
      expect(readSettings({ [TA]: raw }).transcriptAnalysis).toBe(false);
    },
  );

  test.each(["yes", "no", "", "  ", "2", "01", "truee", "off"])(
    "falls back to the default true for %j",
    (raw) => {
      expect(readSettings({ [TA]: raw }).transcriptAnalysis).toBe(true);
    },
  );

  test("falls back to the default when unset or undefined", () => {
    expect(readSettings({}).transcriptAnalysis).toBe(true);
    expect(readSettings({ [TA]: undefined }).transcriptAnalysis).toBe(true);
  });
});

describe("readSettings combined", () => {
  test("reads both options independently", () => {
    expect(readSettings({ [DIAL]: "5", [TA]: "false" })).toEqual({
      dial: 5,
      transcriptAnalysis: false,
    });
  });

  test("an empty environment yields the defaults", () => {
    expect(readSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  test("reads each environment variable exactly once", () => {
    const reads = { dial: 0, ta: 0 };
    const env = {};
    Object.defineProperty(env, DIAL, {
      enumerable: true,
      get: () => {
        reads.dial += 1;
        return "3";
      },
    });
    Object.defineProperty(env, TA, {
      enumerable: true,
      get: () => {
        reads.ta += 1;
        return "false";
      },
    });
    expect(readSettings(env)).toEqual({ dial: 3, transcriptAnalysis: false });
    expect(reads).toEqual({ dial: 1, ta: 1 });
  });
});

describe("HookSettings type", () => {
  test("dial is the 0..5 union and transcriptAnalysis a boolean", () => {
    expectTypeOf<HookSettings["dial"]>().toEqualTypeOf<0 | 1 | 2 | 3 | 4 | 5>();
    expectTypeOf<HookSettings["transcriptAnalysis"]>().toEqualTypeOf<boolean>();
    expectTypeOf(readSettings).returns.toEqualTypeOf<HookSettings>();
  });
});
