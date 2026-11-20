/**
 * The topic catalog: parsing the bundled catalog and the learner's user
 * catalog, merging the two, and matching free text against topic keywords.
 *
 * Every function here is pure: no I/O, no mutation of its inputs.
 */
import {
  LEVELS,
  STYLES,
  parseCatalogEntry,
  parseKeywords,
  parseTopicId,
  type CatalogEntry,
  type Level,
  type Parsed,
  type Style,
  type TopicId,
} from "./schema.ts";

/**
 * A learner's adjustments to one catalog topic. Every field is optional and
 * replaces the entry's value when present.
 *
 * @example
 * ```ts
 * import type { CatalogOverride } from "./catalog.ts";
 * const o: CatalogOverride = { enabled: false };
 * ```
 */
export interface CatalogOverride {
  readonly enabled?: boolean;
  readonly targetLevel?: Level;
  readonly style?: Style;
  /** Replaces the entry's keywords; same rules as catalog keywords. */
  readonly keywords?: readonly string[];
}

/**
 * The learner's catalog customizations: overrides keyed by topic id, and
 * custom topics appended after the bundled ones.
 *
 * @example
 * ```ts
 * import { parseUserCatalog, type UserCatalog } from "./catalog.ts";
 * const r = parseUserCatalog({ overrides: { "plan-mode": { enabled: false } } });
 * const user: UserCatalog | undefined = r.ok ? r.value : undefined;
 * ```
 */
export interface UserCatalog {
  readonly overrides: Readonly<Record<string, CatalogOverride>>;
  readonly custom: readonly CatalogEntry[];
}

/** Ceiling on catalog size; also bounds every loop over caller structure. */
const MAX_ENTRIES = 500;
/** Bounds matching cost on arbitrarily long prompts; topics surface early. */
const MAX_MATCH_TEXT_LENGTH = 20_000;
/** Few enough suggestions to stay focused without crowding the session. */
const DEFAULT_MATCH_LIMIT = 3;

function ok<T>(value: T): Parsed<T> {
  return { ok: true, value };
}

function fail<T>(reason: string): Parsed<T> {
  return { ok: false, reason };
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Readonly<Record<string, unknown>>;
}

/**
 * Checks the cross-entry invariants of a catalog: unique ids, every
 * dependency known, no dependency cycle. Cycle detection is Kahn's
 * algorithm, iterative, so it cannot overflow the stack.
 *
 * @returns `null` when valid, otherwise a reason naming a zero-based index.
 */
function graphProblem(entries: readonly CatalogEntry[]): string | null {
  const indexById = new Map<TopicId, number>();
  for (const [i, entry] of entries.entries()) {
    if (indexById.has(entry.id)) {
      return `entry ${String(i)} duplicates an earlier id`;
    }
    indexById.set(entry.id, i);
  }

  const dependents: number[][] = entries.map(() => []);
  const pending: number[] = entries.map((e) => e.dependencies.length);
  for (const [i, entry] of entries.entries()) {
    for (const dep of entry.dependencies) {
      const target = indexById.get(dep);
      if (target === undefined) {
        return `entry ${String(i)} depends on an unknown topic`;
      }
      dependents[target]?.push(i);
    }
  }

  const ready: number[] = [];
  for (const [i, count] of pending.entries()) {
    if (count === 0) ready.push(i);
  }
  let resolved = 0;
  for (let next = ready.pop(); next !== undefined; next = ready.pop()) {
    resolved += 1;
    for (const dependent of dependents[next] ?? []) {
      const left = (pending[dependent] ?? 0) - 1;
      pending[dependent] = left;
      if (left === 0) ready.push(dependent);
    }
  }
  return resolved === entries.length ? null : "catalog has a dependency cycle";
}

function parseEntries(
  value: unknown,
  field: string,
): Parsed<readonly CatalogEntry[]> {
  if (!Array.isArray(value)) return fail(`${field} must be an array`);
  const items: readonly unknown[] = value;
  const length = items.length;
  if (length > MAX_ENTRIES) {
    return fail(`${field} may hold at most ${String(MAX_ENTRIES)} entries`);
  }
  const entries: CatalogEntry[] = [];
  for (let i = 0; i < length; i++) {
    const entry = parseCatalogEntry(items[i]);
    if (!entry.ok) {
      return fail(`${field} entry ${String(i)} is invalid: ${entry.reason}`);
    }
    entries.push(entry.value);
  }
  return ok(entries);
}

/**
 * Validates a whole catalog: an array of at most 500 entries, each valid per
 * {@link parseCatalogEntry}, with unique ids, known dependencies and no
 * dependency cycle. Failure reasons name the offending entry by zero-based
 * index. The result preserves input order.
 *
 * @param value - Untrusted input, typically parsed JSON.
 * @returns The entries, or a reason that does not echo the input.
 *
 * @example
 * ```ts
 * import { parseCatalog } from "./catalog.ts";
 * const r = parseCatalog(JSON.parse(text) as unknown);
 * if (!r.ok) console.error(r.reason);
 * ```
 */
export function parseCatalog(value: unknown): Parsed<readonly CatalogEntry[]> {
  const entries = parseEntries(value, "catalog");
  if (!entries.ok) return entries;
  const problem = graphProblem(entries.value);
  return problem === null ? entries : fail(problem);
}

function parseOverride(value: unknown): Parsed<CatalogOverride> {
  const record = asRecord(value);
  if (record === null) return fail("must be an object");

  const hasEnabled = Object.hasOwn(record, "enabled");
  const enabled = hasEnabled ? record["enabled"] : undefined;
  if (hasEnabled && typeof enabled !== "boolean") {
    return fail("enabled must be a boolean");
  }

  const hasLevel = Object.hasOwn(record, "targetLevel");
  const targetLevel = hasLevel ? record["targetLevel"] : undefined;
  if (hasLevel && !(LEVELS as readonly unknown[]).includes(targetLevel)) {
    return fail("targetLevel is invalid");
  }

  const hasStyle = Object.hasOwn(record, "style");
  const style = hasStyle ? record["style"] : undefined;
  if (hasStyle && !(STYLES as readonly unknown[]).includes(style)) {
    return fail("style is invalid");
  }

  let keywords: readonly string[] | undefined;
  if (Object.hasOwn(record, "keywords")) {
    const parsed = parseKeywords(record["keywords"], "keywords");
    if (!parsed.ok) return parsed;
    keywords = parsed.value;
  }

  return ok({
    ...(typeof enabled === "boolean" ? { enabled } : {}),
    ...(hasLevel ? { targetLevel: targetLevel as Level } : {}),
    ...(hasStyle ? { style: style as Style } : {}),
    ...(keywords !== undefined ? { keywords } : {}),
  });
}

function parseOverrides(
  value: unknown,
): Parsed<Readonly<Record<string, CatalogOverride>>> {
  const record = asRecord(value);
  if (record === null) return fail("overrides must be an object");
  const keys = Object.keys(record);
  if (keys.length > MAX_ENTRIES) {
    return fail(`overrides may hold at most ${String(MAX_ENTRIES)} topics`);
  }
  const parsed = new Map<string, CatalogOverride>();
  for (const key of keys) {
    const id = parseTopicId(key);
    if (!id.ok) return fail(`overrides key is invalid: ${id.reason}`);
    const override = parseOverride(record[key]);
    if (!override.ok) {
      return fail(`override for a topic is invalid: ${override.reason}`);
    }
    parsed.set(id.value, override.value);
  }
  // Object.fromEntries defines own data properties, never invoking setters.
  return ok(Object.fromEntries(parsed));
}

/**
 * Validates the learner's user catalog. `overrides` and `custom` are both
 * optional (missing means `{}` and `[]`) but fail when present with the wrong
 * type. Override keys must be topic ids; unknown
 * keys inside an override are ignored. Custom entries are validated one by
 * one; cross-entry checks happen in {@link mergeCatalog}.
 *
 * @param value - Untrusted input, typically parsed JSON.
 * @returns A fresh {@link UserCatalog}, or a reason that does not echo input.
 *
 * @example
 * ```ts
 * import { parseUserCatalog } from "./catalog.ts";
 * const r = parseUserCatalog({
 *   overrides: { "plan-mode": { targetLevel: "Fluent" } },
 *   custom: [],
 * });
 * r.ok; // true
 * ```
 */
export function parseUserCatalog(value: unknown): Parsed<UserCatalog> {
  const record = asRecord(value);
  if (record === null) return fail("user catalog must be an object");

  let overrides: Readonly<Record<string, CatalogOverride>> = {};
  if (Object.hasOwn(record, "overrides")) {
    const parsed = parseOverrides(record["overrides"]);
    if (!parsed.ok) return parsed;
    overrides = parsed.value;
  }

  let custom: readonly CatalogEntry[] = [];
  if (Object.hasOwn(record, "custom")) {
    const parsed = parseEntries(record["custom"], "custom");
    if (!parsed.ok) return parsed;
    custom = parsed.value;
  }

  return ok({ overrides, custom });
}

function applyOverride(
  entry: CatalogEntry,
  override: CatalogOverride | undefined,
): CatalogEntry {
  if (override === undefined) return entry;
  return {
    ...entry,
    ...(override.enabled !== undefined ? { enabled: override.enabled } : {}),
    ...(override.targetLevel !== undefined
      ? { targetLevel: override.targetLevel }
      : {}),
    ...(override.style !== undefined ? { style: override.style } : {}),
    ...(override.keywords !== undefined ? { keywords: override.keywords } : {}),
  };
}

/**
 * The result of {@link mergeCatalog}: the merged entries plus the ids of any
 * custom entries dropped because a bundled entry already uses that id.
 *
 * @example
 * ```ts
 * import { mergeCatalog, type MergedCatalog } from "./catalog.ts";
 * const r = mergeCatalog(bundled, user);
 * const merged: MergedCatalog | undefined = r.ok ? r.value : undefined;
 * merged?.shadowedCustom; // e.g. ["plan-mode"]
 * ```
 */
export interface MergedCatalog {
  readonly entries: readonly CatalogEntry[];
  /** Sorted, distinct ids of the dropped custom entries; may be empty. */
  readonly shadowedCustom: readonly string[];
}

/**
 * Merges the bundled catalog with the learner's user catalog: bundled
 * entries in order with overrides applied, then custom entries in order
 * (overrides may also target a custom entry). Inputs are not mutated.
 *
 * A custom entry whose id equals a bundled id is dropped (the bundled entry
 * wins) and its id is reported in `shadowedCustom`; an override on that id
 * applies to the bundled entry, and other custom entries may depend on it.
 *
 * Fails when two custom entries share an id, an override names an unknown
 * id, or the final merged list breaks a {@link parseCatalog} invariant (size
 * cap, unknown dependency, cycle). Disabling a topic that another enabled
 * topic depends on is allowed.
 *
 * @example
 * ```ts
 * import { mergeCatalog, parseCatalog, parseUserCatalog } from "./catalog.ts";
 * const bundled = parseCatalog(bundledJson);
 * const user = parseUserCatalog(userJson);
 * if (bundled.ok && user.ok) {
 *   const merged = mergeCatalog(bundled.value, user.value);
 *   if (merged.ok) merged.value.entries; // the merged topics
 * }
 * ```
 */
export function mergeCatalog(
  bundled: readonly CatalogEntry[],
  user: UserCatalog,
): Parsed<MergedCatalog> {
  const bundledIds = new Set<string>(bundled.map((e) => e.id));
  const customIds = new Set<string>();
  const shadowed: string[] = [];
  const kept: CatalogEntry[] = [];
  for (const [i, entry] of user.custom.entries()) {
    if (customIds.has(entry.id)) {
      return fail(`custom entry ${String(i)} duplicates an earlier custom id`);
    }
    customIds.add(entry.id);
    if (bundledIds.has(entry.id)) shadowed.push(entry.id);
    else kept.push(entry);
  }

  const combined = [...bundled, ...kept];
  if (combined.length > MAX_ENTRIES) {
    return fail(`catalog may hold at most ${String(MAX_ENTRIES)} entries`);
  }
  const knownIds = new Set<string>(combined.map((e) => e.id));
  for (const key of Object.keys(user.overrides)) {
    if (!knownIds.has(key)) return fail("an override names an unknown topic");
  }

  const merged = combined.map((entry) =>
    applyOverride(
      entry,
      Object.hasOwn(user.overrides, entry.id)
        ? user.overrides[entry.id]
        : undefined,
    ),
  );
  const problem = graphProblem(merged);
  if (problem !== null) return fail(problem);
  return ok({ entries: merged, shadowedCustom: shadowed.sort() });
}

const WORD_CHAR = /^[\p{L}\p{N}]$/u;

/** Whether one UTF-16 code unit is a letter or digit (BMP only). */
function isWordChar(char: string | undefined): boolean {
  return char !== undefined && WORD_CHAR.test(char);
}

/** Characters after which a `/`-led keyword (a slash command) may start. */
const SLASH_OPENERS: ReadonlySet<string> = new Set([
  "(",
  "[",
  "{",
  "'",
  '"',
  "`",
]);
const WHITESPACE = /^\s$/u;

/**
 * Whether `char` (the one before a match) opens the match: for a keyword
 * starting with `/`, only the text start, whitespace or an opener, so a path
 * such as `src/init` or `./init` is not a slash command; for any other
 * keyword, anything but a letter or digit.
 */
function opensMatch(char: string | undefined, keyword: string): boolean {
  if (!keyword.startsWith("/")) return !isWordChar(char);
  return char === undefined || WHITESPACE.test(char) || SLASH_OPENERS.has(char);
}

/** Whether `keyword` occurs in `text` with an opening and closing boundary. */
function containsWord(text: string, keyword: string): boolean {
  for (
    let at = text.indexOf(keyword);
    at !== -1;
    at = text.indexOf(keyword, at + 1)
  ) {
    if (
      opensMatch(text[at - 1], keyword) &&
      !isWordChar(text[at + keyword.length])
    ) {
      return true;
    }
  }
  return false;
}

const NO_IDS: ReadonlySet<string> = new Set();

/**
 * Options for {@link matchTopics}.
 *
 * @example
 * ```ts
 * import { matchTopics, type MatchTopicsOptions } from "./catalog.ts";
 * const options: MatchTopicsOptions = { includeAmbientOff: new Set(["x"]) };
 * matchTopics(catalog, "text", 3, options);
 * ```
 */
export interface MatchTopicsOptions {
  /**
   * Ids of `ambient: false` entries that may match anyway, e.g. for an
   * explicit learner request rather than an unprompted tip.
   */
  readonly includeAmbientOff?: ReadonlySet<string>;
}

/**
 * Finds the enabled topics whose keywords occur in `text`, best first.
 * Entries marked `ambient: false` are skipped unless opted in via `options`.
 *
 * Matching is case-insensitive and literal; a keyword must be bounded on both
 * sides by a character that is not a Unicode letter or digit (`_` counts as a
 * boundary) or the string edge, so `plan` matches "a plan." but not
 * "explanation" or "planéte". A keyword starting with `/` (a slash command)
 * has a stricter opening boundary: the `/` must start the text or follow
 * whitespace or one of `( [ { ' "` or a backtick, so `/init` matches "use
 * /init" but not "./init", "~/init" or "src/init"; its closing boundary is
 * the usual one. Boundaries are tested one UTF-16 code unit at a time, so
 * astral-plane letters (outside the BMP) are treated as boundaries. Each
 * entry scores its count of DISTINCT matching keywords; zero scorers are
 * excluded, ties keep catalog order. Only the first 20000 chars of `text` are
 * examined: the cut may split a word, and lowercasing can make the scanned
 * text marginally longer than the cap.
 *
 * @param catalog - Validated entries, e.g. from {@link mergeCatalog}.
 * @param text - Free text to scan.
 * @param limit - Maximum results (default 3); below 1 returns `[]`.
 * @param options - `includeAmbientOff`: ids of `ambient: false` entries to
 *   match anyway. Every other `ambient: false` entry is skipped, and a
 *   disabled entry is skipped even when listed.
 *
 * @example
 * ```ts
 * import { matchTopics } from "./catalog.ts";
 * const hits = matchTopics(catalog, "How do I enter plan mode?");
 * hits.map((e) => e.id); // e.g. ["plan-mode"]
 * matchTopics(catalog, "plan mode", 3, {
 *   includeAmbientOff: new Set(["plan-mode"]),
 * });
 * ```
 */
export function matchTopics(
  catalog: readonly CatalogEntry[],
  text: string,
  limit: number = DEFAULT_MATCH_LIMIT,
  options: MatchTopicsOptions = {},
): readonly CatalogEntry[] {
  const max = Math.floor(limit);
  if (!(max >= 1)) return [];
  const haystack = text.slice(0, MAX_MATCH_TEXT_LENGTH).toLowerCase();
  const optedIn = options.includeAmbientOff ?? NO_IDS;

  const scored: { readonly entry: CatalogEntry; readonly score: number }[] = [];
  for (const entry of catalog) {
    if (!entry.enabled) continue;
    if (entry.ambient === false && !optedIn.has(entry.id)) continue;
    let score = 0;
    for (const keyword of new Set(entry.keywords)) {
      if (containsWord(haystack, keyword)) score += 1;
    }
    if (score > 0) scored.push({ entry, score });
  }
  // Array.prototype.sort is stable, so equal scores keep catalog order.
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((s) => s.entry);
}
