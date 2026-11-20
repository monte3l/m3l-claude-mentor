import { describe, expect, test } from "vitest";
import { loadBundledCatalog } from "../../src/internal/bundled-catalog.ts";
import { loadBundledTracks } from "../../src/internal/bundled-tracks.ts";
import {
  checkTrackAgainstCatalog,
  type Track,
} from "../../src/internal/tracks.ts";

const tracks = loadBundledTracks();
const catalog = await loadBundledCatalog();
const byId = new Map(catalog.map((e) => [e.id as string, e]));

describe("bundled tracks (data/tracks)", () => {
  test("the bundled track codes are exactly CCAR-F and CCDV-F, in load order", () => {
    expect(tracks.map((t) => t.code)).toEqual(["CCAR-F", "CCDV-F"]);
  });

  test("every bundled track satisfies the data invariants", () => {
    const codes = new Set(tracks.map((t) => t.code));
    expect(codes.size).toBe(tracks.length);
    for (const track of tracks) {
      const label = track.code;
      const total = track.domains.reduce((s, d) => s + d.weight, 0);
      expect(total, `${label} weights`).toBe(100);

      const check = checkTrackAgainstCatalog(track, catalog);
      expect(check.unknownTopics, `${label} unknown topics`).toEqual([]);
      expect(check.disabledObjectives, `${label} disabled`).toEqual([]);

      for (const domain of track.domains) {
        for (const objective of domain.objectives) {
          const where = `${label} ${objective.id}`;
          expect(objective.topics.length, where).toBeGreaterThanOrEqual(1);
          for (const topic of objective.topics) {
            expect(byId.get(topic)?.enabled, `${where} ${topic}`).toBe(true);
          }
          const onlyFastMoving = objective.topics.every(
            (topic) => byId.get(topic)?.type === "fast-moving",
          );
          expect(onlyFastMoving, `${where} only fast-moving`).toBe(false);
        }
      }

      if (track.assumes !== null) {
        expect(codes.has(track.assumes), `${label} assumes`).toBe(true);
      }
    }
  });

  function track(code: string): Track {
    const found = tracks.find((t) => t.code === code);
    if (found === undefined) throw new Error(`track ${code} not bundled`);
    return found;
  }

  function objectivesOf(
    t: Track,
  ): readonly Track["domains"][number]["objectives"][number][] {
    return t.domains.flatMap((d) => d.objectives);
  }

  test("CCDV-F pins", () => {
    const t = track("CCDV-F");
    expect(t.domains.map((d) => d.weight)).toEqual([
      17, 20, 8, 10, 12, 15, 8, 10,
    ]);
    expect(objectivesOf(t)).toHaveLength(24);
    expect(t.scenarios).toEqual([]);
    expect(t.guide.version).toBe("1.1");
    expect(t.guide.effective).toBe("2026-12-07");
  });

  test("CCAR-F pins", () => {
    const t = track("CCAR-F");
    expect(t.domains.map((d) => d.weight)).toEqual([27, 18, 20, 20, 15]);
    expect(objectivesOf(t)).toHaveLength(30);
    expect(t.scenarios.map((x) => x.id)).toEqual([
      "S1",
      "S2",
      "S3",
      "S4",
      "S5",
      "S6",
    ]);
    for (const sc of t.scenarios) {
      expect(sc.domains.length, sc.id).toBeGreaterThanOrEqual(1);
    }
    expect(t.guide.version).toBe("1.1");
    expect(t.guide.effective).toBe("2026-11");
    for (const o of objectivesOf(t)) {
      expect(o.officialRef, o.id).toBe(o.id.replace(/^D/, ""));
    }
  });

  test.each(["CCAR-F", "CCDV-F"])("%s shared pins", (code) => {
    const t = track(code);
    expect(t.format).toEqual({
      minutes: 120,
      passScaled: 720,
      scaleMax: 1000,
      itemKinds: ["single", "multiple"],
    });
    expect(t.tier).toBe("foundations");
    expect(t.assumes).toBeNull();
    expect(t.guide.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(t.guide.reviewedAt))).toBe(false);
  });

  test("every ambient:false topic is mapped by some bundled objective", () => {
    const mapped = new Set<string>(
      tracks.flatMap((t) =>
        objectivesOf(t).flatMap((o) => o.topics as readonly string[]),
      ),
    );
    const orphans = catalog
      .filter((e) => e.ambient === false && !mapped.has(e.id))
      .map((e) => e.id);
    expect(orphans).toEqual([]);
  });

  test("objective summaries fit 140 characters and contain no double quotes or the phrase 'sample question'", () => {
    for (const t of tracks) {
      for (const o of objectivesOf(t)) {
        const where = `${t.code} ${o.id}`;
        expect(o.summary.length, where).toBeLessThanOrEqual(140);
        expect(o.summary, where).not.toContain('"');
        expect(o.summary.toLowerCase(), where).not.toContain("sample question");
      }
    }
  });
});
