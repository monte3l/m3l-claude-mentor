import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  describeData,
  exportBundle,
  exportBundleToFile,
  importBundle,
  importBundleFromFile,
  parseBundle,
  serializeBundle,
  type Bundle,
} from "../../src/internal/export.js";
import {
  loadCatalogFile,
  loadGoals,
  loadProfile,
  loadState,
  readEvidence,
  appendEvidence,
} from "../../src/internal/store.js";
import { MentorStateError } from "../../src/internal/errors.js";
import {
  NOW,
  evidenceAt,
  expectCode,
  seed,
  snapshot,
} from "./fixtures/export-data.js";

let sandbox = "";
let src = "";
let dst = "";

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "export-io-"));
  src = join(sandbox, "src");
  dst = join(sandbox, "dst");
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

const REPLACE = { replace: true } as const;

describe("exportBundle", () => {
  test("returns every section of seeded data with exportedAt = now", async () => {
    await seed(src);
    const { bundle } = await exportBundle(src, NOW);
    expect(bundle.format).toBe("m3l-claude-mentor-export");
    expect(bundle.version).toBe(1);
    expect(bundle.exportedAt).toBe(NOW);
    expect(bundle.state.muted).toBe(true);
    expect(bundle.state.mutedTopics).toEqual(["hooks"]);
    expect(bundle.state.excludedProjects).toEqual(["/work/secret-project"]);
    expect(bundle.profile.topics["plan-mode"]?.passes).toBe(2);
    expect(bundle.profile.calibration).toEqual({ confirmed: 3, refuted: 1 });
    expect(bundle.goals).toBe("Learn hooks\nand plan mode\n");
    expect(bundle.evidence.map((e) => e.at)).toEqual([NOW - 3000, NOW - 2000]);
  });

  test("a missing directory exports defaults", async () => {
    const { bundle } = await exportBundle(src, NOW);
    expect(bundle.goals).toBe("");
    expect(bundle.evidence).toEqual([]);
    expect(bundle.profile.topics).toEqual({});
    expect(bundle.state.muted).toBe(false);
    expect(existsSync(src)).toBe(false);
  });

  test("a corrupt section propagates its typed error instead of being skipped", async () => {
    await seed(src);
    writeFileSync(join(src, "profile.json"), "{not json");
    await expectCode(exportBundle(src, NOW), "PARSE_FAILED");
  });

  test.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects now = %s with RangeError",
    async (now) => {
      await expect(exportBundle(src, now)).rejects.toBeInstanceOf(RangeError);
    },
  );
});

describe("exportBundleToFile", () => {
  test("writes a parseable bundle file atomically with no temp file left", async () => {
    await seed(src);
    const target = join(sandbox, "out.json");
    await exportBundleToFile(src, NOW, target);
    const text = readFileSync(target, "utf8");
    expect(text.endsWith("\n")).toBe(true);
    const parsed = parseBundle(JSON.parse(text));
    expect(parsed.ok).toBe(true);
    if (parsed.ok)
      expect(parsed.value.goals).toBe("Learn hooks\nand plan mode\n");
    expect(snapshot(sandbox)["out.json"]).toBeDefined();
    expect(
      Object.keys(snapshot(sandbox)).filter((n) => n.endsWith(".tmp")),
    ).toEqual([]);
  });

  test("rejects a relative target with VALIDATION_FAILED", async () => {
    await expectCode(
      exportBundleToFile(src, NOW, "out.json"),
      "VALIDATION_FAILED",
    );
  });

  test("refuses a target equal to a managed file path and leaves it untouched", async () => {
    await seed(src);
    const before = snapshot(src);
    await expectCode(
      exportBundleToFile(src, NOW, join(src, "state.json")),
      "VALIDATION_FAILED",
    );
    expect(snapshot(src)).toEqual(before);
  });

  test("rejects an invalid now with RangeError", async () => {
    await expect(
      exportBundleToFile(src, -5, join(sandbox, "o.json")),
    ).rejects.toBeInstanceOf(RangeError);
  });
});

describe("importBundle / importBundleFromFile", () => {
  test("round trip: export then import into a fresh sandbox reproduces everything", async () => {
    await seed(src);
    const file = join(sandbox, "bundle.json");
    await exportBundleToFile(src, NOW, file);
    const summary = await importBundleFromFile(dst, file, REPLACE);
    expect(summary).toEqual({
      state: true,
      profile: true,
      catalog: true,
      goals: true,
      evidenceEvents: 2,
    });
    expect(await loadState(dst, NOW)).toEqual(await loadState(src, NOW));
    expect(await loadProfile(dst, NOW)).toEqual(await loadProfile(src, NOW));
    expect(await loadCatalogFile(dst)).toEqual(await loadCatalogFile(src));
    expect(await loadGoals(dst)).toBe("Learn hooks\nand plan mode\n");
    expect((await readEvidence(dst)).events).toEqual([
      evidenceAt(NOW - 3000, "sess-1"),
      evidenceAt(NOW - 2000, "sess-2"),
    ]);
    expect((await loadState(dst, NOW)).excludedProjects).toEqual([
      "/work/secret-project",
    ]);
  });

  test("importBundle replaces existing data and never appends onto the old evidence log", async () => {
    await seed(src);
    const { bundle } = await exportBundle(src, NOW);
    await seed(dst);
    await appendEvidence(dst, evidenceAt(NOW - 1000, "old-extra"));
    expect((await readEvidence(dst)).events).toHaveLength(3);
    const summary = await importBundle(dst, bundle, REPLACE);
    expect(summary.evidenceEvents).toBe(2);
    const events = (await readEvidence(dst)).events;
    expect(events.map((e) => e.session)).toEqual(["sess-1", "sess-2"]);
    const lines = readFileSync(join(dst, "evidence.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l !== "");
    expect(lines).toHaveLength(2);
  });

  test("importing an empty-evidence bundle empties an existing log", async () => {
    await seed(dst);
    const { bundle } = await exportBundle(join(sandbox, "none"), NOW);
    const summary = await importBundle(dst, bundle, REPLACE);
    expect(summary.evidenceEvents).toBe(0);
    expect((await readEvidence(dst)).events).toEqual([]);
    expect(await loadGoals(dst)).toBe("");
  });

  test.each([
    ["omitted", {}],
    ["false", { replace: false }],
    ["a truthy string", { replace: "yes" as unknown as boolean }],
  ])(
    "replace %s -> CONFIRMATION_REQUIRED and nothing changes",
    async (_n, options) => {
      await seed(src);
      const { bundle } = await exportBundle(src, NOW);
      await seed(dst);
      const before = snapshot(dst);
      await expectCode(
        importBundle(dst, bundle, options as { replace: boolean }),
        "CONFIRMATION_REQUIRED",
      );
      expect(snapshot(dst)).toEqual(before);
    },
  );

  test("a bad file import with replace:false also requires confirmation", async () => {
    const file = join(sandbox, "b.json");
    await seed(src);
    await exportBundleToFile(src, NOW, file);
    await expectCode(
      importBundleFromFile(dst, file, { replace: false }),
      "CONFIRMATION_REQUIRED",
    );
    expect(existsSync(dst)).toBe(false);
  });

  describe("invalid bundles leave the directory byte-for-byte unchanged", () => {
    const mutate = (change: (b: Record<string, unknown>) => void): string => {
      const raw = JSON.parse(
        readFileSync(join(sandbox, "good.json"), "utf8"),
      ) as Record<string, unknown>;
      change(raw);
      const path = join(sandbox, "bad.json");
      writeFileSync(path, JSON.stringify(raw));
      return path;
    };

    beforeEach(async () => {
      await seed(src);
      await exportBundleToFile(src, NOW, join(sandbox, "good.json"));
      await seed(dst);
      await appendEvidence(dst, evidenceAt(NOW - 1000, "target-only"));
    });

    test.each([
      [
        "version 2",
        (b: Record<string, unknown>) => {
          b["version"] = 2;
        },
      ],
      [
        "wrong format",
        (b: Record<string, unknown>) => {
          b["format"] = "nope";
        },
      ],
      [
        "missing profile",
        (b: Record<string, unknown>) => {
          Reflect.deleteProperty(b, "profile");
        },
      ],
      [
        "missing goals",
        (b: Record<string, unknown>) => {
          Reflect.deleteProperty(b, "goals");
        },
      ],
      [
        "corrupt last evidence item",
        (b: Record<string, unknown>) => {
          (b["evidence"] as unknown[]).push({ channel: "quiz" });
        },
      ],
      [
        "invalid state",
        (b: Record<string, unknown>) => {
          b["state"] = { schemaVersion: 9 };
        },
      ],
    ])("%s -> IMPORT_INVALID", async (_n, change) => {
      const before = snapshot(dst);
      await expectCode(
        importBundleFromFile(dst, mutate(change), REPLACE),
        "IMPORT_INVALID",
      );
      expect(snapshot(dst)).toEqual(before);
    });

    test("a corrupt evidence item names its zero-based index in the message", async () => {
      const path = mutate((b) => {
        (b["evidence"] as unknown[]).push({ channel: "quiz" });
      });
      const error = await expectCode(
        importBundleFromFile(dst, path, REPLACE),
        "IMPORT_INVALID",
      );
      expect(error.message).toContain("2");
    });

    test("malformed JSON -> IMPORT_INVALID with a fixed message and no cause", async () => {
      const path = join(sandbox, "junk.json");
      writeFileSync(path, "{SECRETTEXT");
      const before = snapshot(dst);
      const error = await expectCode(
        importBundleFromFile(dst, path, REPLACE),
        "IMPORT_INVALID",
      );
      expect(error.cause).toBeUndefined();
      expect(error.message).not.toContain("SECRETTEXT");
      expect(snapshot(dst)).toEqual(before);
    });

    test("importBundle with an in-memory invalid bundle (corrupt state) writes nothing", async () => {
      const good = parseBundle(
        JSON.parse(readFileSync(join(sandbox, "good.json"), "utf8")),
      );
      if (!good.ok) throw new Error(good.reason);
      const broken = {
        ...good.value,
        state: { schemaVersion: 9 },
      } as unknown as Bundle;
      const before = snapshot(dst);
      await expectCode(importBundle(dst, broken, REPLACE), "IMPORT_INVALID");
      expect(snapshot(dst)).toEqual(before);
    });
  });

  test("a bundle file over 16 MiB is rejected as TOO_LARGE without changing the directory", async () => {
    await seed(dst);
    const before = snapshot(dst);
    const path = join(sandbox, "huge.json");
    writeFileSync(path, " ".repeat(16 * 1024 * 1024 + 1));
    await expectCode(importBundleFromFile(dst, path, REPLACE), "TOO_LARGE");
    expect(snapshot(dst)).toEqual(before);
  });

  test("a missing source file is READ_FAILED, not an empty import", async () => {
    await expectCode(
      importBundleFromFile(dst, join(sandbox, "absent.json"), REPLACE),
      "READ_FAILED",
    );
    expect(existsSync(dst)).toBe(false);
  });

  test("a relative source path is VALIDATION_FAILED", async () => {
    await expectCode(
      importBundleFromFile(dst, "bundle.json", REPLACE),
      "VALIDATION_FAILED",
    );
  });

  test("a mid-import write failure is WRITE_FAILED naming the sections already replaced", async () => {
    await seed(src);
    const { bundle } = await exportBundle(src, NOW);
    mkdirSync(join(dst, "profile.json"), { recursive: true });
    const error = await expectCode(
      importBundle(dst, bundle, REPLACE),
      "WRITE_FAILED",
    );
    expect(error.message).toContain("evidence");
    expect(error.message).toContain("goals");
    expect(error.message).toContain("catalog");
    expect(error.message).not.toContain("state");
    // evidence and goals were really written before the failure; state last, never reached.
    expect(readFileSync(join(dst, "goals.md"), "utf8")).toBe(
      "Learn hooks\nand plan mode\n",
    );
    expect(existsSync(join(dst, "state.json"))).toBe(false);
    expect(statSync(join(dst, "profile.json")).isDirectory()).toBe(true);
  });

  test("the serialized bundle is what importBundleFromFile reads", async () => {
    await seed(src);
    const { bundle } = await exportBundle(src, NOW);
    const path = join(sandbox, "s.json");
    writeFileSync(path, serializeBundle(bundle));
    const summary = await importBundleFromFile(dst, path, REPLACE);
    expect(summary.evidenceEvents).toBe(2);
  });
});

describe("describeData", () => {
  test("reports all five files in DATA_FILES order with sizes, counts and exclusions", async () => {
    await seed(src);
    const info = await describeData(src, NOW);
    expect(info.dir).toBe(src);
    expect(info.files.map((f) => f.file)).toEqual([
      "profile",
      "state",
      "catalog",
      "goals",
      "evidence",
    ]);
    const sizeOf = (n: string): number => statSync(join(src, n)).size;
    const byFile = Object.fromEntries(info.files.map((f) => [f.file, f]));
    expect(byFile["goals"]?.bytes).toBe(
      Buffer.byteLength("Learn hooks\nand plan mode\n"),
    );
    expect(byFile["goals"]?.path).toBe(join(src, "goals.md"));
    expect(byFile["state"]?.bytes).toBe(sizeOf("state.json"));
    expect(byFile["evidence"]?.bytes).toBe(sizeOf("evidence.jsonl"));
    expect(byFile["profile"]?.bytes).toBe(sizeOf("profile.json"));
    expect(byFile["catalog"]?.bytes).toBeNull();
    expect(info.evidenceEvents).toBe(2);
    expect(info.evidenceSkipped).toBe(0);
    expect(info.topics).toBe(1);
    expect(info.mutedTopics).toBe(1);
    expect(info.excludedProjects).toEqual(["/work/secret-project"]);
  });

  test("counts skipped evidence lines without failing", async () => {
    await seed(src);
    writeFileSync(
      join(src, "evidence.jsonl"),
      `${JSON.stringify(evidenceAt(1))}\nnot json\n`,
    );
    const info = await describeData(src, NOW);
    expect(info.evidenceEvents).toBe(1);
    expect(info.evidenceSkipped).toBe(1);
  });

  test("a missing directory reports bytes null everywhere and zero counts", async () => {
    const info = await describeData(src, NOW);
    expect(info.files).toHaveLength(5);
    expect(info.files.every((f) => f.bytes === null)).toBe(true);
    expect(info.evidenceEvents).toBe(0);
    expect(info.topics).toBe(0);
    expect(info.mutedTopics).toBe(0);
    expect(info.excludedProjects).toEqual([]);
    expect(existsSync(src)).toBe(false);
  });

  test("a corrupt state.json propagates its typed error", async () => {
    await seed(src);
    writeFileSync(join(src, "state.json"), "{broken");
    const error = await expectCode(describeData(src, NOW), "PARSE_FAILED");
    expect(error).toBeInstanceOf(MentorStateError);
  });

  test("a corrupt profile.json propagates its typed error", async () => {
    await seed(src);
    writeFileSync(join(src, "profile.json"), "[]");
    await expectCode(describeData(src, NOW), "VALIDATION_FAILED");
  });

  test("a directory in place of a file is READ_FAILED", async () => {
    mkdirSync(join(src, "goals.md"), { recursive: true });
    await expectCode(describeData(src, NOW), "READ_FAILED");
  });

  test("rejects an invalid now with RangeError", async () => {
    await expect(describeData(src, Number.NaN)).rejects.toBeInstanceOf(
      RangeError,
    );
  });
});
