/**
 * Loads the topic catalog that ships with the plugin (`data/topic-catalog.json`).
 */
import { open } from "node:fs/promises";
import { parseCatalog } from "./catalog.js";
import { MentorStateError } from "./errors.js";
/** The largest bundled catalog accepted, in bytes. */
const MAX_BUNDLED_BYTES = 1_048_576;
/** The fixed file name used in error messages (never the full path). */
const FILE_NAME = "topic-catalog.json";
/**
 * Reads at most `maxBytes + 1` bytes of the file at `source`, so a file over
 * the limit is detected without reading it whole. The whole open/read/close
 * lifecycle is under one catch; a failing close on the error path is dropped
 * so it cannot replace the primary error.
 */
async function readBounded(source, maxBytes) {
    const buffer = Buffer.alloc(maxBytes + 1);
    let handle;
    let total = 0;
    try {
        handle = await open(source, "r");
        while (total < buffer.length) {
            const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
            if (bytesRead === 0)
                break;
            total += bytesRead;
        }
        const opened = handle;
        handle = undefined;
        await opened.close();
    }
    catch (cause) {
        throw new MentorStateError("READ_FAILED", `could not read ${FILE_NAME}`, {
            cause,
        });
    }
    finally {
        try {
            await handle?.close();
        }
        catch {
            // Best effort only; the read failure above is the error that matters.
        }
    }
    return buffer.subarray(0, total);
}
/**
 * Loads and validates the bundled topic catalog. By default it reads
 * `data/topic-catalog.json`, located relative to this module so it resolves
 * from both `src/internal/` and `dist/internal/` (the plugin keeps `data/`
 * next to `dist/`). Nothing is cached: each call reads the file again and
 * returns a fresh array.
 *
 * @param source - A `file:` URL of the catalog to read; defaults to the
 * bundled `data/topic-catalog.json`.
 * @returns The validated catalog entries.
 * @throws MentorStateError `READ_FAILED` (fs error as `cause`) when the file
 * cannot be read; `TOO_LARGE` when it exceeds 1 MiB; `PARSE_FAILED` (fixed
 * message, no `cause`) when it is not JSON; `VALIDATION_FAILED` (with the
 * parser's reason) when the catalog is invalid.
 *
 * @example
 * ```ts
 * import { loadBundledCatalog } from "./bundled-catalog.js";
 * const catalog = await loadBundledCatalog();
 * const enabled = catalog.filter((entry) => entry.enabled);
 * ```
 */
export async function loadBundledCatalog(source = new URL("../../data/topic-catalog.json", import.meta.url)) {
    const bytes = await readBounded(source, MAX_BUNDLED_BYTES);
    if (bytes.length > MAX_BUNDLED_BYTES) {
        throw new MentorStateError("TOO_LARGE", `${FILE_NAME} is larger than ${String(MAX_BUNDLED_BYTES)} bytes`);
    }
    let raw;
    try {
        raw = JSON.parse(bytes.toString("utf8"));
    }
    catch {
        // No cause: a SyntaxError message embeds a snippet of the file text.
        throw new MentorStateError("PARSE_FAILED", `${FILE_NAME} is not valid JSON`);
    }
    const parsed = parseCatalog(raw);
    if (!parsed.ok) {
        throw new MentorStateError("VALIDATION_FAILED", `${FILE_NAME} is invalid: ${parsed.reason}`);
    }
    return parsed.value;
}
//# sourceMappingURL=bundled-catalog.js.map