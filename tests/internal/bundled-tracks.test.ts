import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { loadBundledTracks } from "../../src/internal/bundled-tracks.ts";
import { MentorStateError } from "../../src/internal/errors.ts";
import { REMOVE, mutated, validTrack } from "./fixtures/track.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function sandbox(files: Record<string, string>): URL {
  const dir = mkdtempSync(join(tmpdir(), "tracks "));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), body);
  }
  return pathToFileURL(`${dir}/`);
}

const json = (t: unknown): string => JSON.stringify(t);

/** A track with `code` that assumes `assumes` (or nothing). */
const track = (code: string, assumes: string | null): string =>
  json(
    mutated([["code"], code], [["assumes"], assumes], [["scenarios"], REMOVE]),
  );

/** Captures the error thrown by a synchronous loader call. */
function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

function expectCode(thrown: unknown, code: string): MentorStateError {
  expect(thrown).toBeInstanceOf(MentorStateError);
  expect((thrown as MentorStateError).code).toBe(code);
  return thrown as MentorStateError;
}

describe("loadBundledTracks", () => {
  test("loads every *.json in sorted order, ignoring other files", () => {
    const dir = sandbox({
      "z.json": track("CCAR-P", "CCAR-F"),
      "a.json": json(validTrack()),
      "notes.txt": "ignored",
    });
    expect(loadBundledTracks(dir).map((t) => t.code)).toEqual([
      "CCAR-F",
      "CCAR-P",
    ]);
  });

  test("a missing directory returns []", () => {
    const dir = pathToFileURL(join(tmpdir(), "tracks-missing-xyz", "/"));
    expect(loadBundledTracks(dir)).toEqual([]);
  });

  test("an empty directory returns []", () => {
    expect(loadBundledTracks(sandbox({}))).toEqual([]);
  });

  test("a malformed JSON file throws PARSE_FAILED naming the file", () => {
    const dir = sandbox({ "broken.json": "{ not json" });
    const err = expectCode(
      thrownBy(() => loadBundledTracks(dir)),
      "PARSE_FAILED",
    );
    expect(err.message).toContain("broken.json");
  });

  test("an invalid track throws VALIDATION_FAILED naming the file", () => {
    const dir = sandbox({ "bad.json": json(mutated([["code"], "nope"])) });
    const err = expectCode(
      thrownBy(() => loadBundledTracks(dir)),
      "VALIDATION_FAILED",
    );
    expect(err.message).toContain("bad.json");
  });

  test("an oversize file (over 1 MiB) throws TOO_LARGE naming the file", () => {
    const dir = sandbox({ "huge.json": json({ pad: "x".repeat(1_048_576) }) });
    const err = expectCode(
      thrownBy(() => loadBundledTracks(dir)),
      "TOO_LARGE",
    );
    expect(err.message).toContain("huge.json");
  });

  test("duplicate codes across files throw VALIDATION_FAILED naming the code", () => {
    const dir = sandbox({
      "one.json": json(validTrack()),
      "two.json": json(validTrack()),
    });
    const err = expectCode(
      thrownBy(() => loadBundledTracks(dir)),
      "VALIDATION_FAILED",
    );
    expect(err.message).toContain("CCAR-F");
  });

  test("a directory path that is a regular file throws READ_FAILED with a cause", () => {
    const dir = sandbox({ "plain.txt": "x" });
    const asFile = new URL(`${dir.href}plain.txt/`);
    const err = expectCode(
      thrownBy(() => loadBundledTracks(asFile)),
      "READ_FAILED",
    );
    expect(err.cause).toBeInstanceOf(Error);
  });

  test("an unreadable track file throws READ_FAILED naming the file", (ctx) => {
    const dir = sandbox({ "locked.json": json(validTrack()) });
    chmodSync(join(fileURLToPath(dir), "locked.json"), 0o000);
    const thrown = thrownBy(() => loadBundledTracks(dir));
    if (thrown === undefined) {
      // Running as root (or a filesystem ignoring modes): the read succeeds.
      ctx.skip();
      return;
    }
    const err = expectCode(thrown, "READ_FAILED");
    expect(err.message).toContain("locked.json");
    expect(err.cause).toBeInstanceOf(Error);
  });
});

describe("loadBundledTracks directory entries", () => {
  test("a directory named *.json throws VALIDATION_FAILED naming its base name", () => {
    const dir = sandbox({ "a.json": json(validTrack()) });
    mkdirSync(join(fileURLToPath(dir), "sub.json"));
    const err = expectCode(
      thrownBy(() => loadBundledTracks(dir)),
      "VALIDATION_FAILED",
    );
    expect(err.message).toContain("sub.json");
  });

  test("a symlink to a json file throws VALIDATION_FAILED naming its base name", () => {
    const dir = sandbox({ "real.json": json(validTrack()) });
    const root = fileURLToPath(dir);
    symlinkSync(join(root, "real.json"), join(root, "link.json"));
    const err = expectCode(
      thrownBy(() => loadBundledTracks(dir)),
      "VALIDATION_FAILED",
    );
    expect(err.message).toContain("link.json");
  });

  test("a directory not ending in .json is ignored", () => {
    const dir = sandbox({ "a.json": json(validTrack()) });
    mkdirSync(join(fileURLToPath(dir), "sub.d"));
    expect(loadBundledTracks(dir)).toHaveLength(1);
  });
});

describe("loadBundledTracks assumes", () => {
  const failsNaming = (files: Record<string, string>, code: string): void => {
    const err = expectCode(
      thrownBy(() => loadBundledTracks(sandbox(files))),
      "VALIDATION_FAILED",
    );
    expect(err.message).toContain(code);
  };

  test("an assumes code matching no loaded track throws naming it", () => {
    failsNaming({ "p.json": track("CCAR-P", "CCAR-F") }, "CCAR-F");
  });

  test("a two-track cycle throws naming a code in the cycle", () => {
    const dir = sandbox({
      "a.json": track("AA-A", "BB-B"),
      "b.json": track("BB-B", "AA-A"),
    });
    const err = expectCode(
      thrownBy(() => loadBundledTracks(dir)),
      "VALIDATION_FAILED",
    );
    expect(err.message).toMatch(/AA-A|BB-B/);
    expect(err.message).toContain("cycle");
  });

  test("a chain that leads into a cycle throws naming a cycle member", () => {
    // TT-T -> AA-A -> BB-B -> AA-A: the tail is not itself in the cycle.
    const dir = sandbox({
      "a.json": track("AA-A", "BB-B"),
      "b.json": track("BB-B", "AA-A"),
      "t.json": track("TT-T", "AA-A"),
    });
    const err = expectCode(
      thrownBy(() => loadBundledTracks(dir)),
      "VALIDATION_FAILED",
    );
    expect(err.message).toMatch(/AA-A|BB-B/);
    expect(err.message).not.toContain("TT-T");
  });

  test("a valid chain loads", () => {
    const dir = sandbox({
      "a.json": track("AA-A", null),
      "b.json": track("BB-B", "AA-A"),
      "c.json": track("CC-C", "BB-B"),
    });
    expect(loadBundledTracks(dir).map((t) => t.code)).toEqual([
      "AA-A",
      "BB-B",
      "CC-C",
    ]);
  });
});
