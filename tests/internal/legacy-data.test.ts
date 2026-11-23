import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  DATA_DIR_PREFIX,
  LEGACY_DATA_DIR_PREFIX,
  MAX_LEGACY_FILE_BYTES,
  MIGRATION_MARKER,
  legacyDataDir,
  migrateLegacyData,
} from "../../src/internal/legacy-data.ts";

// The layout Claude Code uses: <root>/plugins/data/<name>-<marketplace>/.
let root = "";
let legacy = "";
let current = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "legacy-data-"));
  legacy = join(root, `${LEGACY_DATA_DIR_PREFIX}monte3l`);
  current = join(root, `${DATA_DIR_PREFIX}monte3l`);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function seedLegacy(files: Readonly<Record<string, string>>): void {
  mkdirSync(legacy, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(legacy, name), text);
  }
}

function listing(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

const ALL = {
  "profile.json": '{"p":1}\n',
  "state.json": '{"s":1}\n',
  "catalog.json": '{"c":1}\n',
  "goals.md": "Learn hooks\n",
  "evidence.jsonl": '{"e":1}\n{"e":2}\n',
  "exam-items.jsonl": '{"i":1}\n',
  "exam-pending.json": '{"x":1}\n',
};

describe("legacyDataDir", () => {
  test("maps the new directory name to the old one, keeping the marketplace", () => {
    expect(legacyDataDir("/h/.claude/plugins/data/m3l-mentor-monte3l")).toBe(
      "/h/.claude/plugins/data/m3l-claude-mentor-monte3l",
    );
    expect(legacyDataDir("/h/data/m3l-mentor-my-market/")).toBe(
      "/h/data/m3l-claude-mentor-my-market",
    );
  });

  test("is null for any directory that is not named after the new id", () => {
    for (const dir of [
      "/tmp/anything",
      "/h/data/m3l-claude-mentor-monte3l",
      "/h/data/m3l-mentor",
      "/h/data/m3l-mentor-",
      "/h/data/xm3l-mentor-monte3l",
    ]) {
      expect(legacyDataDir(dir), dir).toBeNull();
    }
  });
});

describe("migrateLegacyData", () => {
  test("copies every managed file, state.json last in the returned order", async () => {
    seedLegacy(ALL);
    const copied = await migrateLegacyData(current);
    expect(copied).toEqual([
      "profile",
      "evidence",
      "catalog",
      "goals",
      "examItems",
      "examPending",
      "state",
    ]);
    for (const [name, text] of Object.entries(ALL)) {
      expect(readFileSync(join(current, name), "utf8"), name).toBe(text);
    }
  });

  test("leaves the old directory exactly as it was", async () => {
    seedLegacy(ALL);
    const before = listing(legacy).map((n) =>
      readFileSync(join(legacy, n), "utf8"),
    );
    await migrateLegacyData(current);
    expect(listing(legacy)).toEqual(Object.keys(ALL).sort());
    expect(
      listing(legacy).map((n) => readFileSync(join(legacy, n), "utf8")),
    ).toEqual(before);
  });

  test("writes private files, a marker, and no temp or lock leftovers other than the lock", async () => {
    seedLegacy(ALL);
    await migrateLegacyData(current);
    for (const name of Object.keys(ALL)) {
      expect(statSync(join(current, name)).mode & 0o777, name).toBe(0o600);
    }
    expect(existsSync(join(current, MIGRATION_MARKER))).toBe(true);
    expect(listing(current).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  test("does nothing, and creates nothing, when there is no old directory", async () => {
    expect(await migrateLegacyData(current)).toEqual([]);
    expect(existsSync(current)).toBe(false);
  });

  test("does nothing for a directory that is not named after the new id", async () => {
    const other = join(root, "somewhere");
    mkdirSync(join(root, `${LEGACY_DATA_DIR_PREFIX}somewhere`), {
      recursive: true,
    });
    expect(await migrateLegacyData(other)).toEqual([]);
    expect(existsSync(other)).toBe(false);
  });

  test("runs once: later sessions copy nothing, and a purge is not undone", async () => {
    seedLegacy(ALL);
    expect((await migrateLegacyData(current)).length).toBe(7);
    rmSync(join(current, "profile.json"));
    rmSync(join(current, "state.json"));
    expect(await migrateLegacyData(current)).toEqual([]);
    expect(existsSync(join(current, "profile.json"))).toBe(false);
    expect(existsSync(join(current, "state.json"))).toBe(false);
  });

  test("never replaces a file the new directory already has", async () => {
    seedLegacy(ALL);
    mkdirSync(current, { recursive: true });
    writeFileSync(join(current, "goals.md"), "NEW goals\n");
    const copied = await migrateLegacyData(current);
    expect(copied).not.toContain("goals");
    expect(readFileSync(join(current, "goals.md"), "utf8")).toBe("NEW goals\n");
    expect(readFileSync(join(current, "profile.json"), "utf8")).toBe(
      ALL["profile.json"],
    );
  });

  test("copies only the files the old directory has", async () => {
    seedLegacy({ "profile.json": ALL["profile.json"] });
    expect(await migrateLegacyData(current)).toEqual(["profile"]);
    expect(listing(current).filter((n) => !n.startsWith("."))).toEqual([
      "profile.json",
    ]);
  });

  test("ignores files that are not managed, and anything that is not a regular file", async () => {
    seedLegacy({ "profile.json": ALL["profile.json"], "notes.txt": "x" });
    writeFileSync(join(root, "outside.json"), '{"secret":true}');
    symlinkSync(join(root, "outside.json"), join(legacy, "state.json"));
    mkdirSync(join(legacy, "goals.md"));
    expect(await migrateLegacyData(current)).toEqual(["profile"]);
    expect(existsSync(join(current, "notes.txt"))).toBe(false);
    expect(existsSync(join(current, "state.json"))).toBe(false);
    expect(existsSync(join(current, "goals.md"))).toBe(false);
  });

  test("does not follow a symlinked old directory", async () => {
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, "profile.json"), ALL["profile.json"]);
    symlinkSync(elsewhere, legacy);
    expect(await migrateLegacyData(current)).toEqual([]);
    expect(existsSync(join(current, "profile.json"))).toBe(false);
  });

  test("skips a file above the size limit and copies the rest", async () => {
    seedLegacy(ALL);
    truncateSync(join(legacy, "evidence.jsonl"), MAX_LEGACY_FILE_BYTES + 1);
    const copied = await migrateLegacyData(current);
    expect(copied).not.toContain("evidence");
    expect(copied).toContain("profile");
    expect(existsSync(join(current, "evidence.jsonl"))).toBe(false);
  });

  test("two sessions starting together copy once and both succeed", async () => {
    seedLegacy(ALL);
    const [a, b] = await Promise.all([
      migrateLegacyData(current),
      migrateLegacyData(current),
    ]);
    expect([a.length, b.length].sort()).toEqual([0, 7]);
    expect(readFileSync(join(current, "state.json"), "utf8")).toBe(
      ALL["state.json"],
    );
  });

  test("a failure leaves no marker and no temp file, and the next session finishes", async () => {
    seedLegacy(ALL);
    const blocked = join(legacy, "evidence.jsonl");
    chmodSync(blocked, 0o000);
    try {
      await expect(migrateLegacyData(current)).rejects.toMatchObject({
        name: "MentorStateError",
        code: "WRITE_FAILED",
      });
      expect(existsSync(join(current, MIGRATION_MARKER))).toBe(false);
      expect(listing(current).filter((n) => n.endsWith(".tmp"))).toEqual([]);
      expect(existsSync(join(current, "state.json"))).toBe(false);
    } finally {
      chmodSync(blocked, 0o600);
    }
    const copied = await migrateLegacyData(current);
    expect(copied).toContain("evidence");
    expect(copied).toContain("state");
    expect(copied).not.toContain("profile");
    expect(existsSync(join(current, MIGRATION_MARKER))).toBe(true);
  });

  test("the error text never contains a path or file content", async () => {
    seedLegacy({ "profile.json": "SECRET-CONTENT" });
    const blocked = join(legacy, "profile.json");
    chmodSync(blocked, 0o000);
    try {
      const error = await migrateLegacyData(current).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).not.toContain("SECRET-CONTENT");
      expect(message).not.toContain(root);
    } finally {
      chmodSync(blocked, 0o600);
    }
  });

  test("an old directory that cannot be read is a READ_FAILED, and the next session retries", async () => {
    seedLegacy(ALL);
    chmodSync(legacy, 0o000);
    try {
      await expect(migrateLegacyData(current)).rejects.toMatchObject({
        name: "MentorStateError",
        code: "READ_FAILED",
      });
      expect(existsSync(join(current, MIGRATION_MARKER))).toBe(false);
    } finally {
      chmodSync(legacy, 0o700);
    }
    expect((await migrateLegacyData(current)).length).toBe(7);
  });

  test("an old name that is a plain file, not a directory, is ignored", async () => {
    writeFileSync(legacy, "not a directory");
    expect(await migrateLegacyData(current)).toEqual([]);
    expect(existsSync(current)).toBe(false);
  });

  test("a read-only new directory is a WRITE_FAILED with nothing half-written", async () => {
    seedLegacy(ALL);
    mkdirSync(current, { recursive: true });
    chmodSync(current, 0o500);
    try {
      await expect(migrateLegacyData(current)).rejects.toBeInstanceOf(Error);
      expect(listing(current)).toEqual([]);
    } finally {
      chmodSync(current, 0o700);
    }
  });
});
