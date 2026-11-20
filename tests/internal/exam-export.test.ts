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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  test,
} from "vitest";
import {
  MAX_EXAM_ITEMS,
  parseExamItem,
  type ExamItem,
} from "../../src/internal/exam-schema.ts";
import {
  appendExamItem,
  loadPending,
  readExamItems,
  savePending,
} from "../../src/internal/exam-store.ts";
import {
  BUNDLE_VERSION,
  describeData,
  exportBundle,
  exportBundleToFile,
  importBundle,
  importBundleFromFile,
  parseBundle,
  purgeData,
  serializeBundle,
  type Bundle,
} from "../../src/internal/export.ts";
import { parsePendingExam } from "../../src/internal/exam-schema.ts";
import { defaultState } from "../../src/internal/state-schema.ts";
import { loadState, saveState } from "../../src/internal/store.ts";
import {
  NOW,
  evidenceAt,
  expectCode,
  seed,
  snapshot,
} from "./fixtures/export-data.ts";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const V1 = join(FIXTURES, "bundle-v1.json");
const EXAM = join(FIXTURES, "bundle-v1-exam.json");
const REPLACE = { replace: true } as const;

const readJson = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;

function loadBundle(file: string): Bundle {
  const parsed = parseBundle(readJson(file));
  if (!parsed.ok) throw new Error(`fixture rejected: ${parsed.reason}`);
  return parsed.value;
}

const rawItem = (
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  v: 1,
  track: "CCAR-F",
  domain: "D1",
  objective: "D1.2",
  topic: "plan-mode",
  kind: "single",
  mode: "drill",
  correct: true,
  at: 1000,
  session: "sess-1",
  ...over,
});

function exam(over: Record<string, unknown> = {}): ExamItem {
  const r = parseExamItem(rawItem(over));
  if (!r.ok) throw new Error(`fixture rejected: ${r.reason}`);
  return r.value;
}

/** Seeds exam-items.jsonl with `n` valid items in ONE write (fast). */
function seedExamLog(dir: string, n: number): void {
  const text = Array.from(
    { length: n },
    (_v, i) => `${JSON.stringify(exam({ at: i }))}\n`,
  ).join("");
  writeFileSync(join(dir, "exam-items.jsonl"), text, { mode: 0o600 });
}

const base = (): Record<string, unknown> => readJson(V1);

// Written by hand from bundle-v1-exam.json, deliberately not derived from it.
const EXPECTED_EXAM_ITEMS = [
  {
    v: 1,
    track: "CCAR-F",
    domain: "D1",
    objective: "D1.2",
    topic: "plan-mode",
    kind: "single",
    mode: "drill",
    correct: true,
    at: 1_699_990_000_000,
    session: "sess-1",
  },
  {
    v: 1,
    track: "CCAR-F",
    domain: "D2",
    objective: "D2.1",
    topic: "hooks",
    kind: "multiple",
    mode: "mock",
    correct: false,
    at: 1_699_995_000_000,
    session: "sess-2",
  },
  {
    v: 1,
    track: "CCDV-P",
    domain: "D10",
    objective: "D10.12",
    topic: "plan-mode",
    kind: "single",
    mode: "mock",
    correct: true,
    at: 1_699_999_000_000,
    session: "sess-2",
  },
];

let sandbox = "";
let src = "";
let dst = "";

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "exam-export-"));
  src = join(sandbox, "src");
  dst = join(sandbox, "dst");
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("Bundle type", () => {
  test("examItems is optional and readonly ExamItem[]", () => {
    expectTypeOf<Bundle["examItems"]>().toEqualTypeOf<
      readonly ExamItem[] | undefined
    >();
  });
});

describe("parseBundle examItems", () => {
  test("version stays 1", () => {
    expect(BUNDLE_VERSION).toBe(1);
  });

  test("an absent section is fine and leaves no examItems key", () => {
    const r = parseBundle(base());
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.hasOwn(r.value, "examItems")).toBe(false);
  });

  test("a present but empty section stays present as []", () => {
    const r = parseBundle({ ...base(), examItems: [] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.hasOwn(r.value, "examItems")).toBe(true);
      expect(r.value.examItems).toEqual([]);
    }
  });

  test("a present section is parsed into fresh valid items", () => {
    const r = parseBundle({ ...base(), examItems: [rawItem({ junk: "x" })] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.examItems).toEqual([exam()]);
      expect(Object.hasOwn(r.value.examItems?.[0] ?? {}, "junk")).toBe(false);
    }
  });

  test.each([
    ["not an array", "x"],
    ["an object", {}],
    ["null", null],
    ["a bad item", [rawItem(), rawItem({ at: -1 })]],
    ["a non-object item", [5]],
    ["an objective/domain mismatch", [rawItem({ domain: "D2" })]],
  ])("rejects %s, naming examItems", (_n, value) => {
    const r = parseBundle({ ...base(), examItems: value });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("examItems");
  });

  test.each([
    [MAX_EXAM_ITEMS, true],
    [MAX_EXAM_ITEMS + 1, false],
  ])("a section of %i items is accepted: %s", (n, ok) => {
    const items = Array.from({ length: n }, (_v, i) => rawItem({ at: i }));
    expect(parseBundle({ ...base(), examItems: items }).ok).toBe(ok);
  });

  test("state.activeTrack travels inside the bundle state", () => {
    const state = { ...(base()["state"] as object), activeTrack: "CCAR-P" };
    const r = parseBundle({ ...base(), state });
    expect(r.ok && r.value.state.activeTrack).toBe("CCAR-P");
    const bad = parseBundle({
      ...base(),
      state: { ...state, activeTrack: "x" },
    });
    expect(bad.ok).toBe(false);
  });
});

describe("serializeBundle examItems", () => {
  test("omits the section only when the key is absent", () => {
    const original = loadBundle(V1);
    expect(
      Object.hasOwn(
        JSON.parse(serializeBundle(original)) as object,
        "examItems",
      ),
    ).toBe(false);
  });

  test("writes an empty section when the bundle value has examItems: []", () => {
    const empty: Bundle = { ...loadBundle(V1), examItems: [] };
    const written = JSON.parse(serializeBundle(empty)) as Record<
      string,
      unknown
    >;
    expect(Object.hasOwn(written, "examItems")).toBe(true);
    expect(written["examItems"]).toEqual([]);
  });

  test("writes the section when non-empty", () => {
    const withItems: Bundle = { ...loadBundle(V1), examItems: [exam()] };
    const written = JSON.parse(serializeBundle(withItems)) as Record<
      string,
      unknown
    >;
    expect(written["examItems"]).toEqual([rawItem()]);
  });
});

describe("golden v1 bundles", () => {
  test("the original v1 fixture still parses with no exam data", () => {
    const bundle = loadBundle(V1);
    expect(Object.hasOwn(bundle, "examItems")).toBe(false);
    expect(Object.hasOwn(bundle.state, "activeTrack")).toBe(false);
  });

  test("the exam fixture parses to the hand-written items and activeTrack", () => {
    const bundle = loadBundle(EXAM);
    expect(bundle.examItems).toEqual(EXPECTED_EXAM_ITEMS);
    expect(bundle.state.activeTrack).toBe("CCAR-F");
    expect(bundle.version).toBe(1);
    expect(bundle.evidence).toHaveLength(3);
  });

  test("serializeBundle writes the frozen exam layout", () => {
    expect(JSON.parse(serializeBundle(loadBundle(EXAM)))).toEqual(
      readJson(EXAM),
    );
  });

  test("parse, serialize, parse yields an equal bundle", () => {
    const original = loadBundle(EXAM);
    expect(parseBundle(JSON.parse(serializeBundle(original)))).toEqual({
      ok: true,
      value: original,
    });
  });

  test("the exam fixture imports through the real path and exports back equal", async () => {
    await importBundleFromFile(dst, EXAM, REPLACE);
    expect((await readExamItems(dst)).items).toEqual(EXPECTED_EXAM_ITEMS);
    expect((await loadState(dst, NOW)).activeTrack).toBe("CCAR-F");
    const { bundle } = await exportBundle(dst, NOW);
    const original = loadBundle(EXAM);
    expect(bundle.examItems).toEqual(original.examItems);
    expect(bundle.state).toEqual(original.state);
  });
});

describe("exportBundle", () => {
  test("always carries examItems, an empty array when the log is empty or missing", async () => {
    await seed(src);
    const { bundle } = await exportBundle(src, NOW);
    expect(Object.hasOwn(bundle, "examItems")).toBe(true);
    expect(bundle.examItems).toEqual([]);
    const out = join(sandbox, "empty-out.json");
    await exportBundleToFile(src, NOW, out);
    expect(readJson(out)["examItems"]).toEqual([]);
  });

  test("examItemsSkipped is 0 for a clean or missing log", async () => {
    await seed(src);
    expect((await exportBundle(src, NOW)).examItemsSkipped).toBe(0);
    await appendExamItem(src, exam());
    expect((await exportBundle(src, NOW)).examItemsSkipped).toBe(0);
  });

  test("examItemsSkipped counts torn and invalid lines in exam-items.jsonl", async () => {
    await seed(src);
    await appendExamItem(src, exam({ at: 1 }));
    const file = join(src, "exam-items.jsonl");
    writeFileSync(
      file,
      `${readFileSync(file, "utf8")}{"v":1,"track":"CCA\n${JSON.stringify(rawItem({ at: -5 }))}\n${JSON.stringify(rawItem({ at: 2 }))}\n`,
    );
    const result = await exportBundle(src, NOW);
    expect(result.examItemsSkipped).toBe(2);
    expect(result.bundle.examItems?.map((i) => i.at)).toEqual([1, 2]);
  });

  test("ExportResult and ImportSummary carry the exam counts", () => {
    expectTypeOf<
      Awaited<ReturnType<typeof exportBundle>>["examItemsSkipped"]
    >().toEqualTypeOf<number>();
    expectTypeOf<
      Awaited<ReturnType<typeof importBundle>>["examItems"]
    >().toEqualTypeOf<number | null>();
  });

  test("includes the exam log, oldest first, when it has items", async () => {
    await seed(src);
    await appendExamItem(src, exam({ at: 1 }));
    await appendExamItem(src, exam({ at: 2, correct: false }));
    const { bundle } = await exportBundle(src, NOW);
    expect(bundle.examItems?.map((i) => i.at)).toEqual([1, 2]);
  });

  test("carries state.activeTrack", async () => {
    await seed(src);
    await saveState(src, { ...defaultState(NOW), activeTrack: "CCDV-F" });
    const { bundle } = await exportBundle(src, NOW);
    expect(bundle.state.activeTrack).toBe("CCDV-F");
  });

  test("never exports exam-pending.json", async () => {
    await seed(src);
    await appendExamItem(src, exam());
    await savePending(src, pendingValue());
    const { bundle } = await exportBundle(src, NOW);
    expect(Object.keys(bundle).sort()).toEqual([
      "catalog",
      "evidence",
      "examItems",
      "exportedAt",
      "format",
      "goals",
      "profile",
      "state",
      "version",
    ]);
    const outFile = join(sandbox, "out.json");
    await exportBundleToFile(src, NOW, outFile);
    expect(readFileSync(outFile, "utf8")).not.toContain("createdAt");
  });
});

function pendingValue(): ReturnType<typeof unwrapPending> {
  return unwrapPending();
}
function unwrapPending() {
  const r = parsePendingExam({
    v: 1,
    track: "CCAR-F",
    mode: "mock",
    createdAt: 5000,
    items: [
      { objective: "D1.2", topic: "plan-mode", kind: "single", key: ["B"] },
    ],
  });
  if (!r.ok) throw new Error("fixture rejected");
  return r.value;
}

describe("importBundle exam data", () => {
  test("a bundle with examItems replaces the exam log, never appends", async () => {
    await seed(dst);
    await appendExamItem(dst, exam({ at: 9, session: "old-session" }));
    const bundle = loadBundle(EXAM);
    await importBundle(dst, bundle, REPLACE);
    const { items, skipped } = await readExamItems(dst);
    expect(items).toEqual(EXPECTED_EXAM_ITEMS);
    expect(skipped).toBe(0);
  });

  test("a bundle without examItems leaves the existing exam log byte-for-byte", async () => {
    await seed(dst);
    await appendExamItem(dst, exam({ at: 7 }));
    await appendExamItem(dst, exam({ at: 8 }));
    const before = readFileSync(join(dst, "exam-items.jsonl"), "utf8");
    await importBundle(dst, loadBundle(V1), REPLACE);
    expect(readFileSync(join(dst, "exam-items.jsonl"), "utf8")).toBe(before);
    // the other sections really were replaced
    expect(readFileSync(join(dst, "goals.md"), "utf8")).toBe(
      "Learn hooks\nand plan mode\n",
    );
  });

  test("an empty examItems section replaces a non-empty log with an empty one", async () => {
    await seed(dst);
    await appendExamItem(dst, exam({ at: 7 }));
    const bundle: Bundle = { ...loadBundle(V1), examItems: [] };
    const summary = await importBundle(dst, bundle, REPLACE);
    expect((await readExamItems(dst)).items).toEqual([]);
    expect(summary.examItems).toBe(0);
  });

  test("a fresh-install export imported over 300 exam items empties the log", async () => {
    await seed(src);
    const { bundle } = await exportBundle(src, NOW);
    await seed(dst);
    seedExamLog(dst, 300);
    expect((await readExamItems(dst)).items).toHaveLength(300);
    const summary = await importBundle(dst, bundle, REPLACE);
    expect((await readExamItems(dst)).items).toEqual([]);
    expect(summary.examItems).toBe(0);
  });

  test("an old-style bundle (no examItems key) over a non-empty log leaves it untouched and reports null", async () => {
    await seed(dst);
    seedExamLog(dst, 3);
    const before = readFileSync(join(dst, "exam-items.jsonl"), "utf8");
    const summary = await importBundle(dst, loadBundle(V1), REPLACE);
    expect(readFileSync(join(dst, "exam-items.jsonl"), "utf8")).toBe(before);
    expect(summary.examItems).toBeNull();
  });

  test("the summary reports how many items the log now holds", async () => {
    const summary = await importBundle(dst, loadBundle(EXAM), REPLACE);
    expect(summary.examItems).toBe(EXPECTED_EXAM_ITEMS.length);
    const viaFile = await importBundleFromFile(dst, EXAM, REPLACE);
    expect(viaFile.examItems).toBe(EXPECTED_EXAM_ITEMS.length);
    const old = await importBundleFromFile(dst, V1, REPLACE);
    expect(old.examItems).toBeNull();
  });

  test("a bundle without examItems does not create an exam log", async () => {
    await importBundle(dst, loadBundle(V1), REPLACE);
    expect(existsSync(join(dst, "exam-items.jsonl"))).toBe(false);
  });

  test.each([
    ["with examItems", EXAM],
    ["without examItems", V1],
  ])("a replace-import removes exam-pending.json (%s)", async (_n, file) => {
    await seed(dst);
    await savePending(dst, pendingValue());
    await importBundle(dst, loadBundle(file), REPLACE);
    expect(existsSync(join(dst, "exam-pending.json"))).toBe(false);
    expect(await loadPending(dst)).toBeNull();
  });

  test("importBundleFromFile also removes exam-pending.json", async () => {
    await seed(dst);
    await savePending(dst, pendingValue());
    await importBundleFromFile(dst, V1, REPLACE);
    expect(existsSync(join(dst, "exam-pending.json"))).toBe(false);
  });

  test("an invalid bundle leaves exam-pending.json and everything else untouched", async () => {
    await seed(dst);
    await savePending(dst, pendingValue());
    const before = snapshot(dst);
    const bad = { ...loadBundle(V1), version: 99 } as unknown as Bundle;
    await expectCode(importBundle(dst, bad, REPLACE), "IMPORT_INVALID");
    expect(snapshot(dst)).toEqual(before);
    expect(await loadPending(dst)).toEqual(pendingValue());
  });

  test("a pending exam is never exported", async () => {
    await seed(src);
    await savePending(src, pendingValue());
    const { bundle } = await exportBundle(src, NOW);
    expect(JSON.stringify(bundle)).not.toContain("createdAt");
  });

  test("an import never creates exam-pending.json", async () => {
    await importBundle(dst, loadBundle(EXAM), REPLACE);
    expect(existsSync(join(dst, "exam-pending.json"))).toBe(false);
  });

  test("an invalid exam section is IMPORT_INVALID and changes nothing", async () => {
    await seed(dst);
    await appendExamItem(dst, exam());
    const before = snapshot(dst);
    const bad = {
      ...loadBundle(EXAM),
      examItems: [rawItem({ at: -1 })],
    } as unknown as Bundle;
    await expectCode(importBundle(dst, bad, REPLACE), "IMPORT_INVALID");
    expect(snapshot(dst)).toEqual(before);
  });

  test("an import leaves no temp file behind", async () => {
    await importBundle(dst, loadBundle(EXAM), REPLACE);
    expect(readdirSync(dst).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  test("export then import preserves the exam log and activeTrack", async () => {
    await seed(src);
    await saveState(src, { ...defaultState(NOW), activeTrack: "CCAR-P" });
    await appendExamItem(src, exam({ at: 1 }));
    await appendExamItem(src, exam({ at: 2, mode: "mock", correct: false }));
    const { bundle } = await exportBundle(src, NOW);
    await importBundle(dst, bundle, REPLACE);
    expect((await readExamItems(dst)).items).toEqual(
      (await readExamItems(src)).items,
    );
    expect((await loadState(dst, NOW)).activeTrack).toBe("CCAR-P");
    expect(evidenceAt(1)).toBeDefined();
  });
});

describe("purgeData and describeData cover the exam files", () => {
  test("purge deletes exam-items.jsonl and exam-pending.json and lists them", async () => {
    await seed(src);
    await appendExamItem(src, exam());
    await savePending(src, pendingValue());
    const result = await purgeData(src, { confirm: true });
    expect([...result.deleted].sort()).toEqual([
      "evidence",
      "examItems",
      "examPending",
      "goals",
      "profile",
      "state",
    ]);
    expect(result.alreadyMissing).toEqual(["catalog"]);
    expect(existsSync(join(src, "exam-items.jsonl"))).toBe(false);
    expect(existsSync(join(src, "exam-pending.json"))).toBe(false);
  });

  test("purge reports absent exam files as alreadyMissing", async () => {
    mkdirSync(src);
    const result = await purgeData(src, { confirm: true });
    expect(result.alreadyMissing).toEqual(
      expect.arrayContaining(["examItems", "examPending"]),
    );
  });

  test("describe lists both files with byte sizes, null when absent", async () => {
    await seed(src);
    const absent = await describeData(src, NOW);
    const find = (info: typeof absent, file: string) =>
      info.files.find((f) => f.file === file);
    expect(find(absent, "examItems")?.bytes).toBeNull();
    expect(find(absent, "examPending")?.bytes).toBeNull();

    await appendExamItem(src, exam());
    await savePending(src, pendingValue());
    writeFileSync(join(src, "unrelated.txt"), "x");
    const info = await describeData(src, NOW);
    expect(find(info, "examItems")?.bytes).toBe(
      Buffer.byteLength(readFileSync(join(src, "exam-items.jsonl"), "utf8")),
    );
    expect(find(info, "examItems")?.path).toBe(join(src, "exam-items.jsonl"));
    expect(find(info, "examPending")?.bytes).toBe(
      Buffer.byteLength(readFileSync(join(src, "exam-pending.json"), "utf8")),
    );
    expect(find(info, "examPending")?.path).toBe(
      join(src, "exam-pending.json"),
    );
  });
});
