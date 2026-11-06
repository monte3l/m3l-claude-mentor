/**
 * Loading and saving the mentor's data files: `state.json`, `profile.json`,
 * `catalog.json`, `goals.md` and the append-only `evidence.jsonl`. A missing
 * file yields its default; every other failure is a {@link MentorStateError}
 * whose message names the file but never contains its content.
 */
import { type CatalogFile } from "./catalog-file.js";
import { type Evidence } from "./schema.js";
import { type MentorState, type Profile } from "./state-schema.js";
/**
 * Loads `state.json`, clamping any segment timestamp later than `now` to
 * `now` (see {@link clampStateToNow}) so a skewed clock cannot stall the
 * mentor. Never creates the data directory.
 *
 * @param dir - The data directory.
 * @param now - Current timestamp in milliseconds; finite and non-negative.
 * @returns The stored state, or `defaultState(now)` when the file is missing.
 * @throws RangeError when `now` is invalid (checked before any I/O).
 * @throws MentorStateError `READ_FAILED`, `TOO_LARGE`, `PARSE_FAILED` (no
 * `cause`) or `VALIDATION_FAILED`.
 * @throws MentorStateError `DATA_DIR_INVALID` (before any other check or
 * I/O) when `dir` fails {@link assertValidDataDir}.
 *
 * @example
 * ```ts
 * import { loadState } from "./store.js";
 * const state = await loadState("/var/data/m3l", Date.now());
 * ```
 */
export declare function loadState(dir: string, now: number): Promise<MentorState>;
/**
 * Validates `state` and writes it atomically to `state.json` as
 * pretty-printed JSON, exactly as given (no clamping). Concurrent savers are
 * last-writer-wins; a reader never sees a torn file. Known limitation: there
 * is no locking, so concurrent read-modify-write cycles by different hooks
 * can lose an update without any error.
 *
 * @param dir - The data directory; created (mode `0o700`) if missing.
 * @param state - The state to persist.
 * @throws MentorStateError `VALIDATION_FAILED` ("refusing to write ...")
 * without touching the file; `WRITE_FAILED` on fs errors.
 * @throws MentorStateError `DATA_DIR_INVALID` (before any other check or
 * I/O) when `dir` fails {@link assertValidDataDir}.
 *
 * @example
 * ```ts
 * import { defaultState } from "./state-schema.js";
 * import { saveState } from "./store.js";
 * await saveState("/var/data/m3l", defaultState(Date.now()));
 * ```
 */
export declare function saveState(dir: string, state: MentorState): Promise<void>;
/**
 * Loads `profile.json`, clamping any `lastPassAt` later than `now` to `now`
 * (see {@link clampProfileToNow}). Never creates the data directory.
 *
 * @param dir - The data directory.
 * @param now - Current timestamp in milliseconds; finite and non-negative.
 * @returns The stored profile, or `defaultProfile()` when the file is
 * missing.
 * @throws RangeError when `now` is invalid (checked before any I/O).
 * @throws MentorStateError `READ_FAILED`, `TOO_LARGE`, `PARSE_FAILED` (no
 * `cause`) or `VALIDATION_FAILED`.
 * @throws MentorStateError `DATA_DIR_INVALID` (before any other check or
 * I/O) when `dir` fails {@link assertValidDataDir}.
 *
 * @example
 * ```ts
 * import { loadProfile } from "./store.js";
 * const profile = await loadProfile("/var/data/m3l", Date.now());
 * ```
 */
export declare function loadProfile(dir: string, now: number): Promise<Profile>;
/**
 * Validates `profile` and writes it atomically to `profile.json` as
 * pretty-printed JSON, exactly as given. Concurrent savers are
 * last-writer-wins; a reader never sees a torn file. Known limitation: there
 * is no locking, so concurrent read-modify-write cycles by different hooks
 * can lose an update without any error.
 *
 * @param dir - The data directory; created (mode `0o700`) if missing.
 * @param profile - The profile to persist.
 * @throws MentorStateError `VALIDATION_FAILED` ("refusing to write ...")
 * without touching the file; `WRITE_FAILED` on fs errors.
 * @throws MentorStateError `DATA_DIR_INVALID` (before any other check or
 * I/O) when `dir` fails {@link assertValidDataDir}.
 *
 * @example
 * ```ts
 * import { defaultProfile } from "./state-schema.js";
 * import { saveProfile } from "./store.js";
 * await saveProfile("/var/data/m3l", defaultProfile());
 * ```
 */
export declare function saveProfile(dir: string, profile: Profile): Promise<void>;
/**
 * Loads `catalog.json` (user catalog plus scoring overrides). Never creates
 * the data directory.
 *
 * @param dir - The data directory.
 * @returns The stored catalog file, or {@link EMPTY_CATALOG_FILE} when the
 * file is missing.
 * @throws MentorStateError `READ_FAILED`, `TOO_LARGE`, `PARSE_FAILED` (no
 * `cause`) or `VALIDATION_FAILED`.
 * @throws MentorStateError `DATA_DIR_INVALID` (before any other check or
 * I/O) when `dir` fails {@link assertValidDataDir}.
 *
 * @example
 * ```ts
 * import { loadCatalogFile } from "./store.js";
 * const { user, scoring } = await loadCatalogFile("/var/data/m3l");
 * ```
 */
export declare function loadCatalogFile(dir: string): Promise<CatalogFile>;
/**
 * Validates `file` and writes it atomically to `catalog.json` in its
 * serialized form (`scoring` omitted when empty). Concurrent savers are
 * last-writer-wins; a reader never sees a torn file. Known limitation: there
 * is no locking, so concurrent read-modify-write cycles by different hooks
 * can lose an update without any error.
 *
 * @param dir - The data directory; created (mode `0o700`) if missing.
 * @param file - The catalog file to persist.
 * @throws MentorStateError `VALIDATION_FAILED` ("refusing to write ...")
 * without touching the file; `WRITE_FAILED` on fs errors.
 * @throws MentorStateError `DATA_DIR_INVALID` (before any other check or
 * I/O) when `dir` fails {@link assertValidDataDir}.
 *
 * @example
 * ```ts
 * import { EMPTY_CATALOG_FILE } from "./catalog-file.js";
 * import { saveCatalogFile } from "./store.js";
 * await saveCatalogFile("/var/data/m3l", EMPTY_CATALOG_FILE);
 * ```
 */
export declare function saveCatalogFile(dir: string, file: CatalogFile): Promise<void>;
/**
 * Loads the learner's free-text goals from `goals.md`. Never creates the
 * data directory. Decoding is lenient: invalid UTF-8 bytes become U+FFFD.
 *
 * @param dir - The data directory.
 * @returns The text, or `""` when the file is missing.
 * @throws MentorStateError `TOO_LARGE` beyond {@link MAX_GOALS_BYTES} bytes;
 * `READ_FAILED` on fs errors.
 * @throws MentorStateError `DATA_DIR_INVALID` (before any other check or
 * I/O) when `dir` fails {@link assertValidDataDir}.
 *
 * @example
 * ```ts
 * import { loadGoals } from "./store.js";
 * const goals = await loadGoals("/var/data/m3l");
 * ```
 */
export declare function loadGoals(dir: string): Promise<string>;
/**
 * Writes `text` verbatim and atomically to `goals.md`. Concurrent savers are
 * last-writer-wins; a reader never sees a torn file. Known limitation: there
 * is no locking, so concurrent read-modify-write cycles by different hooks
 * can lose an update without any error.
 *
 * @param dir - The data directory; created (mode `0o700`) if missing.
 * @param text - The goals; no NUL character and at most
 * {@link MAX_GOALS_BYTES} UTF-8 bytes.
 * @throws MentorStateError `VALIDATION_FAILED` for a non-string or a NUL
 * character; `TOO_LARGE` beyond the byte limit (neither touches the file);
 * `WRITE_FAILED` on fs errors.
 * @throws MentorStateError `DATA_DIR_INVALID` (before any other check or
 * I/O) when `dir` fails {@link assertValidDataDir}.
 *
 * @example
 * ```ts
 * import { saveGoals } from "./store.js";
 * await saveGoals("/var/data/m3l", "Learn hooks\n");
 * ```
 */
export declare function saveGoals(dir: string, text: string): Promise<void>;
/**
 * Re-validates `evidence` with {@link parseEvidence} and appends the parsed
 * copy (only the five typed fields) as one JSON line to `evidence.jsonl`.
 *
 * @param dir - The data directory; created (mode `0o700`) if missing.
 * @param evidence - The event to record.
 * @throws MentorStateError `VALIDATION_FAILED` without touching the file;
 * `WRITE_FAILED` on fs errors.
 * @throws MentorStateError `DATA_DIR_INVALID` (before any other check or
 * I/O) when `dir` fails {@link assertValidDataDir}.
 *
 * @example
 * ```ts
 * import { parseEvidence } from "./schema.js";
 * import { appendEvidence } from "./store.js";
 * const r = parseEvidence({
 *   channel: "quiz",
 *   topic: "plan-mode",
 *   result: "positive",
 *   at: Date.now(),
 *   session: "sess_1",
 * });
 * if (r.ok) await appendEvidence("/var/data/m3l", r.value);
 * ```
 */
export declare function appendEvidence(dir: string, evidence: Evidence): Promise<void>;
/**
 * The result of {@link readEvidence}.
 *
 * @example
 * ```ts
 * import { readEvidence, type EvidenceRead } from "./store.js";
 * const read: EvidenceRead = await readEvidence("/var/data/m3l");
 * ```
 */
export interface EvidenceRead {
    /** The last valid events, in file order. */
    readonly events: readonly Evidence[];
    /** How many lines were malformed, oversized or invalid. */
    readonly skipped: number;
}
/**
 * Reads the most recent evidence from the last {@link EVIDENCE_TAIL_BYTES}
 * bytes of `evidence.jsonl`. A line that is not JSON, fails
 * {@link parseEvidence}, or is longer than an appended line can be is not an
 * error: it is counted in `skipped`, and its text is never returned or
 * thrown. Never creates the data directory.
 *
 * @param dir - The data directory.
 * @param options - `maxEvents`: how many of the last valid events to keep;
 * an integer from 1 to {@link MAX_EVIDENCE_EVENTS} (the default).
 * @returns The last `maxEvents` valid events in file order, and the skipped
 * count; `{ events: [], skipped: 0 }` when the file is missing.
 * @throws RangeError when `maxEvents` is invalid (checked before any I/O).
 * @throws MentorStateError `READ_FAILED` on fs errors.
 * @throws MentorStateError `DATA_DIR_INVALID` (before any other check or
 * I/O) when `dir` fails {@link assertValidDataDir}.
 *
 * @example
 * ```ts
 * import { readEvidence } from "./store.js";
 * const { events, skipped } = await readEvidence("/var/data/m3l", { maxEvents: 500 });
 * ```
 */
export declare function readEvidence(dir: string, options?: {
    readonly maxEvents?: number;
}): Promise<EvidenceRead>;
//# sourceMappingURL=store.d.ts.map