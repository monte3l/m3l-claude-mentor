/**
 * A cross-process advisory lock on the mentor's data directory, so a
 * read-modify-write of the state files by one process (a hook, a CLI
 * command) cannot interleave with another's and lose an update.
 *
 * The lock is a file, `<dir>/.state.lock`, created exclusively (flag `wx`).
 * Its JSON content (`v`, `pid`, `host`, `token`, `createdAt`) is for diagnosis
 * and for recognizing our own lock on release; `createdAt` is the time of the
 * creation attempt that succeeded. Staleness is judged by the lock's `lstat`
 * mtime only, never by its content, so a garbage or empty lock file is simply
 * "held" until it is old enough to break. There is no pid-liveness check: a
 * lock older than the stale threshold is broken whoever holds it.
 *
 * Staleness compares the file's mtime with the local clock, so it is best
 * effort on a network filesystem (NFS, SMB): a clock skew between client and
 * server of more than the stale threshold can make a live lock look stale
 * (and be broken) or a dead one look fresh for longer.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  rename,
  unlink,
  utimes,
  type FileHandle,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { MentorStateError } from "./errors.ts";
import { assertValidDataDir } from "./paths.ts";

/**
 * The lock file's name inside the data directory.
 *
 * @example
 * ```ts
 * import path from "node:path";
 * import { LOCK_FILE_NAME } from "./lock.ts";
 * path.join("/var/data/m3l", LOCK_FILE_NAME); // "/var/data/m3l/.state.lock"
 * ```
 */
export const LOCK_FILE_NAME = ".state.lock";

/**
 * The default time a caller waits for the lock, in milliseconds (2 s): short,
 * because a hook must never hold up the learner for long.
 *
 * @example
 * ```ts
 * import { LOCK_TIMEOUT_MS, withStateLock } from "./lock.ts";
 * await withStateLock("/var/data/m3l", async () => {}, { timeoutMs: LOCK_TIMEOUT_MS });
 * ```
 */
export const LOCK_TIMEOUT_MS = 2000;

/**
 * The time a CLI command waits for the lock, in milliseconds (6 s). It is
 * longer than {@link LOCK_STALE_MS}, so a command blocked by a lock left by a
 * crashed process outlives it and breaks it instead of timing out.
 *
 * @example
 * ```ts
 * import { CLI_LOCK_TIMEOUT_MS, withStateLock } from "./lock.ts";
 * await withStateLock("/var/data/m3l", async () => {}, { timeoutMs: CLI_LOCK_TIMEOUT_MS });
 * ```
 */
export const CLI_LOCK_TIMEOUT_MS = 6000;

/**
 * The default age, in milliseconds (5 s), at which a lock file counts as
 * abandoned and is broken.
 *
 * @example
 * ```ts
 * import { LOCK_STALE_MS, withStateLock } from "./lock.ts";
 * await withStateLock("/var/data/m3l", async () => {}, { staleMs: LOCK_STALE_MS });
 * ```
 */
export const LOCK_STALE_MS = 5000;

/**
 * Tuning and test seams for {@link withStateLock}. Every field is optional.
 *
 * @example
 * ```ts
 * import { CLI_LOCK_TIMEOUT_MS, type LockOptions } from "./lock.ts";
 * const options: LockOptions = { timeoutMs: CLI_LOCK_TIMEOUT_MS };
 * ```
 */
export interface LockOptions {
  /** How long to wait for the lock, in ms of `now`'s clock; positive. Default {@link LOCK_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /** The lock-file age at which it is broken, in ms; positive. Default {@link LOCK_STALE_MS}. */
  readonly staleMs?: number;
  /**
   * The clock, in epoch ms; it must not run backwards (a step back stretches
   * the wait past `timeoutMs`). Default `Date.now`.
   */
  readonly now?: () => number;
  /** Waits `ms` milliseconds between attempts. Default a `setTimeout` promise. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** A number in `[0, 1)` used for backoff jitter. Default `Math.random`. */
  readonly random?: () => number;
}

/**
 * The trailing options argument of a function that takes the data lock
 * itself (import, purge): `lock` is forwarded to {@link withStateLock}. Real
 * callers pass nothing, or a CLI timeout.
 *
 * @example
 * ```ts
 * import { CLI_LOCK_TIMEOUT_MS, type LockedOptions } from "./lock.ts";
 * const options: LockedOptions = { lock: { timeoutMs: CLI_LOCK_TIMEOUT_MS } };
 * ```
 */
export interface LockedOptions {
  /** Lock tuning forwarded to {@link withStateLock}. */
  readonly lock?: LockOptions;
}

interface Timing {
  readonly timeoutMs: number;
  readonly staleMs: number;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly random: () => number;
}

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const BACKOFF_BASE_MS = 25;
const BACKOFF_CAP_MS = 200;
/** fs error codes that may mean "someone holds the lock" on some platforms. */
const BUSY_CODES: ReadonlySet<unknown> = new Set(["EPERM", "EBUSY", "EACCES"]);
const TIMEOUT_MESSAGE = "the mentor data directory is busy; try again";
const CREATE_FAILED_MESSAGE = "could not create the data lock";

/** The resolved data directories the current async context holds. */
const heldDirs = new AsyncLocalStorage<ReadonlySet<string>>();

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code
    : undefined;
}

function createFailed(cause: unknown): MentorStateError {
  return new MentorStateError("WRITE_FAILED", CREATE_FAILED_MESSAGE, {
    cause,
  });
}

function positive(value: number | undefined, fallback: number, name: string) {
  const resolved = value ?? fallback;
  if (!(resolved > 0) || !Number.isFinite(resolved)) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
  return resolved;
}

/**
 * Best-effort removal on a path that is already settled (a broken stale lock
 * moved aside, our own lock after a failed write, our lock on release). An
 * unlink error is dropped on purpose: it must never replace the caller's
 * primary outcome, and a leftover file is swept by purge.
 */
async function unlinkQuietly(target: string): Promise<void> {
  try {
    await unlink(target);
  } catch {
    // Best effort only; see the doc comment above.
  }
}

/**
 * Writes `content` into a freshly created lock and closes it. A write error
 * closes the handle best effort (a close error there is dropped on purpose so
 * it cannot replace the write error) and rethrows the write error.
 */
async function writeAndClose(
  handle: FileHandle,
  content: string,
): Promise<void> {
  try {
    await handle.writeFile(content, "utf8");
  } catch (error) {
    try {
      await handle.close();
    } catch {
      // Best effort; the write error rethrown below is the primary one.
    }
    throw error;
  }
  await handle.close();
}

/**
 * Creates the lock file holding `content`, with its mtime set to `nowMs`.
 *
 * @returns `null` once created, or the raw error from the exclusive create
 * (EEXIST and friends) for the caller to classify.
 * @throws MentorStateError `WRITE_FAILED` when a step after the create fails;
 * the half-made lock is then removed (best effort) first.
 */
async function tryCreate(
  lockPath: string,
  content: string,
  nowMs: number,
): Promise<{ readonly openError: unknown } | null> {
  let handle: FileHandle;
  try {
    handle = await open(lockPath, "wx", FILE_MODE);
  } catch (openError) {
    return { openError };
  }
  try {
    await writeAndClose(handle, content);
    const seconds = nowMs / 1000;
    await utimes(lockPath, seconds, seconds);
  } catch (cause) {
    await unlinkQuietly(lockPath);
    throw createFailed(cause);
  }
  return null;
}

/** The lock file's age in ms by its lstat mtime, never below 0 (a future mtime is fresh). */
async function lockAge(lockPath: string, nowMs: number): Promise<number> {
  const { mtimeMs } = await lstat(lockPath);
  return Math.max(0, nowMs - mtimeMs);
}

/** Rename errors that mean the directory cannot be changed: waiting will not help. */
const PERMANENT_RENAME_CODES: ReadonlySet<unknown> = new Set([
  "EROFS",
  "EACCES",
]);

/** What one acquisition attempt concluded. */
type Attempt =
  | { readonly kind: "acquired" }
  | { readonly kind: "retry" }
  | { readonly kind: "wait"; readonly cause?: unknown };

const ACQUIRED: Attempt = { kind: "acquired" };
const RETRY: Attempt = { kind: "retry" };
const WAIT: Attempt = { kind: "wait" };

/**
 * Atomically moves a stale lock aside, then removes it (best effort). Only
 * one of several concurrent breakers wins the rename; a loser gets ENOENT and
 * retries at once. `EROFS`/`EACCES` mean the directory cannot be changed and
 * throw `WRITE_FAILED`; any other rename error is treated as transient and
 * returned as a wait carrying it, so a later `LOCK_TIMEOUT` can explain itself.
 *
 * Residual race, accepted: between one breaker's age check and its rename,
 * a second breaker can rename the stale lock and create a fresh one, which
 * the first then moves aside. The window spans several filesystem round
 * trips (longer under load or a GC pause), and opens only once a holder has
 * been gone for the whole stale period. Its consequence is a brief overlap
 * of two holders, which degrades to the last-writer-wins behaviour the
 * mentor had before this lock. It is deliberately not closed: an inode check
 * plus a link-back restore would add races of its own.
 */
async function breakStale(
  dir: string,
  lockPath: string,
  token: string,
): Promise<Attempt> {
  const grave = path.join(dir, `${LOCK_FILE_NAME}.stale.${token}`);
  try {
    await rename(lockPath, grave);
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") return RETRY;
    if (PERMANENT_RENAME_CODES.has(code)) throw createFailed(error);
    return { kind: "wait", cause: error };
  }
  await unlinkQuietly(grave);
  return RETRY;
}

/** The lock file's JSON content for one creation attempt made at `nowMs`. */
function lockContent(token: string, nowMs: number): string {
  return JSON.stringify({
    v: 1,
    pid: process.pid,
    host: hostname(),
    token,
    createdAt: new Date(nowMs).toISOString(),
  });
}

/**
 * One acquisition attempt: create the lock holding `content`, or judge the
 * existing one.
 */
async function attempt(
  dir: string,
  lockPath: string,
  token: string,
  content: string,
  timing: Timing,
): Promise<Attempt> {
  const failed = await tryCreate(lockPath, content, timing.now());
  if (failed === null) return ACQUIRED;
  const code = errorCode(failed.openError);
  // EEXIST: held. EPERM/EBUSY/EACCES: held, or an unwritable dir (below).
  if (code !== "EEXIST" && !BUSY_CODES.has(code)) {
    throw createFailed(failed.openError);
  }
  const busyCause = code === "EEXIST" ? undefined : failed.openError;
  let age: number;
  try {
    age = await lockAge(lockPath, timing.now());
  } catch (error) {
    // No lock file: a busy-looking create error means an unwritable dir,
    // which waiting will not fix; otherwise the holder just released.
    if (busyCause !== undefined) throw createFailed(busyCause);
    if (errorCode(error) === "ENOENT") return RETRY;
    throw createFailed(error);
  }
  if (age < timing.staleMs) return WAIT;
  return breakStale(dir, lockPath, token);
}

function timedOut(cause: unknown): MentorStateError {
  return new MentorStateError(
    "LOCK_TIMEOUT",
    TIMEOUT_MESSAGE,
    cause === undefined ? undefined : { cause },
  );
}

/**
 * Acquires the lock file, returning the exact content we wrote into it. Both
 * a wait and an immediate retry check the deadline first, so churn (a lock
 * that keeps vanishing and reappearing) cannot overrun `timeoutMs`.
 */
async function acquire(
  dir: string,
  lockPath: string,
  timing: Timing,
): Promise<string> {
  const token = randomUUID();
  try {
    await mkdir(dir, { recursive: true, mode: DIR_MODE });
  } catch (cause) {
    throw createFailed(cause);
  }
  const deadline = timing.now() + timing.timeoutMs;
  let waits = 0;
  let lastCause: unknown;
  for (;;) {
    const content = lockContent(token, timing.now());
    const outcome = await attempt(dir, lockPath, token, content, timing);
    if (outcome.kind === "acquired") return content;
    if (outcome.kind === "wait" && outcome.cause !== undefined) {
      lastCause = outcome.cause;
    }
    const remaining = deadline - timing.now();
    if (remaining <= 0) throw timedOut(lastCause);
    if (outcome.kind === "retry") continue;
    const base = Math.min(BACKOFF_BASE_MS * 2 ** waits, BACKOFF_CAP_MS);
    waits += 1;
    await timing.sleep(Math.min(base * (0.5 + timing.random() / 2), remaining));
  }
}

/**
 * Release opens the lock read-only without following a symlink and without
 * blocking on a FIFO planted at the lock path.
 */
const RELEASE_OPEN_FLAGS =
  fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;

/** Reads up to `length` bytes from the start of `lockPath`; the close is best effort. */
async function readLockPrefix(
  lockPath: string,
  length: number,
): Promise<Buffer> {
  const handle = await open(lockPath, RELEASE_OPEN_FLAGS);
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    try {
      await handle.close();
    } catch {
      // The bytes are already read; a close error does not change whose
      // lock this is, so release still decides on them.
    }
  }
}

/**
 * Removes the lock file only when it still holds exactly what we wrote, so a
 * lock that was broken as stale and re-taken by another process is normally
 * left alone. The read and the unlink are two steps, not one atomic check: a
 * holder that overran `staleMs` can, in that gap, delete a successor's fresh
 * lock, which degrades to the old last-writer-wins. Every error is dropped on
 * purpose: release runs in a `finally` and must never mask `fn`'s result or
 * error; a lock we fail to remove simply goes stale and is broken later.
 */
async function release(lockPath: string, content: string): Promise<void> {
  try {
    const expected = Buffer.from(content, "utf8");
    const found = await readLockPrefix(lockPath, expected.length + 1);
    if (found.equals(expected)) await unlink(lockPath);
  } catch {
    // Best effort; see the doc comment above.
  }
}

/**
 * Runs `fn` while holding the data directory's lock, so that a whole
 * read-modify-write of the state files is exclusive across processes. The
 * store primitives (`loadX`/`saveX`, `writeTextAtomic`, `appendLineAtomic`)
 * never lock; their callers wrap the load-compute-save in this.
 *
 * Creates `dir` if needed (mode `0o700`), then creates `<dir>/.state.lock`
 * exclusively (mode `0o600`). While another holder's lock exists the call
 * waits with jittered exponential backoff (`min(25 * 2^n, 200)` ms, scaled by
 * a factor in `[0.5, 1]`) until `timeoutMs` of the `now` clock has elapsed. A
 * lock whose lstat mtime is at least `staleMs` old is broken at once (an mtime
 * in the future counts as fresh). On return or throw the lock is removed if it
 * is still ours; release failures are swallowed.
 *
 * `fn` must stay well under `staleMs`: past that another process may break
 * the lock and run concurrently, and nothing reports it; the overrunning
 * holder's release can then even remove its successor's lock (see the
 * release notes in the source), degrading to last-writer-wins. The lock is not
 * re-entrant: a nested call for the same directory (by resolved path, so a
 * symlinked alias is not detected) in the same async context is a
 * programming error and throws at once. A different directory nests fine, and
 * independent async contexts in one process contend through the file. The
 * "held" marker follows async context, not time: a fire-and-forget task
 * started inside `fn` keeps it after `fn` returns, so a later
 * `withStateLock(dir)` from that task throws the re-entrancy error.
 *
 * @param dir - The data directory, an absolute path.
 * @param fn - The critical section; its result and error pass through
 * unchanged.
 * @param options - See {@link LockOptions}.
 * @returns What `fn` resolves to.
 * @throws MentorStateError `DATA_DIR_INVALID` (before any other check or
 * I/O) when `dir` fails {@link assertValidDataDir}.
 * @throws RangeError when `timeoutMs` or `staleMs` is not positive and finite.
 * @throws Error (plain) for a nested call on a directory this context holds.
 * @throws MentorStateError `LOCK_TIMEOUT` (fixed message) when the lock stays
 * held past `timeoutMs`; its `cause` is the last transient error from
 * breaking a stale lock, when there was one. `WRITE_FAILED` (fixed message,
 * fs error as `cause`) at once when the directory or lock file cannot be
 * created: any create error other than `EEXIST`, except
 * `EPERM`/`EBUSY`/`EACCES` while a lock file exists, which are waited on
 * like a held lock; and when a stale lock cannot be moved aside because the
 * directory is read-only or not writable (`EROFS`/`EACCES`).
 *
 * @example
 * ```ts
 * import { CLI_LOCK_TIMEOUT_MS, withStateLock } from "./lock.ts";
 * import { writeTextAtomic } from "./fs-atomic.ts";
 * await withStateLock(
 *   "/var/data/m3l",
 *   async () => {
 *     await writeTextAtomic("/var/data/m3l", "goals", "Learn hooks\n");
 *   },
 *   { timeoutMs: CLI_LOCK_TIMEOUT_MS },
 * );
 * ```
 */
export async function withStateLock<T>(
  dir: string,
  fn: () => Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  assertValidDataDir(dir);
  const timing: Timing = {
    timeoutMs: positive(options.timeoutMs, LOCK_TIMEOUT_MS, "timeoutMs"),
    staleMs: positive(options.staleMs, LOCK_STALE_MS, "staleMs"),
    now: options.now ?? Date.now,
    sleep: options.sleep ?? ((ms: number) => delay(ms)),
    random: options.random ?? Math.random,
  };
  const key = path.resolve(dir);
  const held = heldDirs.getStore() ?? new Set<string>();
  if (held.has(key)) {
    throw new Error(
      "withStateLock is not re-entrant: this context already holds the lock for this directory",
    );
  }
  const lockPath = path.join(dir, LOCK_FILE_NAME);
  const content = await acquire(dir, lockPath, timing);
  try {
    return await heldDirs.run(new Set([...held, key]), fn);
  } finally {
    await release(lockPath, content);
  }
}
