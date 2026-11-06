import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  parseCatalogFile,
  type CatalogFile,
} from "../../src/internal/catalog-file.js";
import {
  MentorStateError,
  type MentorErrorCode,
} from "../../src/internal/errors.js";
import {
  MAX_GOALS_BYTES,
  MAX_JSON_BYTES,
} from "../../src/internal/fs-atomic.js";
import {
  defaultState,
  parseState,
  type MentorState,
  type Profile,
} from "../../src/internal/state-schema.js";
import {
  loadCatalogFile,
  loadGoals,
  loadProfile,
  loadState,
  saveCatalogFile,
  saveGoals,
  saveProfile,
  saveState,
} from "../../src/internal/store.js";

let sandbox = "";
let dir = "";

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "store-"));
  dir = join(sandbox, "data");
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

async function failure(promise: Promise<unknown>): Promise<MentorStateError> {
  let thrown: unknown;
  try {
    await promise;
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(MentorStateError);
  return thrown as MentorStateError;
}

async function expectCode(
  promise: Promise<unknown>,
  code: MentorErrorCode,
): Promise<MentorStateError> {
  const error = await failure(promise);
  expect(error.code).toBe(code);
  return error;
}

const put = (name: string, text: string): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), text);
};
const text = (name: string): string => readFileSync(join(dir, name), "utf8");
const tmpFiles = (): string[] =>
  readdirSync(dir).filter((name) => name.endsWith(".tmp"));

const segment = {
  segmentId: 0,
  startedAt: 1000,
  lastActivityAt: 5000,
  tipsEmitted: 1,
  lastTipAt: 9000,
  lastTopic: null,
};

const profileWithFuture = {
  schemaVersion: 1,
  topics: {
    "plan-mode": {
      introduced: true,
      level: "Applied",
      lastPassAt: 9000,
      passes: 2,
    },
    hooks: {
      introduced: true,
      level: "Recalled",
      lastPassAt: 100,
      passes: 1,
    },
  },
  calibration: { confirmed: 1, refuted: 0 },
};

describe("missing files return defaults", () => {
  test("loadState gives a fresh state anchored at now", async () => {
    expect(await loadState(dir, 42)).toEqual({
      schemaVersion: 1,
      muted: false,
      mutedTopics: [],
      excludedProjects: [],
      lastChangelogVersion: null,
      segment: {
        segmentId: 0,
        startedAt: 42,
        lastActivityAt: 42,
        tipsEmitted: 0,
        lastTipAt: null,
        lastTopic: null,
      },
    });
  });

  test("loadProfile, loadCatalogFile and loadGoals give their empty values", async () => {
    expect(await loadProfile(dir, 0)).toEqual({
      schemaVersion: 1,
      topics: {},
      calibration: { confirmed: 0, refuted: 0 },
    });
    expect(await loadCatalogFile(dir)).toEqual({
      user: { overrides: {}, custom: [] },
      scoring: {},
    });
    expect(await loadGoals(dir)).toBe("");
  });

  test("loading never creates the data directory", async () => {
    await loadState(dir, 1);
    await loadGoals(dir);
    expect(existsSync(dir)).toBe(false);
  });
});

describe("round trips", () => {
  test("saveState then loadState returns the same state, pretty-printed", async () => {
    const state: MentorState = {
      ...defaultState(100),
      muted: true,
      lastChangelogVersion: "1.2.3",
    };
    await saveState(dir, state);
    expect(text("state.json")).toBe(`${JSON.stringify(state, null, 2)}\n`);
    expect(await loadState(dir, 100)).toEqual(state);
  });

  test("saveProfile then loadProfile returns the same profile", async () => {
    const profile: Profile = {
      schemaVersion: 1,
      topics: {
        hooks: {
          introduced: true,
          level: "Recalled",
          lastPassAt: 100,
          passes: 1,
        },
      },
      calibration: { confirmed: 2, refuted: 1 },
    };
    await saveProfile(dir, profile);
    expect(text("profile.json")).toBe(`${JSON.stringify(profile, null, 2)}\n`);
    expect(await loadProfile(dir, 1000)).toEqual(profile);
  });

  test("saveCatalogFile writes the serialized form and loadCatalogFile restores it", async () => {
    const parsed = parseCatalogFile({
      overrides: { "plan-mode": { enabled: false } },
      scoring: { halfLifeDays: 14 },
    });
    if (!parsed.ok) throw new Error(parsed.reason);
    await saveCatalogFile(dir, parsed.value);
    expect(JSON.parse(text("catalog.json"))).toEqual({
      overrides: { "plan-mode": { enabled: false } },
      custom: [],
      scoring: { halfLifeDays: 14 },
    });
    expect(await loadCatalogFile(dir)).toEqual(parsed.value);
  });

  test("an empty catalog file is saved without a scoring key", async () => {
    await saveCatalogFile(dir, {
      user: { overrides: {}, custom: [] },
      scoring: {},
    });
    expect(text("catalog.json")).toBe(
      '{\n  "overrides": {},\n  "custom": []\n}\n',
    );
  });

  test("saveGoals then loadGoals round-trips text verbatim", async () => {
    await saveGoals(dir, "Learn hooks\n- ship é ✓\n");
    expect(text("goals.md")).toBe("Learn hooks\n- ship é ✓\n");
    expect(await loadGoals(dir)).toBe("Learn hooks\n- ship é ✓\n");
  });
});

describe("clamping future timestamps on load", () => {
  test("loadState clamps segment timestamps later than now, keeping startedAt <= lastActivityAt", async () => {
    put("state.json", JSON.stringify({ ...defaultState(0), segment }));
    const loaded = await loadState(dir, 3000);
    expect(loaded.segment.startedAt).toBe(1000);
    expect(loaded.segment.lastActivityAt).toBe(3000);
    expect(loaded.segment.lastTipAt).toBe(3000);
    expect(loaded.segment.tipsEmitted).toBe(1);
  });

  test("loadState clamps startedAt too when it is in the future", async () => {
    put(
      "state.json",
      JSON.stringify({
        ...defaultState(0),
        segment: { ...segment, startedAt: 5000, lastActivityAt: 6000 },
      }),
    );
    const loaded = await loadState(dir, 3000);
    expect(loaded.segment.startedAt).toBe(3000);
    expect(loaded.segment.lastActivityAt).toBe(3000);
  });

  test("loadState leaves timestamps at or before now untouched", async () => {
    put("state.json", JSON.stringify({ ...defaultState(0), segment }));
    const loaded = await loadState(dir, 9000);
    expect(loaded.segment).toEqual(segment);
  });

  test("loadProfile clamps lastPassAt later than now and keeps earlier ones", async () => {
    put("profile.json", JSON.stringify(profileWithFuture));
    const loaded = await loadProfile(dir, 3000);
    expect(loaded.topics["plan-mode"]?.lastPassAt).toBe(3000);
    expect(loaded.topics["hooks"]?.lastPassAt).toBe(100);
  });

  test("savers persist exactly what they are given, unclamped", async () => {
    const state = { ...defaultState(0), segment } as MentorState;
    await saveState(dir, state);
    const saved = JSON.parse(text("state.json")) as {
      segment: { lastTipAt: number };
    };
    expect(saved.segment.lastTipAt).toBe(9000);
  });
});

describe("loader failures", () => {
  test.each([
    ["loadState", (): Promise<unknown> => loadState(dir, 0), "state.json"],
    [
      "loadProfile",
      (): Promise<unknown> => loadProfile(dir, 0),
      "profile.json",
    ],
    [
      "loadCatalogFile",
      (): Promise<unknown> => loadCatalogFile(dir),
      "catalog.json",
    ],
  ])(
    "%s: corrupt JSON gives PARSE_FAILED with no cause and no file text",
    async (_n, load, name) => {
      put(name, '{"secret": "TOPSECRETVALUE", oops');
      const error = await expectCode(load(), "PARSE_FAILED");
      expect(Object.hasOwn(error, "cause")).toBe(false);
      expect(error.cause).toBeUndefined();
      expect(error.message).toContain(name);
      expect(error.message).not.toContain("TOPSECRETVALUE");
    },
  );

  test.each([
    ["loadState", (): Promise<unknown> => loadState(dir, 0), "state.json"],
    [
      "loadProfile",
      (): Promise<unknown> => loadProfile(dir, 0),
      "profile.json",
    ],
    [
      "loadCatalogFile",
      (): Promise<unknown> => loadCatalogFile(dir),
      "catalog.json",
    ],
  ])(
    "%s: valid JSON failing the parser gives VALIDATION_FAILED naming the file",
    async (_n, load, name) => {
      put(
        name,
        '{"schemaVersion": 99, "overrides": 5, "scoring": 7, "topics": 1}',
      );
      const error = await expectCode(load(), "VALIDATION_FAILED");
      expect(error.message).toContain(name);
    },
  );

  test("the VALIDATION_FAILED message carries the parser's reason", async () => {
    const bad = { ...defaultState(0), schemaVersion: 99 };
    put("state.json", JSON.stringify(bad));
    const parsed = parseState(bad);
    if (parsed.ok) throw new Error("fixture should be invalid");
    const error = await expectCode(loadState(dir, 0), "VALIDATION_FAILED");
    expect(error.message).toContain(parsed.reason);
  });

  test("a directory where the file belongs gives READ_FAILED with a cause", async () => {
    mkdirSync(join(dir, "state.json"), { recursive: true });
    const error = await expectCode(loadState(dir, 0), "READ_FAILED");
    expect(error.cause).toBeInstanceOf(Error);
  });

  test("a state file of exactly MAX_JSON_BYTES loads; one more byte is TOO_LARGE", async () => {
    const body = JSON.stringify(defaultState(7));
    put("state.json", body + " ".repeat(MAX_JSON_BYTES - body.length));
    expect((await loadState(dir, 7)).segment.startedAt).toBe(7);
    put("state.json", body + " ".repeat(MAX_JSON_BYTES - body.length + 1));
    await expectCode(loadState(dir, 7), "TOO_LARGE");
  });

  test("goals of exactly MAX_GOALS_BYTES load; one more byte is TOO_LARGE", async () => {
    put("goals.md", "a".repeat(MAX_GOALS_BYTES));
    expect(await loadGoals(dir)).toHaveLength(MAX_GOALS_BYTES);
    put("goals.md", "a".repeat(MAX_GOALS_BYTES + 1));
    await expectCode(loadGoals(dir), "TOO_LARGE");
  });

  test.each([[Number.NaN], [-1], [Number.POSITIVE_INFINITY]])(
    "loadState and loadProfile reject now=%s with RangeError, even with no file",
    async (now) => {
      await expect(loadState(dir, now)).rejects.toBeInstanceOf(RangeError);
      await expect(loadProfile(dir, now)).rejects.toBeInstanceOf(RangeError);
    },
  );

  test("now = 0 is accepted", async () => {
    expect((await loadState(dir, 0)).segment.startedAt).toBe(0);
  });
});

describe("saver failures", () => {
  test("saveState rejects an invalid state and leaves the previous file unchanged", async () => {
    await saveState(dir, defaultState(5));
    const before = text("state.json");
    const bad = {
      ...defaultState(5),
      schemaVersion: 2,
    } as unknown as MentorState;
    const error = await expectCode(saveState(dir, bad), "VALIDATION_FAILED");
    expect(error.message).toMatch(/refusing to write/);
    expect(text("state.json")).toBe(before);
    expect(tmpFiles()).toEqual([]);
  });

  test("saveProfile rejects an invalid profile without creating the file", async () => {
    const bad = {
      schemaVersion: 1,
      topics: { "Bad Key": {} },
      calibration: { confirmed: 0, refuted: 0 },
    } as unknown as Profile;
    await expectCode(saveProfile(dir, bad), "VALIDATION_FAILED");
    expect(existsSync(join(dir, "profile.json"))).toBe(false);
  });

  test("saveCatalogFile rejects an invalid catalog file without creating the file", async () => {
    const bad = {
      user: { overrides: {}, custom: [] },
      scoring: { halfLifeDays: -1 },
    } as CatalogFile;
    await expectCode(saveCatalogFile(dir, bad), "VALIDATION_FAILED");
    expect(existsSync(join(dir, "catalog.json"))).toBe(false);
  });

  test("saveGoals accepts exactly MAX_GOALS_BYTES and rejects one byte more with TOO_LARGE", async () => {
    await saveGoals(dir, "a".repeat(MAX_GOALS_BYTES));
    await expectCode(
      saveGoals(dir, "a".repeat(MAX_GOALS_BYTES + 1)),
      "TOO_LARGE",
    );
    expect(text("goals.md")).toHaveLength(MAX_GOALS_BYTES);
  });

  test("saveGoals measures bytes, not characters", async () => {
    await saveGoals(dir, "é".repeat(MAX_GOALS_BYTES / 2));
    await expectCode(
      saveGoals(dir, "é".repeat(MAX_GOALS_BYTES / 2 + 1)),
      "TOO_LARGE",
    );
  });

  test("saveGoals rejects NUL and leaves the previous goals unchanged", async () => {
    await saveGoals(dir, "keep");
    await failure(saveGoals(dir, "a\0b"));
    expect(text("goals.md")).toBe("keep");
  });

  test("a failed write (target is a directory) gives WRITE_FAILED and leaves no .tmp", async () => {
    mkdirSync(join(dir, "state.json"), { recursive: true });
    const error = await expectCode(
      saveState(dir, defaultState(1)),
      "WRITE_FAILED",
    );
    expect(error.cause).toBeInstanceOf(Error);
    expect(tmpFiles()).toEqual([]);
  });

  test("a file where the data dir should be gives WRITE_FAILED", async () => {
    writeFileSync(dir, "not a directory");
    await expectCode(saveGoals(dir, "x"), "WRITE_FAILED");
    expect(readFileSync(dir, "utf8")).toBe("not a directory");
  });
});

describe("concurrency", () => {
  test("concurrent saveState calls leave a parseable file holding one of the written values", async () => {
    const versions = Array.from({ length: 8 }, (_, i) => `1.0.${String(i)}`);
    await Promise.all(
      versions.map((v) =>
        saveState(dir, { ...defaultState(10), lastChangelogVersion: v }),
      ),
    );
    const loaded = await loadState(dir, 10);
    expect(versions).toContain(loaded.lastChangelogVersion);
    expect(tmpFiles()).toEqual([]);
    expect(readdirSync(dir)).toEqual(["state.json"]);
  });
});
