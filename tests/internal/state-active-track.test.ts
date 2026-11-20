import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  test,
} from "vitest";
import {
  clampStateToNow,
  defaultState,
  parseState,
  type MentorState,
} from "../../src/internal/state-schema.ts";
import { loadState, saveState } from "../../src/internal/store.ts";

function state(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...defaultState(1000), ...over };
}

describe("MentorState.activeTrack", () => {
  test("is optional and typed as a string", () => {
    expectTypeOf<MentorState["activeTrack"]>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<Omit<MentorState, "activeTrack">>().toMatchTypeOf<{
      muted: boolean;
    }>();
  });

  test("defaultState has no activeTrack key", () => {
    expect(Object.hasOwn(defaultState(1), "activeTrack")).toBe(false);
  });
});

describe("parseState activeTrack", () => {
  test("absent is fine and no own key is added", () => {
    const r = parseState(state());
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.hasOwn(r.value, "activeTrack")).toBe(false);
  });

  test.each(["CCAR-F", "CCDV-P", "CC-F", "ABCD-XY"])(
    "accepts %s and copies it",
    (code) => {
      const r = parseState(state({ activeTrack: code }));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.activeTrack).toBe(code);
    },
  );

  test.each([
    ["lowercase", "ccar-f"],
    ["no dash", "CCARF"],
    ["one-letter prefix", "C-F"],
    ["five-letter prefix", "CCCCC-F"],
    ["three-letter suffix", "CCAR-FPX"],
    ["empty string", ""],
    ["trailing newline", "CCAR-F\n"],
    ["number", 5],
    ["null", null],
    ["object", {}],
    ["array", ["CCAR-F"]],
  ])("rejects %s and the reason names activeTrack", (_n, value) => {
    const r = parseState(state({ activeTrack: value }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("activeTrack");
  });

  test("the reason never echoes the raw value", () => {
    const r = parseState(state({ activeTrack: "RAW-SECRET-VALUE" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).not.toContain("RAW-SECRET-VALUE");
  });

  test("other extra keys are still ignored and not copied", () => {
    const r = parseState(state({ activeTrack: "CCAR-F", extra: 1 }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.hasOwn(r.value, "extra")).toBe(false);
      expect(r.value.activeTrack).toBe("CCAR-F");
    }
  });
});

describe("clampStateToNow activeTrack", () => {
  test("preserves it", () => {
    const parsed = parseState(state({ activeTrack: "CCDV-F" }));
    if (!parsed.ok) throw new Error("fixture rejected");
    expect(clampStateToNow(parsed.value, 5000).activeTrack).toBe("CCDV-F");
  });

  test("adds no key when absent", () => {
    expect(
      Object.hasOwn(clampStateToNow(defaultState(10), 5000), "activeTrack"),
    ).toBe(false);
  });
});

describe("store round trip", () => {
  let sandbox = "";
  let dir = "";
  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "state-active-track-"));
    dir = join(sandbox, "data");
  });
  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  test("saveState then loadState keeps activeTrack", async () => {
    const withTrack: MentorState = {
      ...defaultState(100),
      activeTrack: "CCAR-P",
    };
    await saveState(dir, withTrack);
    expect(
      (JSON.parse(readFileSync(join(dir, "state.json"), "utf8")) as MentorState)
        .activeTrack,
    ).toBe("CCAR-P");
    expect(await loadState(dir, 100)).toEqual(withTrack);
  });

  test("a state without it round-trips without gaining the key", async () => {
    await saveState(dir, defaultState(100));
    const loaded = await loadState(dir, 100);
    expect(Object.hasOwn(loaded, "activeTrack")).toBe(false);
  });
});
