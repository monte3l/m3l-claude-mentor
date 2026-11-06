import { afterEach, describe, expect, test } from "vitest";
import {
  defaultProfile,
  defaultState,
  parseProfile,
  parseSegmentState,
  parseState,
} from "../../src/internal/state-schema.js";

const MARK = "ZZ_UNIQUE_MARKER_42";

describe("inherited fields are not read", () => {
  afterEach(() => {
    for (const k of ["muted", "schemaVersion", "segmentId", "topics"]) {
      Reflect.deleteProperty(Object.prototype, k);
    }
  });

  test("Object.create(validState) does not parse", () => {
    const inherited: unknown = Object.create(defaultState(5));
    expect(parseState(inherited).ok).toBe(false);
  });

  test("Object.create(validProfile) does not parse", () => {
    const inherited: unknown = Object.create(defaultProfile());
    expect(parseProfile(inherited).ok).toBe(false);
  });

  test("Object.create(validSegment) does not parse", () => {
    const inherited: unknown = Object.create(defaultState(5).segment);
    expect(parseSegmentState(inherited).ok).toBe(false);
  });

  test("a polluted Object.prototype.muted does not supply a missing field", () => {
    Object.defineProperty(Object.prototype, "muted", {
      value: false,
      configurable: true,
      writable: true,
      enumerable: false,
    });
    const { muted: _muted, ...rest } = defaultState(5);
    expect(parseState(rest).ok).toBe(false);
  });

  test("a polluted Object.prototype.schemaVersion does not supply it", () => {
    Object.defineProperty(Object.prototype, "schemaVersion", {
      value: 1,
      configurable: true,
      writable: true,
      enumerable: false,
    });
    const { schemaVersion: _v, ...rest } = defaultState(5);
    expect(parseState(rest).ok).toBe(false);
    const { schemaVersion: _w, ...prest } = defaultProfile();
    expect(parseProfile(prest).ok).toBe(false);
  });

  test("a polluted Object.prototype.segmentId does not supply it", () => {
    Object.defineProperty(Object.prototype, "segmentId", {
      value: 0,
      configurable: true,
      writable: true,
      enumerable: false,
    });
    const { segmentId: _s, ...rest } = defaultState(5).segment;
    expect(parseSegmentState(rest).ok).toBe(false);
  });

  test("a polluted Object.prototype.topics does not supply it", () => {
    Object.defineProperty(Object.prototype, "topics", {
      value: {},
      configurable: true,
      writable: true,
      enumerable: false,
    });
    const { topics: _t, ...rest } = defaultProfile();
    expect(parseProfile(rest).ok).toBe(false);
  });
});

describe("failure reasons never echo the input", () => {
  const base = (): Record<string, unknown> => ({ ...defaultState(5) });

  test("excludedProjects entry", () => {
    const r = parseState({
      ...base(),
      excludedProjects: [`${MARK}\0`],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).not.toContain(MARK);
  });

  test("lastChangelogVersion", () => {
    const r = parseState({ ...base(), lastChangelogVersion: `${MARK} bad` });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).not.toContain(MARK);
  });

  test("profile topic key", () => {
    const r = parseProfile({
      ...defaultProfile(),
      topics: {
        [`${MARK}_Bad`]: {
          introduced: true,
          level: "Fluent",
          lastPassAt: null,
          passes: 0,
        },
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).not.toContain(MARK);
  });
});
