/**
 * Certification exam tracks: the data model for `data/tracks/<code>.json`,
 * its parser, and a cross-check against the topic catalog. The loader for the
 * bundled track files lives in `./bundled-tracks.ts`.
 *
 * Like the parsers in `./schema.ts`, {@link parseTrack} never throws on plain
 * data, reads each field once from an own property, and never echoes a raw
 * input value in its failure reason. Only ids that have already passed their
 * shape check (domain, objective, and track codes) are named in a reason.
 */
import {
  parseTopicId,
  type CatalogEntry,
  type Parsed,
  type TopicId,
} from "./schema.ts";

/**
 * The certification tiers a track can belong to.
 *
 * @example
 * ```ts
 * import { TRACK_TIERS } from "./tracks.ts";
 * TRACK_TIERS.includes("foundations"); // true
 * ```
 */
export const TRACK_TIERS = [
  "foundations",
  "professional",
  "associate",
] as const;

/**
 * A certification tier; one of {@link TRACK_TIERS}.
 *
 * @example
 * ```ts
 * import type { TrackTier } from "./tracks.ts";
 * const tier: TrackTier = "professional";
 * ```
 */
export type TrackTier = (typeof TRACK_TIERS)[number];

/**
 * The exam item kinds a track's format can use.
 *
 * @example
 * ```ts
 * import { ITEM_KINDS } from "./tracks.ts";
 * ITEM_KINDS[0]; // "single"
 * ```
 */
export const ITEM_KINDS = ["single", "multiple"] as const;

/**
 * An exam item kind; one of {@link ITEM_KINDS}.
 *
 * @example
 * ```ts
 * import type { ItemKind } from "./tracks.ts";
 * const kind: ItemKind = "multiple";
 * ```
 */
export type ItemKind = (typeof ITEM_KINDS)[number];

/**
 * Where a track's content comes from: the official exam guide it paraphrases.
 *
 * @example
 * ```ts
 * import type { TrackGuide } from "./tracks.ts";
 * const guide: TrackGuide = {
 *   version: "1.0",
 *   effective: "2026-03",
 *   sourceUrl: "https://example.com/guide",
 *   reviewedAt: "2026-11-01",
 * };
 * ```
 */
export interface TrackGuide {
  /** Non-empty, at most 20 chars. */
  readonly version: string;
  /** `YYYY-MM` or `YYYY-MM-DD`, a real calendar month or date. */
  readonly effective: string;
  /** An absolute `https:` URL. */
  readonly sourceUrl: string;
  /** `YYYY-MM-DD`, a real calendar date. */
  readonly reviewedAt: string;
}

/**
 * The shape of the exam itself.
 *
 * @example
 * ```ts
 * import type { TrackFormat } from "./tracks.ts";
 * const format: TrackFormat = {
 *   minutes: 120,
 *   passScaled: 720,
 *   scaleMax: 1000,
 *   itemKinds: ["single", "multiple"],
 * };
 * ```
 */
export interface TrackFormat {
  /** A positive integer. */
  readonly minutes: number;
  /** A non-negative integer, at most {@link TrackFormat.scaleMax}. */
  readonly passScaled: number;
  /** A positive integer, at least {@link TrackFormat.passScaled}. */
  readonly scaleMax: number;
  /** Distinct, non-empty. */
  readonly itemKinds: readonly ItemKind[];
}

/**
 * A scenario the exam draws items from, tied to one or more domains.
 *
 * @example
 * ```ts
 * import type { TrackScenario } from "./tracks.ts";
 * const s: TrackScenario = { id: "S1", summary: "A scenario", domains: ["D1"] };
 * ```
 */
export interface TrackScenario {
  /** `S<n>`, unique within the track. */
  readonly id: string;
  /** Non-empty after trimming, at most 100 chars. */
  readonly summary: string;
  /** Distinct ids of domains declared by the same track; non-empty. */
  readonly domains: readonly string[];
}

/**
 * One exam objective, mapped onto 1 to 6 catalog topics.
 *
 * @example
 * ```ts
 * import type { TrackObjective } from "./tracks.ts";
 * declare const objective: TrackObjective;
 * objective.topics.length; // 1 to 6
 * ```
 */
export interface TrackObjective {
  /** `D<n>.<k>`, where `D<n>` is the owning domain's id; unique in the track. */
  readonly id: string;
  /** The official guide's reference; present only when supplied. */
  readonly officialRef?: string;
  /** A paraphrase; non-empty after trimming, at most 140 chars. */
  readonly summary: string;
  /** 1 to 6 distinct topic ids. */
  readonly topics: readonly TopicId[];
  /** Outside-study references (third-party material); present only when supplied. */
  readonly external?: readonly string[];
}

/**
 * One weighted exam domain.
 *
 * @example
 * ```ts
 * import type { TrackDomain } from "./tracks.ts";
 * declare const domain: TrackDomain;
 * domain.weight; // an integer from 1 to 100
 * ```
 */
export interface TrackDomain {
  /** `D<n>`, unique within the track. */
  readonly id: string;
  /** Non-empty after trimming, at most 120 chars. */
  readonly name: string;
  /** An integer from 1 to 100; a track's weights sum to exactly 100. */
  readonly weight: number;
  /** Non-empty. */
  readonly objectives: readonly TrackObjective[];
}

/**
 * A validated certification exam track. Obtain one through
 * {@link parseTrack} or `loadBundledTracks` (in `./bundled-tracks.ts`).
 *
 * @example
 * ```ts
 * import { loadBundledTracks } from "./bundled-tracks.ts";
 * import type { Track } from "./tracks.ts";
 * const tracks: Track[] = loadBundledTracks();
 * const codes = tracks.map((track) => track.code);
 * ```
 */
export interface Track {
  readonly schemaVersion: 1;
  /** Like `CCAR-F`: 2 to 4 uppercase letters, `-`, 1 or 2 uppercase letters. */
  readonly code: string;
  /** Non-empty after trimming, at most 120 chars. */
  readonly title: string;
  readonly tier: TrackTier;
  /** The code of the track this one builds on, or `null`. */
  readonly assumes: string | null;
  readonly guide: TrackGuide;
  readonly format: TrackFormat;
  /** Empty when the file declares none. */
  readonly scenarios: readonly TrackScenario[];
  /** Non-empty; weights sum to 100. */
  readonly domains: readonly TrackDomain[];
}

const CODE_PATTERN = /^[A-Z]{2,4}-[A-Z]{1,2}$/;
const DOMAIN_ID_PATTERN = /^D[1-9][0-9]?$/;
const OBJECTIVE_ID_PATTERN = /^(D[1-9][0-9]?)\.[1-9][0-9]?$/;
const SCENARIO_ID_PATTERN = /^S[1-9][0-9]?$/;
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_TITLE_LENGTH = 120;
const MAX_VERSION_LENGTH = 20;
const MAX_SCENARIO_SUMMARY_LENGTH = 100;
const MAX_OBJECTIVE_SUMMARY_LENGTH = 140;
const MAX_REF_LENGTH = 40;
const MAX_EXTERNAL_LENGTH = 120;
const MAX_EXTERNAL = 10;
const MAX_TOPICS = 6;
const MAX_DOMAINS = 20;
const MAX_OBJECTIVES = 50;
const MAX_SCENARIOS = 20;
const TOTAL_WEIGHT = 100;

// Local copies of the private helpers in `./schema.ts` (as `catalog-file.ts`
// does), so this module does not widen that file's export surface.
function ok<T>(value: T): Parsed<T> {
  return { ok: true, value };
}

function fail<T>(reason: string): Parsed<T> {
  return { ok: false, reason };
}

/** A non-null, non-array object, viewed as a read-only record. */
function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Readonly<Record<string, unknown>>;
}

/** Reads an own field exactly once; `undefined` when absent or inherited. */
function ownField(
  record: Readonly<Record<string, unknown>>,
  key: string,
): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function isMember<T extends string>(
  set: readonly T[],
  value: unknown,
): value is T {
  return (
    typeof value === "string" && (set as readonly string[]).includes(value)
  );
}

function isIntegerIn(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

/** A trimmed string of 1 to `max` chars, or a reason naming `label`. */
function parseText(value: unknown, label: string, max: number): Parsed<string> {
  if (typeof value !== "string") return fail(`${label} must be a string`);
  const text = value.trim();
  if (text.length === 0 || text.length > max) {
    return fail(
      `${label} must be 1 to ${String(max)} characters after trimming`,
    );
  }
  return ok(text);
}

/** Whether `year`-`month`(-`day`) names a real calendar month or date. */
function isCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= lastDay;
}

/** `YYYY-MM-DD` always; `YYYY-MM` too when `allowMonth`. */
function isIsoDate(value: unknown, allowMonth: boolean): value is string {
  if (typeof value !== "string") return false;
  const date = DATE_PATTERN.exec(value);
  if (date !== null) {
    return isCalendarDate(Number(date[1]), Number(date[2]), Number(date[3]));
  }
  const month = allowMonth ? MONTH_PATTERN.exec(value) : null;
  return (
    month !== null && isCalendarDate(Number(month[1]), Number(month[2]), 1)
  );
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || !URL.canParse(value)) return false;
  return new URL(value).protocol === "https:";
}

function parseGuide(value: unknown): Parsed<TrackGuide> {
  const record = asRecord(value);
  if (record === null) return fail("track guide must be an object");

  const version = parseText(
    ownField(record, "version"),
    "track guide.version",
    MAX_VERSION_LENGTH,
  );
  if (!version.ok) return version;

  const effective = ownField(record, "effective");
  if (!isIsoDate(effective, true)) {
    return fail("track guide.effective must be YYYY-MM or YYYY-MM-DD");
  }

  const sourceUrl = ownField(record, "sourceUrl");
  if (!isHttpsUrl(sourceUrl)) {
    return fail("track guide.sourceUrl must be an https URL");
  }

  const reviewedAt = ownField(record, "reviewedAt");
  if (!isIsoDate(reviewedAt, false)) {
    return fail("track guide.reviewedAt must be YYYY-MM-DD");
  }

  return ok({ version: version.value, effective, sourceUrl, reviewedAt });
}

function parseItemKinds(value: unknown): Parsed<readonly ItemKind[]> {
  if (!Array.isArray(value) || value.length === 0) {
    return fail("track format.itemKinds must be a non-empty array");
  }
  const kinds: ItemKind[] = [];
  for (const item of value as readonly unknown[]) {
    if (!isMember(ITEM_KINDS, item) || kinds.includes(item)) {
      return fail("track format.itemKinds must hold distinct known kinds");
    }
    kinds.push(item);
  }
  return ok(kinds);
}

function parseFormat(value: unknown): Parsed<TrackFormat> {
  const record = asRecord(value);
  if (record === null) return fail("track format must be an object");

  const minutes = ownField(record, "minutes");
  if (!isIntegerIn(minutes, 1, Number.MAX_SAFE_INTEGER)) {
    return fail("track format.minutes must be a positive integer");
  }

  const passScaled = ownField(record, "passScaled");
  if (!isIntegerIn(passScaled, 0, Number.MAX_SAFE_INTEGER)) {
    return fail("track format.passScaled must be a non-negative integer");
  }

  const scaleMax = ownField(record, "scaleMax");
  if (
    !isIntegerIn(scaleMax, Math.max(1, passScaled), Number.MAX_SAFE_INTEGER)
  ) {
    return fail(
      "track format.scaleMax must be a positive integer of at least passScaled",
    );
  }

  const itemKinds = parseItemKinds(ownField(record, "itemKinds"));
  if (!itemKinds.ok) return itemKinds;

  return ok({
    minutes,
    passScaled,
    scaleMax,
    itemKinds: itemKinds.value,
  });
}

/** An optional array of 1..max distinct strings; `undefined` when absent. */
function parseExternal(
  value: unknown,
  label: string,
): Parsed<readonly string[] | undefined> {
  if (value === undefined) return ok(undefined);
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_EXTERNAL
  ) {
    return fail(
      `${label} external must be an array of 1 to ${String(MAX_EXTERNAL)} items`,
    );
  }
  const items: string[] = [];
  for (const item of value as readonly unknown[]) {
    const text = parseText(item, `${label} external item`, MAX_EXTERNAL_LENGTH);
    if (!text.ok) return text;
    if (items.includes(text.value)) {
      return fail(`${label} external items must be distinct`);
    }
    items.push(text.value);
  }
  return ok(items);
}

function parseTopics(
  value: unknown,
  label: string,
): Parsed<readonly TopicId[]> {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_TOPICS
  ) {
    return fail(
      `${label} topics must be an array of 1 to ${String(MAX_TOPICS)} topic ids`,
    );
  }
  const topics: TopicId[] = [];
  for (const item of value as readonly unknown[]) {
    const topic = parseTopicId(item);
    if (!topic.ok) return fail(`${label} topics: ${topic.reason}`);
    if (topics.includes(topic.value)) {
      return fail(`${label} topics must be distinct`);
    }
    topics.push(topic.value);
  }
  return ok(topics);
}

function parseObjective(
  value: unknown,
  domainId: string,
  seen: Set<string>,
): Parsed<TrackObjective> {
  const record = asRecord(value);
  if (record === null)
    return fail(`domain ${domainId} objective must be an object`);

  const id = ownField(record, "id");
  if (typeof id !== "string" || !OBJECTIVE_ID_PATTERN.test(id)) {
    return fail(`domain ${domainId} objective id must look like D<n>.<k>`);
  }
  if (!id.startsWith(`${domainId}.`)) {
    return fail(`objective ${id} id must start with its domain ${domainId}`);
  }
  if (seen.has(id)) return fail(`objective ${id} id is duplicated`);
  seen.add(id);

  const label = `objective ${id}`;
  const rawRef = ownField(record, "officialRef");
  const officialRef =
    rawRef === undefined
      ? undefined
      : parseText(rawRef, `${label} officialRef`, MAX_REF_LENGTH);
  if (officialRef !== undefined && !officialRef.ok) return officialRef;

  const summary = parseText(
    ownField(record, "summary"),
    `${label} summary`,
    MAX_OBJECTIVE_SUMMARY_LENGTH,
  );
  if (!summary.ok) return summary;

  const topics = parseTopics(ownField(record, "topics"), label);
  if (!topics.ok) return topics;

  const external = parseExternal(ownField(record, "external"), label);
  if (!external.ok) return external;

  return ok({
    id,
    ...(officialRef !== undefined ? { officialRef: officialRef.value } : {}),
    summary: summary.value,
    topics: topics.value,
    ...(external.value !== undefined ? { external: external.value } : {}),
  });
}

function parseDomain(
  value: unknown,
  seenDomains: Set<string>,
  seenObjectives: Set<string>,
): Parsed<TrackDomain> {
  const record = asRecord(value);
  if (record === null) return fail("track domain must be an object");

  const id = ownField(record, "id");
  if (typeof id !== "string" || !DOMAIN_ID_PATTERN.test(id)) {
    return fail("track domain id must look like D<n>");
  }
  if (seenDomains.has(id)) return fail(`domain ${id} id is duplicated`);
  seenDomains.add(id);

  const name = parseText(
    ownField(record, "name"),
    `domain ${id} name`,
    MAX_TITLE_LENGTH,
  );
  if (!name.ok) return name;

  const weight = ownField(record, "weight");
  if (!isIntegerIn(weight, 1, TOTAL_WEIGHT)) {
    return fail(
      `domain ${id} weight must be an integer from 1 to ${String(TOTAL_WEIGHT)}`,
    );
  }

  const rawObjectives = ownField(record, "objectives");
  if (
    !Array.isArray(rawObjectives) ||
    rawObjectives.length === 0 ||
    rawObjectives.length > MAX_OBJECTIVES
  ) {
    return fail(
      `domain ${id} objectives must be an array of 1 to ${String(MAX_OBJECTIVES)} items`,
    );
  }
  const objectives: TrackObjective[] = [];
  for (const item of rawObjectives as readonly unknown[]) {
    const objective = parseObjective(item, id, seenObjectives);
    if (!objective.ok) return objective;
    objectives.push(objective.value);
  }

  return ok({
    id,
    name: name.value,
    weight,
    objectives,
  });
}

function parseDomains(value: unknown): Parsed<readonly TrackDomain[]> {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_DOMAINS
  ) {
    return fail(
      `track domains must be an array of 1 to ${String(MAX_DOMAINS)} items`,
    );
  }
  const seenDomains = new Set<string>();
  const seenObjectives = new Set<string>();
  const domains: TrackDomain[] = [];
  let total = 0;
  for (const item of value as readonly unknown[]) {
    const domain = parseDomain(item, seenDomains, seenObjectives);
    if (!domain.ok) return domain;
    domains.push(domain.value);
    total += domain.value.weight;
  }
  if (total !== TOTAL_WEIGHT) {
    return fail(`track domain weights must sum to ${String(TOTAL_WEIGHT)}`);
  }
  return ok(domains);
}

function parseScenario(
  value: unknown,
  domainIds: ReadonlySet<string>,
  seen: Set<string>,
): Parsed<TrackScenario> {
  const record = asRecord(value);
  if (record === null) return fail("track scenario must be an object");

  const id = ownField(record, "id");
  if (typeof id !== "string" || !SCENARIO_ID_PATTERN.test(id)) {
    return fail("track scenario id must look like S<n>");
  }
  if (seen.has(id)) return fail(`scenario ${id} id is duplicated`);
  seen.add(id);

  const summary = parseText(
    ownField(record, "summary"),
    `scenario ${id} summary`,
    MAX_SCENARIO_SUMMARY_LENGTH,
  );
  if (!summary.ok) return summary;

  const rawDomains = ownField(record, "domains");
  if (
    !Array.isArray(rawDomains) ||
    rawDomains.length === 0 ||
    rawDomains.length > MAX_DOMAINS
  ) {
    return fail(
      `scenario ${id} domains must be an array of 1 to ${String(MAX_DOMAINS)} domain ids`,
    );
  }
  const domains: string[] = [];
  for (const item of rawDomains as readonly unknown[]) {
    if (typeof item !== "string" || !DOMAIN_ID_PATTERN.test(item)) {
      return fail(`scenario ${id} domains must hold domain ids`);
    }
    if (!domainIds.has(item)) {
      return fail(`scenario ${id} names unknown domain ${item}`);
    }
    if (domains.includes(item)) {
      return fail(`scenario ${id} domains must be distinct`);
    }
    domains.push(item);
  }

  return ok({ id, summary: summary.value, domains });
}

function parseScenarios(
  value: unknown,
  domains: readonly TrackDomain[],
): Parsed<readonly TrackScenario[]> {
  if (value === undefined) return ok([]);
  if (!Array.isArray(value) || value.length > MAX_SCENARIOS) {
    return fail(
      `track scenarios must be an array of at most ${String(MAX_SCENARIOS)} items`,
    );
  }
  const domainIds = new Set(domains.map((domain) => domain.id));
  const seen = new Set<string>();
  const scenarios: TrackScenario[] = [];
  for (const item of value as readonly unknown[]) {
    const scenario = parseScenario(item, domainIds, seen);
    if (!scenario.ok) return scenario;
    scenarios.push(scenario.value);
  }
  return ok(scenarios);
}

/**
 * Validates one track document (the parsed JSON of `data/tracks/<code>.json`).
 * Each field is read once from an own property; extra keys are ignored and
 * not copied. Beyond per-field shape checks it enforces integer domain
 * weights summing to 100, unique domain, objective and scenario ids, objective
 * ids prefixed by their domain id, scenarios naming only declared domains,
 * real ISO dates, and an `https:` guide URL. It does not check topics against
 * the catalog; see {@link checkTrackAgainstCatalog}.
 *
 * @param value - Untrusted input.
 * @returns A fresh {@link Track}, or a reason naming the bad field. The reason
 * names validated ids only, never a raw input value.
 *
 * @example
 * ```ts
 * import { parseTrack } from "./tracks.ts";
 * const r = parseTrack(JSON.parse('{"schemaVersion":2}'));
 * if (!r.ok) console.error(r.reason); // names schemaVersion
 * ```
 */
export function parseTrack(value: unknown): Parsed<Track> {
  const record = asRecord(value);
  if (record === null) return fail("track must be an object");

  if (ownField(record, "schemaVersion") !== 1) {
    return fail("track schemaVersion must be 1");
  }

  const code = ownField(record, "code");
  if (typeof code !== "string" || !CODE_PATTERN.test(code)) {
    return fail("track code must look like CCAR-F");
  }

  const title = parseText(
    ownField(record, "title"),
    "track title",
    MAX_TITLE_LENGTH,
  );
  if (!title.ok) return title;

  const tier = ownField(record, "tier");
  if (!isMember(TRACK_TIERS, tier)) return fail("track tier is invalid");

  const assumes = ownField(record, "assumes");
  if (
    assumes !== null &&
    (typeof assumes !== "string" || !CODE_PATTERN.test(assumes))
  ) {
    return fail("track assumes must be null or a track code");
  }
  if (assumes === code) return fail("track assumes must not name itself");

  const guide = parseGuide(ownField(record, "guide"));
  if (!guide.ok) return guide;

  const format = parseFormat(ownField(record, "format"));
  if (!format.ok) return format;

  const domains = parseDomains(ownField(record, "domains"));
  if (!domains.ok) return domains;

  const scenarios = parseScenarios(
    ownField(record, "scenarios"),
    domains.value,
  );
  if (!scenarios.ok) return scenarios;

  return ok({
    schemaVersion: 1,
    code,
    title: title.value,
    tier,
    assumes,
    guide: guide.value,
    format: format.value,
    scenarios: scenarios.value,
    domains: domains.value,
  });
}

/**
 * The result of {@link checkTrackAgainstCatalog}: both lists deduplicated
 * and sorted, both empty for a clean track. Fresh arrays the caller owns,
 * so not `readonly`.
 *
 * @example
 * ```ts
 * import type { TrackCatalogCheck } from "./tracks.ts";
 * const clean: TrackCatalogCheck = { unknownTopics: [], disabledObjectives: [] };
 * ```
 */
export interface TrackCatalogCheck {
  /** Topic ids no catalog entry has. */
  unknownTopics: string[];
  /** Ids of objectives with no known, enabled topic. */
  disabledObjectives: string[];
}

/**
 * Cross-checks a track's topic mapping against a catalog. A topic is
 * unknown when no catalog entry has its id; an objective is disabled when
 * none of its topics is a known, enabled entry (so it could never be
 * studied). Both lists are deduplicated and sorted.
 *
 * @param track - A validated track.
 * @param catalog - The catalog to check against (usually the merged one).
 * @returns The unknown topic ids and the ids of objectives with no enabled
 * topic; both empty for a clean track.
 *
 * @example
 * ```ts
 * import { loadBundledCatalog } from "./bundled-catalog.ts";
 * import { loadBundledTracks } from "./bundled-tracks.ts";
 * import { checkTrackAgainstCatalog } from "./tracks.ts";
 * const catalog = await loadBundledCatalog();
 * for (const track of loadBundledTracks()) {
 *   const { unknownTopics } = checkTrackAgainstCatalog(track, catalog);
 *   if (unknownTopics.length > 0) console.warn(track.code, unknownTopics);
 * }
 * ```
 */
export function checkTrackAgainstCatalog(
  track: Track,
  catalog: readonly CatalogEntry[],
): TrackCatalogCheck {
  const enabledById = new Map<string, boolean>(
    catalog.map((entry) => [entry.id, entry.enabled]),
  );
  const unknown = new Set<string>();
  const disabled = new Set<string>();
  for (const domain of track.domains) {
    for (const objective of domain.objectives) {
      let anyEnabled = false;
      for (const topic of objective.topics) {
        const enabled = enabledById.get(topic);
        if (enabled === undefined) unknown.add(topic);
        else if (enabled) anyEnabled = true;
      }
      if (!anyEnabled) disabled.add(objective.id);
    }
  }
  return {
    unknownTopics: [...unknown].sort(),
    disabledObjectives: [...disabled].sort(),
  };
}
