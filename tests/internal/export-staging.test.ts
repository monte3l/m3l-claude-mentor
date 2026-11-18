import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type * as FsPromises0 from "node:fs/promises";
import { exportBundle, importBundle } from "../../src/internal/export.ts";
import { saveGoals } from "../../src/internal/store.ts";
import { NOW, expectCode, seed } from "./fixtures/export-data.ts";

type FsPromises = typeof FsPromises0;
type Fn = (...args: unknown[]) => Promise<unknown>;

// `open` and `rename` are spies that default to the real filesystem; a test
// injects one fault (a refused temp file, a failing or racing rename).
const fsMocks = vi.hoisted(() => ({ open: vi.fn(), rename: vi.fn() }));

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<FsPromises>()),
  ...fsMocks,
}));

const FILES = [
  ["evidence", "evidence.jsonl"],
  ["goals", "goals.md"],
  ["catalog", "catalog.json"],
  ["profile", "profile.json"],
  ["state", "state.json"],
] as const;

let sandbox = "";
let src = "";
let dst = "";
let real: FsPromises;

beforeEach(async () => {
  real = await vi.importActual<FsPromises>("node:fs/promises");
  fsMocks.open.mockImplementation(real.open);
  fsMocks.rename.mockImplementation(real.rename);
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), "export-staging-")));
  src = join(sandbox, "src");
  dst = join(sandbox, "dst");
});
afterEach(() => {
  fsMocks.open.mockReset();
  fsMocks.rename.mockReset();
  rmSync(sandbox, { recursive: true, force: true });
});

function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    out[entry.name] = entry.isFile()
      ? readFileSync(join(dir, entry.name), "utf8")
      : "<dir>";
  }
  return out;
}

describe("two-phase replace", () => {
  test.each(FILES)(
    "if staging %s fails, all five old files are untouched and nothing is left behind",
    async (_key, fileName) => {
      await seed(src);
      const { bundle } = await exportBundle(src, NOW);
      await seed(dst);
      await saveGoals(dst, "OLD GOALS that must survive");
      mkdirSync(join(dst, "keep-dir"));
      const before = snapshot(dst);
      let refused = 0;
      fsMocks.open.mockImplementation((...args: unknown[]) => {
        const name = basename(String(args[0]));
        if (name.startsWith(`.${fileName}.`) && name.endsWith(".tmp")) {
          refused += 1;
          return Promise.reject(
            Object.assign(new Error("EIO: injected"), { code: "EIO" }),
          );
        }
        return (real.open as unknown as Fn)(...args);
      });
      await expectCode(
        importBundle(dst, bundle, { replace: true }),
        "WRITE_FAILED",
      );
      expect(refused).toBeGreaterThan(0); // the injection really fired
      expect(snapshot(dst)).toEqual(before);
      expect(readdirSync(dst).filter((n) => n.endsWith(".tmp"))).toEqual([]);
      expect(
        readdirSync(dst).filter((n) => n.startsWith(".state.lock")),
      ).toEqual([]);
    },
  );

  test("an unwritable data dir is WRITE_FAILED and changes nothing", async (ctx) => {
    if (process.platform === "win32" || process.getuid?.() === 0) ctx.skip();
    await seed(src);
    const { bundle } = await exportBundle(src, NOW);
    await seed(dst);
    const before = snapshot(dst);
    chmodSync(dst, 0o500);
    try {
      // Which step fails first (staging a temp or creating the lock) is not
      // part of the contract; either way it is a WRITE_FAILED.
      await expectCode(
        importBundle(dst, bundle, { replace: true }),
        "WRITE_FAILED",
      );
    } finally {
      chmodSync(dst, 0o700);
    }
    expect(snapshot(dst)).toEqual(before);
  });

  test("a rename-phase failure still names the sections already replaced", async () => {
    await seed(src);
    const { bundle } = await exportBundle(src, NOW);
    await seed(dst);
    let renames = 0;
    fsMocks.rename.mockImplementation((...args: unknown[]) => {
      renames += 1;
      if (basename(String(args[1])) === "profile.json") {
        return Promise.reject(
          Object.assign(new Error("EIO: injected"), { code: "EIO" }),
        );
      }
      return (real.rename as unknown as Fn)(...args);
    });
    const error = await expectCode(
      importBundle(dst, bundle, { replace: true }),
      "WRITE_FAILED",
    );
    expect(renames).toBeGreaterThan(0);
    expect(error.message).toContain(
      "sections already replaced: evidence, goals, catalog",
    );
    expect(readFileSync(join(dst, "goals.md"), "utf8")).toBe(
      "Learn hooks\nand plan mode\n",
    );
    // The failed profile temp and the never-committed state temp are both gone.
    expect(readdirSync(dst).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    expect(readdirSync(dst).filter((n) => n.startsWith(".state.lock"))).toEqual(
      [],
    );
  });
});

const LOCK = ".state.lock";
const TEMP_OF = (name: string): boolean =>
  /^\.(evidence\.jsonl|goals\.md|catalog\.json|profile\.json|state\.json)\..+\.tmp$/.test(
    name,
  );

describe("import stages before it takes the lock", () => {
  test("no lock file exists while any temp is opened, and the lock is held for the renames", async () => {
    await seed(src);
    const { bundle } = await exportBundle(src, NOW);
    await seed(dst);
    const lockAtTempOpen: boolean[] = [];
    const lockAtRename: boolean[] = [];
    fsMocks.open.mockImplementation((...args: unknown[]) => {
      if (TEMP_OF(basename(String(args[0])))) {
        lockAtTempOpen.push(existsSync(join(dst, LOCK)));
      }
      return (real.open as unknown as Fn)(...args);
    });
    fsMocks.rename.mockImplementation((...args: unknown[]) => {
      if (TEMP_OF(basename(String(args[0])))) {
        lockAtRename.push(existsSync(join(dst, LOCK)));
      }
      return (real.rename as unknown as Fn)(...args);
    });
    await importBundle(dst, bundle, { replace: true });
    expect(lockAtTempOpen).toEqual([false, false, false, false, false]);
    expect(lockAtRename).toEqual([true, true, true, true, true]);
  });

  test("a foreign fresh lock gives LOCK_TIMEOUT, replaces nothing and discards the staged temps", async () => {
    await seed(src);
    const { bundle } = await exportBundle(src, NOW);
    await seed(dst);
    writeFileSync(
      join(dst, LOCK),
      JSON.stringify({
        v: 1,
        pid: 424242,
        host: "h",
        token: "t",
        createdAt: 0,
      }),
    );
    const before = snapshot(dst);
    let t = Date.now();
    await expectCode(
      importBundle(
        dst,
        bundle,
        { replace: true },
        {
          lock: {
            timeoutMs: 50,
            now: () => t,
            sleep: (ms: number) => {
              t += ms;
              return Promise.resolve();
            },
          },
        },
      ),
      "LOCK_TIMEOUT",
    );
    expect(snapshot(dst)).toEqual(before);
    expect(readdirSync(dst).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  test("a staged temp that vanishes before its rename fails cleanly with WRITE_FAILED", async () => {
    await seed(src);
    const { bundle } = await exportBundle(src, NOW);
    await seed(dst);
    const oldState = readFileSync(join(dst, "state.json"), "utf8");
    let swept = false;
    fsMocks.rename.mockImplementation((...args: unknown[]) => {
      if (!swept && TEMP_OF(basename(String(args[0])))) {
        // Simulate a concurrent purge sweep removing the not-yet-renamed state temp.
        swept = true;
        for (const name of readdirSync(dst)) {
          if (name.startsWith(".state.json.") && name.endsWith(".tmp")) {
            rmSync(join(dst, name));
          }
        }
      }
      return (real.rename as unknown as Fn)(...args);
    });
    const error = await expectCode(
      importBundle(dst, bundle, { replace: true }),
      "WRITE_FAILED",
    );
    expect(swept).toBe(true);
    expect(error.message).toContain("state.json");
    expect(readFileSync(join(dst, "state.json"), "utf8")).toBe(oldState);
    expect(readdirSync(dst).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    expect(readdirSync(dst).filter((n) => n.startsWith(LOCK))).toEqual([]);
  });
});
