/**
 * The export bundle: one JSON document carrying every section of the
 * mentor's data directory, so a profile can move between machines. Pure
 * parsing and serialization only; the file I/O lives in `./export.ts`.
 */
import { type CatalogFile } from "./catalog-file.js";
import { type Evidence, type Parsed } from "./schema.js";
import { type MentorState, type Profile } from "./state-schema.js";
/**
 * The `format` tag every bundle carries.
 *
 * @example
 * ```ts
 * import { BUNDLE_FORMAT } from "./export.js";
 * BUNDLE_FORMAT; // "m3l-claude-mentor-export"
 * ```
 */
export declare const BUNDLE_FORMAT = "m3l-claude-mentor-export";
/**
 * The only bundle `version` this build reads or writes.
 *
 * @example
 * ```ts
 * import { BUNDLE_VERSION } from "./export.js";
 * BUNDLE_VERSION; // 1
 * ```
 */
export declare const BUNDLE_VERSION = 1;
/**
 * The largest bundle file an import reads, in bytes (16 MiB).
 *
 * @example
 * ```ts
 * import { MAX_BUNDLE_BYTES } from "./export-bundle.js";
 * MAX_BUNDLE_BYTES; // 16_777_216
 * ```
 */
export declare const MAX_BUNDLE_BYTES: number;
/**
 * Every section of the data directory, as exported.
 *
 * @example
 * ```ts
 * import { exportBundle, type Bundle } from "./export.js";
 * const bundle: Bundle = await exportBundle("/var/data/m3l", Date.now());
 * ```
 */
export interface Bundle {
    readonly format: typeof BUNDLE_FORMAT;
    readonly version: typeof BUNDLE_VERSION;
    /** Epoch milliseconds of the export; finite and non-negative. */
    readonly exportedAt: number;
    readonly state: MentorState;
    readonly profile: Profile;
    readonly catalog: CatalogFile;
    /** At most {@link MAX_GOALS_BYTES} UTF-8 bytes, no NUL character. */
    readonly goals: string;
    /** At most {@link MAX_EVIDENCE_EVENTS} events, oldest first. */
    readonly evidence: readonly Evidence[];
}
/**
 * Validates an export bundle. Every field is read once as an own property;
 * extra keys are ignored and not copied. `format` must equal
 * {@link BUNDLE_FORMAT} and `version` must be exactly {@link BUNDLE_VERSION}
 * (any other version is rejected, never misread). Each section goes through
 * its own parser (`parseState`, `parseProfile`, `parseCatalogFile`, and
 * `parseEvidence` per item, whose failure names the zero-based index as
 * `evidence[<index>]`). The result is built fresh.
 *
 * @param value - Untrusted input, typically a JSON-parsed bundle file.
 * @returns A fresh {@link Bundle}, or a reason that does not echo input.
 *
 * @example
 * ```ts
 * import { parseBundle } from "./export.js";
 * const r = parseBundle(JSON.parse(text));
 * if (!r.ok) console.error(r.reason);
 * ```
 */
export declare function parseBundle(value: unknown): Parsed<Bundle>;
/**
 * Serializes `value` as JSON plus a trailing newline (`indent` spaces, or a
 * single line for `0`), refusing a value that `JSON.stringify` turns into
 * `undefined`.
 *
 * @param value - The value to serialize.
 * @param what - A fixed label for the error message.
 * @param indent - Spaces per level; `0` for one line.
 * @throws MentorStateError `VALIDATION_FAILED` when `value` does not
 * serialize to JSON text.
 *
 * @example
 * ```ts
 * import { jsonText } from "./export-bundle.js";
 * jsonText({ a: 1 }, "example", 0); // '{"a":1}\n'
 * ```
 */
export declare function jsonText(value: unknown, what: string, indent: number): string;
/**
 * Serializes a bundle as pretty-printed JSON (two-space indent) with a
 * trailing newline. Only the bundle's own fields are written, and the
 * catalog is written in its `catalog.json` form, so
 * `parseBundle(JSON.parse(serializeBundle(b)))` equals `b`.
 *
 * @param bundle - A bundle, normally from {@link parseBundle} or `exportBundle`.
 * @returns The JSON text.
 *
 * @example
 * ```ts
 * import { exportBundle, serializeBundle } from "./export.js";
 * const text = serializeBundle(await exportBundle("/var/data/m3l", Date.now()));
 * ```
 */
export declare function serializeBundle(bundle: Bundle): string;
/**
 * Checks a caller-supplied timestamp.
 *
 * @param now - Epoch milliseconds.
 * @throws RangeError when `now` is not finite or is negative.
 *
 * @example
 * ```ts
 * import { checkNow } from "./export-bundle.js";
 * checkNow(Date.now()); // returns; checkNow(-1) throws
 * ```
 */
export declare function checkNow(now: number): void;
/**
 * Whether `options` has an own `key` whose value is exactly `true`. The
 * value is read once; an inherited or truthy non-boolean value does not
 * count.
 *
 * @param options - Caller-supplied options, untrusted at runtime.
 * @param key - The confirmation key, such as `"confirm"`.
 * @returns `true` only for an own property equal to `true`.
 *
 * @example
 * ```ts
 * import { isConfirmed } from "./export-bundle.js";
 * isConfirmed({ confirm: true }, "confirm"); // true
 * isConfirmed({ confirm: "yes" }, "confirm"); // false
 * ```
 */
export declare function isConfirmed(options: unknown, key: string): boolean;
//# sourceMappingURL=export-bundle.d.ts.map