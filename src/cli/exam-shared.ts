import { loadBundledTracks } from "../internal/bundled-tracks.ts";
import { MentorStateError } from "../internal/errors.ts";
import { TRACK_CODE_PATTERN } from "../internal/track-ids.ts";
import type { Track } from "../internal/tracks.ts";
import { CliUsageError, requireValue, type ParsedArgs } from "./args.ts";

/**
 * The bundled track with `code`.
 *
 * @throws MentorStateError `VALIDATION_FAILED` (a fixed message; the code is
 * not echoed) when no bundled track has that code; whatever
 * `loadBundledTracks` throws, unchanged.
 *
 * @example
 * ```ts
 * import { findBundledTrack } from "./exam-shared.ts";
 * const track = findBundledTrack("CCAR-F");
 * ```
 */
export function findBundledTrack(code: string): Track {
  const track = loadBundledTracks().find(
    (candidate) => candidate.code === code,
  );
  if (track === undefined) {
    throw new MentorStateError(
      "VALIDATION_FAILED",
      "no bundled exam track has that code",
    );
  }
  return track;
}

/**
 * The value of the required flag `name` as a well-formed track code
 * (bundled-track membership is checked separately, by
 * {@link findBundledTrack}).
 *
 * @throws CliUsageError when the flag is absent or not a track code.
 *
 * @example
 * ```ts
 * import { requireTrackCode } from "./exam-shared.ts";
 * const code = requireTrackCode(args, "code"); // e.g. "CCAR-F"
 * ```
 */
export function requireTrackCode(args: ParsedArgs, name: string): string {
  const value = requireValue(args, name);
  if (!TRACK_CODE_PATTERN.test(value)) throw new CliUsageError();
  return value;
}

/**
 * The bundled track named by an optional `--track` flag, falling back to
 * the stored active track (`activeTrack`).
 *
 * @param args - Parsed arguments that may carry `--track`.
 * @param activeTrack - The stored `activeTrack`, or `undefined` when unset.
 * @throws CliUsageError when `--track` is malformed.
 * @throws MentorStateError `VALIDATION_FAILED` (fixed messages) when
 * `--track` names a code that is not bundled; when `--track` is absent and
 * there is no active track (the message points at `--track` and
 * `set-track`); or when `--track` is absent and the stored active track is
 * no longer bundled (the message points at `set-track --clear`).
 *
 * @example
 * ```ts
 * import { resolveTrack } from "./exam-shared.ts";
 * const state = await loadState(env.dir, env.now);
 * const track = resolveTrack(args, state.activeTrack);
 * ```
 */
export function resolveTrack(
  args: ParsedArgs,
  activeTrack: string | undefined,
): Track {
  if (args.values.has("track")) {
    return findBundledTrack(requireTrackCode(args, "track"));
  }
  if (activeTrack === undefined) {
    throw new MentorStateError(
      "VALIDATION_FAILED",
      "no exam track chosen: pass --track <code> or choose one with set-track --code <code>",
    );
  }
  const track = loadBundledTracks().find(
    (candidate) => candidate.code === activeTrack,
  );
  if (track === undefined) {
    throw new MentorStateError(
      "VALIDATION_FAILED",
      "the active exam track is no longer bundled: pass --track <code> or run set-track --clear",
    );
  }
  return track;
}

const MAX_LIMIT = 5000;
const LIMIT_PATTERN = /^[1-9][0-9]*$/;

/**
 * The optional `--limit` value: an integer from 1 to 5000, or `undefined`
 * when the flag is absent.
 *
 * @throws CliUsageError when `--limit` is given but is not such an integer.
 *
 * @example
 * ```ts
 * import { optionalLimit } from "./exam-shared.ts";
 * const limit = optionalLimit(args); // undefined without --limit
 * ```
 */
export function optionalLimit(args: ParsedArgs): number | undefined {
  const raw = args.values.get("limit");
  if (raw === undefined) return undefined;
  if (!LIMIT_PATTERN.test(raw)) throw new CliUsageError();
  const limit = Number(raw);
  if (limit > MAX_LIMIT) throw new CliUsageError();
  return limit;
}
