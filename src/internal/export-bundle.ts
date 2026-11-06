/**
 * The export bundle: one JSON document carrying every section of the
 * mentor's data directory, so a profile can move between machines. Pure
 * parsing and serialization only; the file I/O lives in `./export.ts`.
 */

import {
  parseCatalogFile,
  serializeCatalogFile,
  type CatalogFile,
} from "./catalog-file.js";
import { MentorStateError } from "./errors.js";
import { MAX_GOALS_BYTES } from "./fs-atomic.js";
import {
  MAX_EVIDENCE_EVENTS,
  parseEvidence,
  type Evidence,
  type Parsed,
} from "./schema.js";
import {
  parseProfile,
  parseState,
  type MentorState,
  type Profile,
} from "./state-schema.js";

/**
 * The `format` tag every bundle carries.
 *
 * @example
 * ```ts
 * import { BUNDLE_FORMAT } from "./export.js";
 * BUNDLE_FORMAT; // "m3l-claude-mentor-export"
 * ```
 */
export const BUNDLE_FORMAT = "m3l-claude-mentor-export";

/**
 * The only bundle `version` this build reads or writes.
 *
 * @example
 * ```ts
 * import { BUNDLE_VERSION } from "./export.js";
 * BUNDLE_VERSION; // 1
 * ```
 */
export const BUNDLE_VERSION = 1;

/**
 * The largest bundle file an import reads, in bytes (16 MiB).
 *
 * @example
 * ```ts
 * import { MAX_BUNDLE_BYTES } from "./export-bundle.js";
 * MAX_BUNDLE_BYTES; // 16_777_216
 * ```
 */
export const MAX_BUNDLE_BYTES: number = 16 * 1024 * 1024;

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

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Readonly<Record<string, unknown>>;
}

function ownField(record: Readonly<Record<string, unknown>>, key: string) {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function fail(reason: string): { readonly ok: false; readonly reason: string } {
  return { ok: false, reason };
}

function parseGoals(value: unknown): Parsed<string> {
  if (typeof value !== "string" || value.includes("\0")) {
    return fail("bundle goals must be text without NUL characters");
  }
  if (Buffer.byteLength(value, "utf8") > MAX_GOALS_BYTES) {
    return fail(
      `bundle goals must not exceed ${String(MAX_GOALS_BYTES)} bytes`,
    );
  }
  return { ok: true, value };
}

function parseEvidenceList(value: unknown): Parsed<readonly Evidence[]> {
  if (!Array.isArray(value)) return fail("bundle evidence must be an array");
  const items: readonly unknown[] = value;
  const count = items.length;
  if (count > MAX_EVIDENCE_EVENTS) {
    return fail(
      `bundle evidence must not exceed ${String(MAX_EVIDENCE_EVENTS)} events`,
    );
  }
  const events: Evidence[] = [];
  for (let index = 0; index < count; index += 1) {
    const parsed = parseEvidence(items[index]);
    if (!parsed.ok) {
      return fail(`bundle evidence[${String(index)}]: ${parsed.reason}`);
    }
    events.push(parsed.value);
  }
  return { ok: true, value: events };
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
export function parseBundle(value: unknown): Parsed<Bundle> {
  const record = asRecord(value);
  if (record === null) return fail("bundle must be an object");

  if (ownField(record, "format") !== BUNDLE_FORMAT) {
    return fail(`bundle format must be ${BUNDLE_FORMAT}`);
  }
  if (ownField(record, "version") !== BUNDLE_VERSION) {
    return fail(
      `unsupported bundle version; expected ${String(BUNDLE_VERSION)}`,
    );
  }

  const exportedAt = ownField(record, "exportedAt");
  if (
    typeof exportedAt !== "number" ||
    !Number.isFinite(exportedAt) ||
    exportedAt < 0
  ) {
    return fail("bundle exportedAt must be a finite, non-negative number");
  }

  const state = parseState(ownField(record, "state"));
  if (!state.ok) return fail(`bundle state: ${state.reason}`);

  const profile = parseProfile(ownField(record, "profile"));
  if (!profile.ok) return fail(`bundle profile: ${profile.reason}`);

  const catalog = parseCatalogFile(ownField(record, "catalog"));
  if (!catalog.ok) return fail(`bundle catalog: ${catalog.reason}`);

  const goals = parseGoals(ownField(record, "goals"));
  if (!goals.ok) return goals;

  const evidence = parseEvidenceList(ownField(record, "evidence"));
  if (!evidence.ok) return evidence;

  return {
    ok: true,
    value: {
      format: BUNDLE_FORMAT,
      version: BUNDLE_VERSION,
      exportedAt,
      state: state.value,
      profile: profile.value,
      catalog: catalog.value,
      goals: goals.value,
      evidence: evidence.value,
    },
  };
}

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
export function jsonText(value: unknown, what: string, indent: number): string {
  const text: unknown = JSON.stringify(value, null, indent);
  if (typeof text !== "string") {
    throw new MentorStateError(
      "VALIDATION_FAILED",
      `${what} does not serialize to JSON`,
    );
  }
  return `${text}\n`;
}

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
export function serializeBundle(bundle: Bundle): string {
  return jsonText(
    {
      format: bundle.format,
      version: bundle.version,
      exportedAt: bundle.exportedAt,
      state: bundle.state,
      profile: bundle.profile,
      catalog: serializeCatalogFile(bundle.catalog),
      goals: bundle.goals,
      evidence: bundle.evidence,
    },
    "the bundle",
    2,
  );
}

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
export function checkNow(now: number): void {
  if (!Number.isFinite(now) || now < 0) {
    throw new RangeError("now must be a finite, non-negative number");
  }
}

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
export function isConfirmed(options: unknown, key: string): boolean {
  if (typeof options !== "object" || options === null) return false;
  if (!Object.hasOwn(options, key)) return false;
  const value: unknown = (options as Readonly<Record<string, unknown>>)[key];
  return value === true;
}
