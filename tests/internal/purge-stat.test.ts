import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type * as FsPromises0 from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { purgeData } from "../../src/internal/export.ts";
import { expectCode, seed } from "./fixtures/export-data.ts";

type FsPromises = typeof FsPromises0;

// Only `stat` is a spy (real by default): it is how purge decides whether the
// data directory exists and so whether there is anything to lock.
const fsMocks = vi.hoisted(() => ({ stat: vi.fn() }));

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<FsPromises>()),
  ...fsMocks,
}));

const LOCK = ".state.lock";
let sandbox = "";
let dir = "";
let real: FsPromises;

beforeEach(async () => {
  real = await vi.importActual<FsPromises>("node:fs/promises");
  fsMocks.stat.mockImplementation(real.stat);
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), "purge-stat-")));
  dir = join(sandbox, "data");
});
afterEach(() => {
  fsMocks.stat.mockReset();
  rmSync(sandbox, { recursive: true, force: true });
});

const statError = (code: string): Error & { code: string } =>
  Object.assign(new Error(`${code}: injected`), { code });

function fakeLock() {
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

describe("purge when the data directory cannot be a directory", () => {
  test.each(["ENOENT", "ENOTDIR"])(
    "a stat %s means nothing to lock: dir stays missing, all alreadyMissing",
    async (code) => {
      fsMocks.stat.mockRejectedValue(statError(code));
      const { lock, sleeps } = fakeLock();
      const result = await purgeData(dir, { confirm: true }, { lock });
      expect(fsMocks.stat).toHaveBeenCalled();
      expect(existsSync(dir)).toBe(false);
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
    },
  );

  test("a really missing directory stays missing (real stat)", async () => {
    const result = await purgeData(dir, { confirm: true });
    expect(existsSync(dir)).toBe(false);
    expect(result.alreadyMissing).toHaveLength(7);
  });
});

describe("purge when the data directory cannot be inspected", () => {
  test.each(["EIO", "EACCES", "ELOOP"])(
    "a stat %s is WRITE_FAILED with a fixed message, deletes nothing and takes no lock",
    async (code) => {
      await seed(dir);
      const before = readdirSync(dir).sort();
      const contents = before.map((n) => readFileSync(join(dir, n), "utf8"));
      const cause = statError(code);
      fsMocks.stat.mockRejectedValue(cause);
      const { lock } = fakeLock();
      const error = await expectCode(
        purgeData(dir, { confirm: true }, { lock }),
        "WRITE_FAILED",
      );
      expect(fsMocks.stat).toHaveBeenCalled();
      expect(error.message).toBe("could not inspect the data directory");
      expect(error.message).not.toContain(dir);
      expect(error.cause).toBe(cause);
      expect(readdirSync(dir).sort()).toEqual(before);
      expect(before.map((n) => readFileSync(join(dir, n), "utf8"))).toEqual(
        contents,
      );
      expect(readdirSync(dir).filter((n) => n.startsWith(LOCK))).toEqual([]);
    },
  );
});

describe("purge of a normal existing directory", () => {
  test("takes the lock and purges", async () => {
    await seed(dir);
    const { lock } = fakeLock();
    const result = await purgeData(dir, { confirm: true }, { lock });
    expect(fsMocks.stat).toHaveBeenCalled();
    expect(result.deleted).toHaveLength(4);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("a foreign fresh lock blocks it", async () => {
    await seed(dir);
    writeFileSync(join(dir, LOCK), "{}");
    const { lock, sleeps } = fakeLock();
    await expectCode(
      purgeData(dir, { confirm: true }, { lock }),
      "LOCK_TIMEOUT",
    );
    expect(sleeps.length).toBeGreaterThan(0);
    expect(existsSync(join(dir, "state.json"))).toBe(true);
  });
});
