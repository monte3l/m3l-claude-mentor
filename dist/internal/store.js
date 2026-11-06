/**
 * Loading and saving the mentor's data files: `state.json`, `profile.json`,
 * `catalog.json`, `goals.md` and the append-only `evidence.jsonl`. A missing
 * file yields its default; every other failure is a {@link MentorStateError}
 * whose message names the file but never contains its content.
 */
import { parseCatalogFile, serializeCatalogFile, EMPTY_CATALOG_FILE, } from "./catalog-file.js";
import { MentorStateError } from "./errors.js";
import { EVIDENCE_TAIL_BYTES, MAX_EVIDENCE_LINE_BYTES, MAX_GOALS_BYTES, MAX_JSON_BYTES, appendLineAtomic, readTailLines, readTextBounded, writeTextAtomic, } from "./fs-atomic.js";
import { DATA_FILES, assertValidDataDir } from "./paths.js";
import { MAX_EVIDENCE_EVENTS, parseEvidence, } from "./schema.js";
import { clampProfileToNow, clampStateToNow, defaultProfile, defaultState, parseProfile, parseState, } from "./state-schema.js";
function checkNow(now) {
    if (!Number.isFinite(now) || now < 0) {
        throw new RangeError("now must be a finite, non-negative number");
    }
}
function asRecord(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return null;
    }
    return value;
}
function ownField(record, key) {
    return Object.hasOwn(record, key) ? record[key] : undefined;
}
/**
 * Reads, JSON-parses and validates one JSON data file. `null` when missing.
 * A `JSON.parse` failure is reported without its `SyntaxError`, whose
 * message embeds a snippet of the file.
 */
async function loadJson(dir, file, parse) {
    const text = await readTextBounded(dir, file, MAX_JSON_BYTES);
    if (text === null)
        return null;
    let raw;
    try {
        raw = JSON.parse(text);
    }
    catch {
        // Deliberately no `cause`: the SyntaxError message quotes file content.
        throw new MentorStateError("PARSE_FAILED", `${DATA_FILES[file]} is not valid JSON`);
    }
    const parsed = parse(raw);
    if (!parsed.ok) {
        throw new MentorStateError("VALIDATION_FAILED", `${DATA_FILES[file]} is invalid: ${parsed.reason}`);
    }
    return parsed.value;
}
function refuse(file, reason) {
    return new MentorStateError("VALIDATION_FAILED", `refusing to write ${DATA_FILES[file]}: ${reason}`);
}
/** Validates `value` with `parse`, then writes the parsed copy atomically. */
async function saveJson(dir, file, value, parse, toJson = (parsed) => parsed) {
    const parsed = parse(value);
    if (!parsed.ok)
        throw refuse(file, parsed.reason);
    const text = JSON.stringify(toJson(parsed.value), null, 2);
    if (typeof text !== "string") {
        throw refuse(file, "the value does not serialize to JSON");
    }
    await writeTextAtomic(dir, file, `${text}\n`);
}
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
export async function loadState(dir, now) {
    assertValidDataDir(dir);
    checkNow(now);
    const state = await loadJson(dir, "state", parseState);
    return state === null ? defaultState(now) : clampStateToNow(state, now);
}
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
export async function saveState(dir, state) {
    assertValidDataDir(dir);
    await saveJson(dir, "state", state, parseState);
}
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
export async function loadProfile(dir, now) {
    assertValidDataDir(dir);
    checkNow(now);
    const profile = await loadJson(dir, "profile", parseProfile);
    return profile === null ? defaultProfile() : clampProfileToNow(profile, now);
}
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
export async function saveProfile(dir, profile) {
    assertValidDataDir(dir);
    await saveJson(dir, "profile", profile, parseProfile);
}
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
export async function loadCatalogFile(dir) {
    assertValidDataDir(dir);
    const file = await loadJson(dir, "catalog", parseCatalogFile);
    return file ?? EMPTY_CATALOG_FILE;
}
/** The raw `catalog.json` shape of `file`, each field read once. */
function catalogCandidate(file) {
    const record = asRecord(file);
    if (record === null)
        return null;
    const user = asRecord(ownField(record, "user"));
    if (user === null)
        return null;
    const scoring = ownField(record, "scoring");
    return {
        overrides: ownField(user, "overrides"),
        custom: ownField(user, "custom"),
        ...(scoring !== undefined ? { scoring } : {}),
    };
}
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
export async function saveCatalogFile(dir, file) {
    assertValidDataDir(dir);
    await saveJson(dir, "catalog", catalogCandidate(file), parseCatalogFile, serializeCatalogFile);
}
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
export async function loadGoals(dir) {
    assertValidDataDir(dir);
    return (await readTextBounded(dir, "goals", MAX_GOALS_BYTES)) ?? "";
}
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
export async function saveGoals(dir, text) {
    assertValidDataDir(dir);
    if (typeof text !== "string" || text.includes("\0")) {
        throw refuse("goals", "goals must be text without NUL characters");
    }
    if (Buffer.byteLength(text, "utf8") > MAX_GOALS_BYTES) {
        throw new MentorStateError("TOO_LARGE", `refusing to write ${DATA_FILES.goals}: larger than ${String(MAX_GOALS_BYTES)} bytes`);
    }
    await writeTextAtomic(dir, "goals", text);
}
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
export async function appendEvidence(dir, evidence) {
    assertValidDataDir(dir);
    const parsed = parseEvidence(evidence);
    if (!parsed.ok) {
        throw new MentorStateError("VALIDATION_FAILED", `refusing to append to ${DATA_FILES.evidence}: ${parsed.reason}`);
    }
    const line = JSON.stringify(parsed.value);
    if (typeof line !== "string") {
        throw new MentorStateError("VALIDATION_FAILED", `refusing to append to ${DATA_FILES.evidence}: the event does not serialize to JSON`);
    }
    await appendLineAtomic(dir, "evidence", line);
}
function parseEvidenceLine(line) {
    if (Buffer.byteLength(line, "utf8") + 1 > MAX_EVIDENCE_LINE_BYTES) {
        return null;
    }
    let raw;
    try {
        raw = JSON.parse(line);
    }
    catch {
        // A malformed line is external data: counted as skipped, never echoed.
        return null;
    }
    const parsed = parseEvidence(raw);
    return parsed.ok ? parsed.value : null;
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
export async function readEvidence(dir, options) {
    assertValidDataDir(dir);
    const maxEvents = options?.maxEvents ?? MAX_EVIDENCE_EVENTS;
    if (!Number.isInteger(maxEvents) ||
        maxEvents < 1 ||
        maxEvents > MAX_EVIDENCE_EVENTS) {
        throw new RangeError(`maxEvents must be an integer from 1 to ${String(MAX_EVIDENCE_EVENTS)}`);
    }
    const lines = await readTailLines(dir, "evidence", EVIDENCE_TAIL_BYTES);
    if (lines === null)
        return { events: [], skipped: 0 };
    const events = [];
    let skipped = 0;
    for (const line of lines) {
        const event = parseEvidenceLine(line);
        if (event === null)
            skipped += 1;
        else
            events.push(event);
    }
    return { events: events.slice(-maxEvents), skipped };
}
//# sourceMappingURL=store.js.map