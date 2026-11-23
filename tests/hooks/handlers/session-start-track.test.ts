import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { sessionStartHandler } from "../../../src/hooks/handlers/session-start.ts";
import { loadBundledTracks } from "../../../src/internal/bundled-tracks.ts";
import type { CatalogEntry } from "../../../src/internal/schema.ts";
import { levelRank } from "../../../src/internal/schema.ts";
import { saveGoals } from "../../../src/internal/store.ts";
import {
  CATALOG,
  makeDeps,
  makeSandbox,
  payload,
  seedProfile,
  seedState,
  settingsWith,
  type Sandbox,
} from "./helpers.ts";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

const CODE = "CCAR-F";
const EXAM_LINE = `Exam track: ${CODE}, try /m3l-mentor:exam ${CODE} drill`;

/** Topic id -> exam weight for the track (each objective's share split over its topics, in full). */
function weights(code: string): Map<string, number> {
  const track = loadBundledTracks().find((t) => t.code === code);
  if (track === undefined) throw new Error(`no bundled track ${code}`);
  const sums = new Map<string, number>();
  for (const domain of track.domains) {
    const share = domain.weight / domain.objectives.length;
    for (const objective of domain.objectives) {
      for (const topic of objective.topics) {
        sums.set(topic, (sums.get(topic) ?? 0) + share);
      }
    }
  }
  return new Map(
    [...sums].map(([topic, sum]) => [topic, Math.round(sum * 100) / 100]),
  );
}

const WEIGHTS = weights(CODE);
const inCatalog = (e: CatalogEntry): boolean => WEIGHTS.has(e.id);
/** Track entries ordered by weight descending, then catalog order (sort is stable). */
const TRACK_ORDER = CATALOG.filter((e) => e.enabled && inCatalog(e)).sort(
  (a, b) => (WEIGHTS.get(b.id) ?? 0) - (WEIGHTS.get(a.id) ?? 0),
);
const NON_TRACK = CATALOG.filter(
  (e) => e.enabled && e.ambient !== false && !inCatalog(e),
);

async function text(
  deps = makeDeps(sb.dir),
  extra: Record<string, unknown> = {},
): Promise<string> {
  const out = await sessionStartHandler(payload(extra), deps);
  return out?.hookSpecificOutput?.additionalContext ?? "";
}

const rows = (t: string): string[] =>
  t.split("\n").filter((l) => l.includes(" (target "));
const rowId = (row: string): string => row.split(":")[0] ?? "";
const reviews = (t: string): string[] =>
  t
    .split("\n")
    .filter((l) => l.startsWith("review due: "))
    .map((l) => l.slice("review due: ".length));

describe("fixture sanity", () => {
  test("the track maps ambient:false catalog topics, and more than 8 topics", () => {
    expect(TRACK_ORDER.some((e) => e.ambient === false)).toBe(true);
    expect(TRACK_ORDER.length).toBeGreaterThan(8);
    expect(NON_TRACK.length).toBeGreaterThan(0);
  });
});

describe("SessionStart with an active exam track: Exam line", () => {
  test("the head carries the fixed Exam line, before the topic lines", async () => {
    await seedState(sb.dir, { activeTrack: CODE });
    const lines = (await text()).split("\n");
    const at = lines.indexOf(EXAM_LINE);
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(lines.indexOf("topics below target:"));
  });

  test("the line survives the 2,000-char budget and the total stays within it", async () => {
    await seedState(sb.dir, { activeTrack: CODE });
    await saveGoals(sb.dir, "g".repeat(1_000));
    await seedProfile(
      sb.dir,
      Object.fromEntries(
        CATALOG.map((e) => [e.id, { lastPassAt: 0, passes: 1 }]),
      ),
    );
    const t = await text();
    expect(t).toContain(EXAM_LINE);
    expect(t.length).toBeLessThanOrEqual(2_000);
  });

  test("a muted mentor emits nothing, so no Exam line", async () => {
    await seedState(sb.dir, { activeTrack: CODE, muted: true });
    expect(await sessionStartHandler(payload(), makeDeps(sb.dir))).toBeNull();
  });

  test("dial 0 emits nothing, so no Exam line", async () => {
    await seedState(sb.dir, { activeTrack: CODE });
    const out = await sessionStartHandler(
      payload(),
      makeDeps(sb.dir, { settings: settingsWith({ dial: 0 }) }),
    );
    expect(out).toBeNull();
  });
});

describe("SessionStart with an active exam track: ordering", () => {
  test("track topics (ambient:false included) lead, by weight descending then catalog order", async () => {
    await seedState(sb.dir, { activeTrack: CODE });
    const got = rows(await text()).map(rowId);
    expect(got).toEqual(
      TRACK_ORDER.filter((e) => levelRank(e.targetLevel) > 0)
        .map((e) => e.id)
        .slice(0, 8),
    );
  });

  test("a touched non-track topic still comes after every track topic", async () => {
    await seedState(sb.dir, { activeTrack: CODE });
    const outsider = NON_TRACK[0];
    if (outsider === undefined) throw new Error("no non-track topic");
    await seedProfile(sb.dir, {
      [outsider.id]: { introduced: true, level: "Introduced" },
    });
    const got = rows(await text()).map(rowId);
    expect(got).not.toContain(outsider.id);
    expect(got).toHaveLength(8);
  });

  test("when track topics are met, non-track topics keep today's order (touched first)", async () => {
    await seedState(sb.dir, { activeTrack: CODE });
    const touched = NON_TRACK[3];
    if (touched === undefined) throw new Error("catalog too small");
    await seedProfile(sb.dir, {
      ...Object.fromEntries(
        TRACK_ORDER.map((e) => [
          e.id,
          { introduced: true, level: e.targetLevel },
        ]),
      ),
      [touched.id]: { introduced: true, level: "Introduced" },
    });
    const got = rows(await text()).map(rowId);
    expect(got[0]).toBe(touched.id);
    expect(got.every((id) => !inCatalog({ id } as CatalogEntry))).toBe(true);
  });

  test("a muted track topic is excluded", async () => {
    const top = TRACK_ORDER[0];
    if (top === undefined) throw new Error("empty track");
    await seedState(sb.dir, { activeTrack: CODE, mutedTopics: [top.id] });
    expect(rows(await text()).map(rowId)).not.toContain(top.id);
  });

  test("a disabled track topic is excluded", async () => {
    const top = TRACK_ORDER[0];
    if (top === undefined) throw new Error("empty track");
    await seedState(sb.dir, { activeTrack: CODE });
    const catalog = CATALOG.map((e) =>
      e.id === top.id ? { ...e, enabled: false } : e,
    );
    const got = rows(await text(makeDeps(sb.dir, { catalog }))).map(rowId);
    expect(got).not.toContain(top.id);
  });

  test("review due lists track topics first (weight order, ambient:false included), capped at 5", async () => {
    await seedState(sb.dir, { activeTrack: CODE });
    const trackDue = TRACK_ORDER.slice(0, 4);
    const outsiders = NON_TRACK.slice(0, 3);
    await seedProfile(
      sb.dir,
      Object.fromEntries(
        [...outsiders, ...trackDue].map((e) => [
          e.id,
          { introduced: true, lastPassAt: 0, passes: 1 },
        ]),
      ),
    );
    const first = outsiders[0];
    if (first === undefined) throw new Error("no outsider");
    expect(reviews(await text())).toEqual([
      ...trackDue.map((e) => e.id),
      first.id,
    ]);
  });
});

describe("SessionStart without a usable active track is unchanged", () => {
  test.each([
    ["no activeTrack", undefined],
    ["a stored code that is no longer bundled", "ZZZZ-Z"],
  ])(
    "%s: no Exam line, no reordering, ambient:false excluded",
    async (_n, code) => {
      await seedState(sb.dir, code === undefined ? {} : { activeTrack: code });
      const baseline = makeSandbox();
      try {
        await seedState(baseline.dir, {});
        const same = await text();
        expect(same).toBe(await text(makeDeps(baseline.dir)));
        expect(same).not.toContain("Exam track:");
        const got = rows(same).map(rowId);
        expect(got).toEqual(
          CATALOG.filter((e) => e.enabled && e.ambient !== false)
            .filter((e) => levelRank(e.targetLevel) > 0)
            .map((e) => e.id)
            .slice(0, 8),
        );
      } finally {
        baseline.cleanup();
      }
    },
  );
});
