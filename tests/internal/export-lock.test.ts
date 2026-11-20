import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  exportBundle,
  exportBundleToFile,
  importBundle,
  importBundleFromFile,
  purgeData,
} from "../../src/internal/export.ts";
import type { LockOptions } from "../../src/internal/lock.ts";
import { saveGoals } from "../../src/internal/store.ts";
import { NOW, expectCode, seed } from "./fixtures/export-data.ts";

const LOCK = ".state.lock";
const REPLACE = { replace: true } as const;
const FOREIGN = JSON.stringify({
  v: 1,
  pid: 424242,
  host: "foreign-host-xyz",
  token: "foreign-token",
  createdAt: 0,
});

let sandbox = "";
let src = "";
let dst = "";

beforeEach(() => {
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), "export-lock-")));
  src = join(sandbox, "src");
  dst = join(sandbox, "dst");
});
afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A fake clock that `sleep` advances, so a timeout needs no real waiting. */
function fakeLock(): { lock: LockOptions; sleeps: number[] } {
  let t = Date.now();
  const sleeps: number[] = [];
  return {
    sleeps,
    lock: {
      timeoutMs: 50,
      now: () => t,
      sleep: (ms: number) => {
        sleeps.push(ms);
        t += ms;
        return Promise.resolve();
      },
    },
  };
}

/** Every entry of `dir` except lock files, as name to bytes. */
function dataSnapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    if (name.startsWith(LOCK)) continue;
    out[name] = readFileSync(join(dir, name), "utf8");
  }
  return out;
}

const lockFiles = (dir: string): string[] =>
  readdirSync(dir).filter((n) => n.startsWith(LOCK));
const tmpFiles = (dir: string): string[] =>
  readdirSync(dir).filter((n) => n.endsWith(".tmp"));

async function seedDstWithOldData(): Promise<void> {
  await seed(dst);
  await saveGoals(dst, "OLD GOALS that must survive");
}

describe("a held foreign lock blocks every replacing operation", () => {
  test("importBundle gives LOCK_TIMEOUT and replaces nothing", async () => {
    await seed(src);
    const { bundle } = await exportBundle(src, NOW);
    await seedDstWithOldData();
    writeFileSync(join(dst, LOCK), FOREIGN);
    const before = dataSnapshot(dst);
    const { lock, sleeps } = fakeLock();
    await expectCode(
      importBundle(dst, bundle, REPLACE, { lock }),
      "LOCK_TIMEOUT",
    );
    expect(sleeps.length).toBeGreaterThan(0);
    expect(dataSnapshot(dst)).toEqual(before);
    expect(readFileSync(join(dst, LOCK), "utf8")).toBe(FOREIGN);
  });

  test("importBundleFromFile gives LOCK_TIMEOUT and replaces nothing", async () => {
    await seed(src);
    const file = join(sandbox, "bundle.json");
    await exportBundleToFile(src, NOW, file);
    await seedDstWithOldData();
    writeFileSync(join(dst, LOCK), FOREIGN);
    const before = dataSnapshot(dst);
    const { lock, sleeps } = fakeLock();
    await expectCode(
      importBundleFromFile(dst, file, REPLACE, { lock }),
      "LOCK_TIMEOUT",
    );
    expect(sleeps.length).toBeGreaterThan(0);
    expect(dataSnapshot(dst)).toEqual(before);
    expect(readFileSync(join(dst, LOCK), "utf8")).toBe(FOREIGN);
  });

  test("purgeData gives LOCK_TIMEOUT and deletes nothing; the foreign lock is untouched", async () => {
    await seedDstWithOldData();
    writeFileSync(join(dst, LOCK), FOREIGN);
    const before = dataSnapshot(dst);
    const { lock, sleeps } = fakeLock();
    await expectCode(
      purgeData(dst, { confirm: true }, { lock }),
      "LOCK_TIMEOUT",
    );
    expect(sleeps.length).toBeGreaterThan(0);
    expect(dataSnapshot(dst)).toEqual(before);
    expect(readFileSync(join(dst, LOCK), "utf8")).toBe(FOREIGN);
  });
});

describe("a successful import", () => {
  test("replaces the data and leaves no .tmp and no lock file", async () => {
    await seed(src);
    const { bundle } = await exportBundle(src, NOW);
    await seedDstWithOldData();
    const { lock } = fakeLock();
    const summary = await importBundle(dst, bundle, REPLACE, { lock });
    expect(summary.evidenceEvents).toBe(2);
    expect(readFileSync(join(dst, "goals.md"), "utf8")).toBe(
      "Learn hooks\nand plan mode\n",
    );
    expect(tmpFiles(dst)).toEqual([]);
    expect(lockFiles(dst)).toEqual([]);
  });
});

describe("purgeData with the lock", () => {
  test("reports deleted and alreadyMissing as before and leaves no lock file", async () => {
    await seed(dst);
    const { lock } = fakeLock();
    const result = await purgeData(dst, { confirm: true }, { lock });
    expect([...result.deleted].sort()).toEqual([
      "evidence",
      "goals",
      "profile",
      "state",
    ]);
    expect(result.alreadyMissing).toEqual([
      "catalog",
      "examItems",
      "examPending",
    ]);
    expect(lockFiles(dst)).toEqual([]);
  });

  test("a missing directory stays missing and everything is alreadyMissing", async () => {
    const { lock, sleeps } = fakeLock();
    const result = await purgeData(dst, { confirm: true }, { lock });
    expect(existsSync(dst)).toBe(false);
    expect(result.deleted).toEqual([]);
    expect([...result.alreadyMissing].sort()).toEqual([
      "catalog",
      "evidence",
      "examItems",
      "examPending",
      "goals",
      "profile",
      "state",
    ]);
    expect(sleeps).toEqual([]);
  });

  test("the confirm check comes before the lock", async () => {
    await seed(dst);
    writeFileSync(join(dst, LOCK), FOREIGN);
    const { lock, sleeps } = fakeLock();
    await expectCode(
      purgeData(dst, {} as unknown as { confirm: true }, { lock }),
      "CONFIRMATION_REQUIRED",
    );
    expect(sleeps).toEqual([]);
  });

  test("the temp sweep removes leftover .state.lock.stale.* files", async () => {
    await seed(dst);
    writeFileSync(join(dst, ".state.lock.stale.aaaa"), "{}");
    writeFileSync(join(dst, ".state.lock.stale.bbbb"), "");
    writeFileSync(join(dst, "notes.txt"), "mine");
    const { lock } = fakeLock();
    await purgeData(dst, { confirm: true }, { lock });
    expect(readdirSync(dst).sort()).toEqual(["notes.txt"]);
  });
});
