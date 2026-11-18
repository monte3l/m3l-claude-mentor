import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
  type Mock,
} from "vitest";
import { MentorStateError } from "../../src/internal/errors.ts";
import { LOCK_FILE_NAME, withStateLock } from "../../src/internal/lock.ts";

import type * as FsPromises0 from "node:fs/promises";
type FsPromises = typeof FsPromises0;
type Fn = (...args: unknown[]) => Promise<unknown>;

// The fs seam: every promise-fs primitive the lock uses is a pass-through
// spy by default (set in beforeEach) so a test can inject one failure while
// the rest of the filesystem stays real.
const fsMocks = vi.hoisted(() => ({
  open: vi.fn(),
  lstat: vi.fn(),
  mkdir: vi.fn(),
  rename: vi.fn(),
  unlink: vi.fn(),
  utimes: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<FsPromises>()),
  ...fsMocks,
}));

let real: FsPromises;
let root: string;
let dir: string;
let lockPath: string;

beforeEach(async () => {
  real = await vi.importActual<FsPromises>("node:fs/promises");
  for (const name of Object.keys(fsMocks) as (keyof typeof fsMocks)[]) {
    fsMocks[name].mockImplementation(real[name]);
  }
  root = realpathSync(mkdtempSync(join(tmpdir(), "lock-faults-")));
  dir = join(root, "data");
  mkdirSync(dir);
  lockPath = join(dir, LOCK_FILE_NAME);
});

afterEach(() => {
  for (const name of Object.keys(fsMocks) as (keyof typeof fsMocks)[]) {
    fsMocks[name].mockReset();
  }
  chmodSync(dir, 0o700);
  rmSync(root, { recursive: true, force: true });
});

function fsError(code: string): Error & { code: string } {
  return Object.assign(new Error(`${code}: injected`), { code });
}

function makeClock() {
  let t = Date.now();
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => t,
    sleep: (ms: number): Promise<void> => {
      sleeps.push(ms);
      t += ms;
      return Promise.resolve();
    },
  };
}

function seedOld(content = "{}"): void {
  writeFileSync(lockPath, content);
  const old = (Date.now() - 60_000) / 1000;
  utimesSync(lockPath, old, old);
}

function seedFresh(content = "{}"): void {
  writeFileSync(lockPath, content);
}

function leftovers(): string[] {
  return readdirSync(dir).filter((n) => n.startsWith(".state.lock"));
}

async function failure(p: Promise<unknown>): Promise<MentorStateError> {
  try {
    await p;
  } catch (error) {
    expect(error).toBeInstanceOf(MentorStateError);
    return error as MentorStateError;
  }
  throw new Error("expected a rejection");
}

/**
 * Wraps `open` so each handle of the chosen kind gets `patch` applied. The
 * create open uses the string flag "wx"; the release open uses numeric flags,
 * so the kind is decided by "wx" versus anything else. Returns a counter of
 * patched handles, so a test can prove its seam actually matched.
 */
function patchHandles(
  kind: "create" | "release",
  patch: (handle: FileHandle) => void,
): { patched: number } {
  const counter = { patched: 0 };
  fsMocks.open.mockImplementation(async (...args: unknown[]) => {
    const handle = (await (real.open as unknown as Fn)(...args)) as FileHandle;
    if ((args[1] === "wx") === (kind === "create")) {
      counter.patched += 1;
      patch(handle);
    }
    return handle;
  });
  return counter;
}

/** Makes `handle.close` really close, then throw; returns the spy. */
function failClose(
  handle: FileHandle,
  error: Error,
): Mock<() => Promise<void>> {
  const close = handle.close.bind(handle);
  const spy = vi.fn(async () => {
    await close();
    throw error;
  });
  handle.close = spy;
  return spy;
}

describe("breaking a stale lock", () => {
  test.each(["EROFS", "EACCES"])(
    "a rename failing with %s is WRITE_FAILED at once",
    async (code) => {
      seedOld();
      const cause = fsError(code);
      fsMocks.rename.mockRejectedValue(cause);
      const clock = makeClock();
      const err = await failure(
        withStateLock(dir, () => Promise.resolve(), {
          staleMs: 5000,
          now: clock.now,
          sleep: clock.sleep,
        }),
      );
      expect(fsMocks.rename).toHaveBeenCalledWith(lockPath, expect.any(String));
      expect(err.code).toBe("WRITE_FAILED");
      expect(err.cause).toBe(cause);
      expect(clock.sleeps).toEqual([]);
    },
  );

  test.each(["EPERM", "EBUSY"])(
    "a rename failing with %s is transient: waits, then LOCK_TIMEOUT carrying it as cause",
    async (code) => {
      seedOld();
      const cause = fsError(code);
      fsMocks.rename.mockRejectedValue(cause);
      const clock = makeClock();
      const err = await failure(
        withStateLock(dir, () => Promise.resolve(), {
          staleMs: 5000,
          timeoutMs: 300,
          now: clock.now,
          sleep: clock.sleep,
        }),
      );
      expect(fsMocks.rename).toHaveBeenCalled();
      expect(err.code).toBe("LOCK_TIMEOUT");
      expect(err.cause).toBe(cause);
      expect(err.message).not.toContain(dir);
      expect(clock.sleeps.length).toBeGreaterThan(0);
    },
  );

  test("a rename failing with ENOENT means another breaker won: retries at once", async () => {
    seedOld();
    fsMocks.rename.mockImplementationOnce(async () => {
      await real.unlink(lockPath);
      throw fsError("ENOENT");
    });
    const clock = makeClock();
    await expect(
      withStateLock(dir, () => Promise.resolve("ok"), {
        staleMs: 5000,
        now: clock.now,
        sleep: clock.sleep,
      }),
    ).resolves.toBe("ok");
    expect(fsMocks.rename).toHaveBeenCalledTimes(1); // the injected ENOENT ran
    expect(clock.sleeps).toEqual([]);
    expect(leftovers()).toEqual([]);
  });
});

describe("the retry path respects the deadline", () => {
  test("a lock that vanishes between create and lstat cannot loop past timeoutMs", async () => {
    let attempts = 0;
    fsMocks.open.mockImplementation(() => {
      attempts += 1;
      // Fail the test fast instead of spinning if the deadline is ignored.
      return Promise.reject(fsError(attempts > 500 ? "RUNAWAY" : "EEXIST"));
    });
    fsMocks.lstat.mockRejectedValue(fsError("ENOENT"));
    let t = Date.now();
    const err = await failure(
      withStateLock(dir, () => Promise.resolve(), {
        timeoutMs: 1000,
        now: () => {
          t += 50;
          return t;
        },
        sleep: () => Promise.resolve(),
      }),
    );
    expect(attempts).toBeGreaterThan(1); // the EEXIST seam was hit repeatedly
    expect(attempts).toBeLessThanOrEqual(500);
    expect(fsMocks.lstat).toHaveBeenCalled();
    expect(err.code).toBe("LOCK_TIMEOUT");
  });
});

describe("release", () => {
  test("still removes our lock when closing the read handle throws; result unchanged", async () => {
    let closeSpy: Mock<() => Promise<void>> | undefined;
    const counter = patchHandles("release", (h) => {
      closeSpy = failClose(h, fsError("EIO"));
    });
    await expect(
      withStateLock(dir, () => Promise.resolve("result")),
    ).resolves.toBe("result");
    expect(counter.patched).toBe(1);
    expect(closeSpy).toHaveBeenCalled();
    expect(leftovers()).toEqual([]);
  });

  test("still removes our lock when closing the read handle throws; fn's error unchanged", async () => {
    let closeSpy: Mock<() => Promise<void>> | undefined;
    const counter = patchHandles("release", (h) => {
      closeSpy = failClose(h, fsError("EIO"));
    });
    const boom = new Error("fn failed");
    await expect(withStateLock(dir, () => Promise.reject(boom))).rejects.toBe(
      boom,
    );
    expect(counter.patched).toBe(1);
    expect(closeSpy).toHaveBeenCalled();
    expect(leftovers()).toEqual([]);
  });

  test("swallows an open failure on release; result and error unchanged", async () => {
    let releaseOpens = 0;
    fsMocks.open.mockImplementation((...args: unknown[]) => {
      if (args[1] === "wx") return (real.open as unknown as Fn)(...args);
      releaseOpens += 1;
      return Promise.reject(fsError("EIO"));
    });
    await expect(withStateLock(dir, () => Promise.resolve(7))).resolves.toBe(7);
    expect(releaseOpens).toBe(1);
    const boom = new Error("fn failed");
    seedOld(); // clear the lock left behind by the failed release
    await expect(withStateLock(dir, () => Promise.reject(boom))).rejects.toBe(
      boom,
    );
    expect(releaseOpens).toBe(2);
  });

  test("swallows a read failure on release; result unchanged", async () => {
    const readSpy = vi.fn(() => Promise.reject(fsError("EIO")));
    const counter = patchHandles("release", (h) => {
      h.read = readSpy;
    });
    await expect(
      withStateLock(dir, () => Promise.resolve("result")),
    ).resolves.toBe("result");
    expect(counter.patched).toBe(1);
    expect(readSpy).toHaveBeenCalled();
  });

  test("swallows an unlink failure on release; result and error unchanged", async () => {
    fsMocks.unlink.mockRejectedValue(fsError("EIO"));
    await expect(
      withStateLock(dir, () => Promise.resolve("result")),
    ).resolves.toBe("result");
    expect(fsMocks.unlink).toHaveBeenCalledTimes(1);
    expect(fsMocks.unlink).toHaveBeenCalledWith(lockPath);
    const boom = new Error("fn failed");
    seedOld();
    await expect(withStateLock(dir, () => Promise.reject(boom))).rejects.toBe(
      boom,
    );
    expect(
      fsMocks.unlink.mock.calls.filter((c) => c[0] === lockPath),
    ).toHaveLength(2);
  });
});

describe("create and setup failures", () => {
  test("a mkdir failure is WRITE_FAILED with the cause", async () => {
    const cause = fsError("EACCES");
    fsMocks.mkdir.mockRejectedValue(cause);
    const err = await failure(withStateLock(dir, () => Promise.resolve()));
    expect(fsMocks.mkdir).toHaveBeenCalled();
    expect(err.code).toBe("WRITE_FAILED");
    expect(err.cause).toBe(cause);
  });

  test.each(["write", "close", "utimes"])(
    "a %s failure after the create removes the half-made lock and is WRITE_FAILED",
    async (step) => {
      const cause = fsError("EIO");
      const injected = vi.fn();
      if (step === "write") {
        patchHandles("create", (h) => {
          injected.mockRejectedValue(cause);
          h.writeFile = injected;
        });
      } else if (step === "close") {
        patchHandles("create", (h) => {
          const spy = failClose(h, cause);
          injected.mockImplementation(spy);
          h.close = injected;
        });
      } else {
        fsMocks.utimes.mockRejectedValue(cause);
      }
      const err = await failure(withStateLock(dir, () => Promise.resolve()));
      if (step === "utimes") expect(fsMocks.utimes).toHaveBeenCalled();
      else expect(injected).toHaveBeenCalled();
      expect(err.code).toBe("WRITE_FAILED");
      expect(err.cause).toBe(cause);
      expect(fsMocks.unlink).toHaveBeenCalledWith(lockPath);
      expect(existsSync(lockPath)).toBe(false);
    },
  );

  test("a non-ENOENT lstat failure after an EEXIST create is WRITE_FAILED at once", async () => {
    seedFresh();
    const cause = fsError("EIO");
    fsMocks.lstat.mockRejectedValue(cause);
    const clock = makeClock();
    const err = await failure(
      withStateLock(dir, () => Promise.resolve(), {
        now: clock.now,
        sleep: clock.sleep,
      }),
    );
    expect(fsMocks.lstat).toHaveBeenCalledWith(lockPath);
    expect(err.code).toBe("WRITE_FAILED");
    expect(err.cause).toBe(cause);
    expect(clock.sleeps).toEqual([]);
  });

  test("the dir vanishing after mkdir (open ENOENT) is WRITE_FAILED at once", async () => {
    const cause = fsError("ENOENT");
    fsMocks.open.mockRejectedValue(cause);
    const clock = makeClock();
    const err = await failure(
      withStateLock(dir, () => Promise.resolve(), {
        now: clock.now,
        sleep: clock.sleep,
      }),
    );
    expect(err.code).toBe("WRITE_FAILED");
    expect(err.cause).toBe(cause);
    expect(clock.sleeps).toEqual([]);
    expect(fsMocks.open).toHaveBeenCalled();
  });
});
