/**
 * Loads the certification exam tracks that ship with the plugin
 * (`data/tracks/<code>.json`), and checks the rules that span files: unique
 * codes, and `assumes` naming a loaded track without forming a cycle.
 */
import {
  closeSync,
  openSync,
  readSync,
  readdirSync,
  type Dirent,
} from "node:fs";
import { MentorStateError } from "./errors.ts";
import { parseTrack, type Track } from "./tracks.ts";

/** The largest track file accepted, in bytes. */
const MAX_TRACK_BYTES = 1_048_576;

/**
 * Reads at most `MAX_TRACK_BYTES + 1` bytes of `source`, so a file over the
 * limit is detected without reading it whole. The whole open/read/close
 * lifecycle is under one catch; a failing close on the error path is dropped
 * so it cannot replace the primary error.
 */
function readBoundedSync(source: URL, name: string): Buffer {
  const buffer = Buffer.alloc(MAX_TRACK_BYTES + 1);
  let fd: number | undefined;
  let total = 0;
  try {
    fd = openSync(source, "r");
    while (total < buffer.length) {
      const bytesRead = readSync(
        fd,
        buffer,
        total,
        buffer.length - total,
        total,
      );
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    const opened = fd;
    fd = undefined;
    closeSync(opened);
  } catch (cause) {
    throw new MentorStateError("READ_FAILED", `could not read track ${name}`, {
      cause,
    });
  } finally {
    try {
      if (fd !== undefined) closeSync(fd);
    } catch {
      // Best effort only; the read failure above is the error that matters.
    }
  }
  return buffer.subarray(0, total);
}

/** Reads, size-checks, JSON-parses and validates one track file. */
function loadTrackFile(source: URL, name: string): Track {
  const bytes = readBoundedSync(source, name);
  if (bytes.length > MAX_TRACK_BYTES) {
    throw new MentorStateError(
      "TOO_LARGE",
      `track ${name} is larger than ${String(MAX_TRACK_BYTES)} bytes`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch {
    // No cause: a SyntaxError message embeds a snippet of the file text.
    throw new MentorStateError(
      "PARSE_FAILED",
      `track ${name} is not valid JSON`,
    );
  }
  const parsed = parseTrack(raw);
  if (!parsed.ok) {
    throw new MentorStateError(
      "VALIDATION_FAILED",
      `track ${name} is invalid: ${parsed.reason}`,
    );
  }
  return parsed.value;
}

/**
 * The `*.json` file names in `dir`, sorted; `[]` when `dir` is missing.
 * Entries not ending in `.json` are ignored; a `*.json` entry that is not a
 * regular file (a symlink, a directory, ...) is rejected rather than skipped,
 * so a misplaced track never silently disappears.
 */
function listTrackFiles(dir: URL): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (cause) {
    if (
      cause instanceof Error &&
      (cause as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return [];
    }
    throw new MentorStateError("READ_FAILED", "could not list bundled tracks", {
      cause,
    });
  }
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith(".json")) continue;
    if (!entry.isFile()) {
      throw new MentorStateError(
        "VALIDATION_FAILED",
        `track ${entry.name} is not a regular file`,
      );
    }
    names.push(entry.name);
  }
  return names.sort();
}

/**
 * Rejects an `assumes` naming no loaded track, then an `assumes` chain that
 * loops back on itself. Each track assumes at most one other, so following
 * the chain from every track finds every cycle.
 */
function checkAssumes(tracks: readonly Track[]): void {
  const byCode = new Map(tracks.map((track) => [track.code, track]));
  for (const track of tracks) {
    if (track.assumes !== null && !byCode.has(track.assumes)) {
      throw new MentorStateError(
        "VALIDATION_FAILED",
        `track ${track.code} assumes unknown track ${track.assumes}`,
      );
    }
  }
  for (const track of tracks) {
    const visited = new Set<string>();
    let current: Track | undefined = track;
    while (current !== undefined && current.assumes !== null) {
      if (visited.has(current.code)) {
        throw new MentorStateError(
          "VALIDATION_FAILED",
          `track ${current.code} is part of an assumes cycle`,
        );
      }
      visited.add(current.code);
      current = byCode.get(current.assumes);
    }
  }
}

/**
 * Loads and validates every bundled track. By default it reads each `*.json`
 * file in `data/tracks/`, located relative to this module (the plugin keeps
 * `data/` next to `src/`), in file-name order. Entries not ending in `.json`
 * are ignored. A missing directory yields `[]`. Nothing is cached: each call
 * reads the files again.
 *
 * Synchronous, unlike `loadBundledCatalog`, because the track set is small
 * and consumers need it as a plain array.
 *
 * @param dir - A `file:` URL of the directory to read, with a trailing `/`;
 * defaults to the bundled `data/tracks/`.
 * @returns The validated tracks, in file-name order.
 * @throws MentorStateError naming the file (base name only): `READ_FAILED`
 * (fs error as `cause`) when it or the directory cannot be read;
 * `TOO_LARGE` when a file exceeds 1 MiB; `PARSE_FAILED` (fixed message, no
 * `cause`) when it is not JSON; `VALIDATION_FAILED` when a `*.json` entry is
 * not a regular file, when it is not a valid track, when two files share a
 * code, when `assumes` names a code no loaded track has, or when `assumes`
 * links form a cycle.
 *
 * @example
 * ```ts
 * import { loadBundledTracks } from "./bundled-tracks.ts";
 * const tracks = loadBundledTracks();
 * const foundations = tracks.filter((track) => track.tier === "foundations");
 * ```
 */
export function loadBundledTracks(
  dir: URL = new URL("../../data/tracks/", import.meta.url),
): Track[] {
  const tracks: Track[] = [];
  const codes = new Set<string>();
  for (const name of listTrackFiles(dir)) {
    const track = loadTrackFile(new URL(encodeURIComponent(name), dir), name);
    if (codes.has(track.code)) {
      throw new MentorStateError(
        "VALIDATION_FAILED",
        `track ${name} reuses code ${track.code}`,
      );
    }
    codes.add(track.code);
    tracks.push(track);
  }
  checkAssumes(tracks);
  return tracks;
}
