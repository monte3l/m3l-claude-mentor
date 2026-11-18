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
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MentorStateError } from "../../src/internal/errors.ts";
import {
  stageTextAtomic,
  writeTextAtomic,
} from "../../src/internal/fs-atomic.ts";

type FsPromises = typeof FsPromises0;
type Fn = (...args: unknown[]) => Promise<unknown>;

const fsMocks = vi.hoisted(() => ({ open: vi.fn(), rename: vi.fn() }));

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<FsPromises>()),
  ...fsMocks,
}));

let dir = "";
let real: FsPromises;

beforeEach(async () => {
  real = await vi.importActual<FsPromises>("node:fs/promises");
  fsMocks.open.mockImplementation(real.open);
  fsMocks.rename.mockImplementation(real.rename);
  dir = realpathSync(mkdtempSync(join(tmpdir(), "stage-")));
});
afterEach(() => {
  fsMocks.open.mockReset();
  fsMocks.rename.mockReset();
  rmSync(dir, { recursive: true, force: true });
});

const TEMP_NAME = new RegExp(
  `^\\.goals\\.md\\.${String(process.pid)}\\.[0-9a-f-]{36}\\.tmp$`,
);

describe("stageTextAtomic", () => {
  test("writes a temp named .<file>.<pid>.<uuid>.tmp in dir and leaves the target alone", async () => {
    writeFileSync(join(dir, "goals.md"), "old");
    const staged = await stageTextAtomic(dir, "goals", "new text");
    expect(dirname(staged.temp)).toBe(dir);
    expect(basename(staged.temp)).toMatch(TEMP_NAME);
    expect(readFileSync(staged.temp, "utf8")).toBe("new text");
    expect(readFileSync(join(dir, "goals.md"), "utf8")).toBe("old");
    expect(fsMocks.rename).not.toHaveBeenCalled();
    expect(typeof staged.commit).toBe("function");
  });

  test("does not create the target before commit", async () => {
    await stageTextAtomic(dir, "goals", "x");
    expect(existsSync(join(dir, "goals.md"))).toBe(false);
  });

  test("fsyncs the temp file before it returns", async () => {
    const syncs: ReturnType<typeof vi.fn>[] = [];
    fsMocks.open.mockImplementation(async (...args: unknown[]) => {
      const handle = (await (real.open as unknown as Fn)(
        ...args,
      )) as FileHandle;
      const sync = vi.fn(handle.sync.bind(handle));
      handle.sync = sync;
      syncs.push(sync);
      return handle;
    });
    await stageTextAtomic(dir, "goals", "durable");
    expect(syncs).toHaveLength(1);
    expect(syncs[0]).toHaveBeenCalledTimes(1);
  });

  test("commit renames the temp over the target", async () => {
    writeFileSync(join(dir, "goals.md"), "old");
    const staged = await stageTextAtomic(dir, "goals", "new text");
    await staged.commit();
    expect(fsMocks.rename).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(dir, "goals.md"), "utf8")).toBe("new text");
    expect(readdirSync(dir)).toEqual(["goals.md"]);
  });

  test("a staging failure is WRITE_FAILED with the fs error as cause", async () => {
    const cause = Object.assign(new Error("EIO: injected"), { code: "EIO" });
    fsMocks.open.mockRejectedValue(cause);
    let thrown: unknown;
    try {
      await stageTextAtomic(dir, "goals", "x");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(MentorStateError);
    expect((thrown as MentorStateError).code).toBe("WRITE_FAILED");
    expect((thrown as MentorStateError).cause).toBe(cause);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("a commit failure is WRITE_FAILED with the fs error as cause", async () => {
    const cause = Object.assign(new Error("EIO: injected"), { code: "EIO" });
    const staged = await stageTextAtomic(dir, "goals", "x");
    fsMocks.rename.mockRejectedValue(cause);
    let thrown: unknown;
    try {
      await staged.commit();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(MentorStateError);
    expect((thrown as MentorStateError).code).toBe("WRITE_FAILED");
    expect((thrown as MentorStateError).cause).toBe(cause);
    expect(existsSync(join(dir, "goals.md"))).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe("writeTextAtomic is still stage plus commit", () => {
  test("replaces the target and leaves no temp", async () => {
    writeFileSync(join(dir, "goals.md"), "old");
    await writeTextAtomic(dir, "goals", "fresh");
    expect(readFileSync(join(dir, "goals.md"), "utf8")).toBe("fresh");
    expect(readdirSync(dir)).toEqual(["goals.md"]);
  });
});
