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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

describe("bundled tracks (data/tracks)", () => {
  test("the bundled track codes are exactly CCAR-F, CCAR-P, CCDV-F and CCDV-P, in load order", () => {
    expect(tracks.map((t) => t.code)).toEqual([
      "CCAR-F",
      "CCAR-P",
      "CCDV-F",
      "CCDV-P",
    ]);
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

  test("CCAR-P pins", () => {
    const t = track("CCAR-P");
    expect(t.tier).toBe("professional");
    expect(t.assumes).toBe("CCAR-F");
    expect(t.domains.map((d) => d.weight)).toEqual([18, 13, 21, 17, 16, 7, 8]);
    expect(objectivesOf(t)).toHaveLength(39);
    expect(t.scenarios).toEqual([]);
    expect(t.guide.version).toBe("1.1");
    expect(t.guide.effective).toBe("2026-12-07");
  });

  test("CCDV-P pins", () => {
    const t = track("CCDV-P");
    expect(t.tier).toBe("professional");
    expect(t.assumes).toBe("CCDV-F");
    expect(t.domains.map((d) => d.weight)).toEqual([
      17, 20, 12, 10, 12, 8, 11, 10,
    ]);
    expect(objectivesOf(t)).toHaveLength(25);
    expect(t.scenarios).toEqual([]);
    expect(t.guide.version).toBe("1.0");
    expect(t.guide.effective).toBe("2026-11");
  });

  test.each(["CCAR-F", "CCAR-P", "CCDV-F", "CCDV-P"])(
    "%s shared pins",
    (code) => {
      const t = track(code);
      expect(t.format).toEqual({
        minutes: 120,
        passScaled: 720,
        scaleMax: 1000,
        itemKinds: ["single", "multiple"],
      });
      if (code.endsWith("-F")) {
        expect(t.tier).toBe("foundations");
        expect(t.assumes).toBeNull();
      }
      expect(t.guide.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(t.guide.reviewedAt))).toBe(false);
    },
  );

  test("every Professional track assumes a bundled Foundations track", () => {
    const pro = tracks.filter((t) => t.tier === "professional");
    expect(pro.map((t) => t.code)).toEqual(["CCAR-P", "CCDV-P"]);
    for (const t of pro) {
      const assumed = tracks.find((x) => x.code === t.assumes);
      expect(assumed?.tier, `${t.code} assumes`).toBe("foundations");
    }
  });

  test("CCDV-P D7.2 names these frameworks", () => {
    const o = objectivesOf(track("CCDV-P")).find((x) => x.id === "D7.2");
    expect(o?.external).toEqual([
      "OWASP Top 10 for LLM Applications",
      "NIST AI Risk Management Framework",
      "NIST AI RMF Generative AI Profile",
    ]);
  });

  test("no objective with external frameworks maps ai-risk-and-bias", () => {
    for (const t of tracks) {
      for (const o of objectivesOf(t)) {
        if (o.external === undefined) continue;
        expect(
          o.topics as readonly string[],
          `${t.code} ${o.id}`,
        ).not.toContain("ai-risk-and-bias");
      }
    }
  });

  test("frameworks named in external are never taught by a catalog topic", () => {
    const external = tracks.flatMap((t) =>
      objectivesOf(t).flatMap((o) => o.external ?? []),
    );
    expect(external.length).toBeGreaterThan(0);
    const tokens = [
      "owasp",
      "nist",
      "ai rmf",
      "llm top 10",
      ...external.map((n) => n.toLowerCase()),
    ];
    for (const e of catalog) {
      const haystack = [e.id, e.title, ...e.keywords].join("\n").toLowerCase();
      for (const token of tokens) {
        const named = new RegExp(`\\b${escapeRegExp(token)}\\b`, "u");
        expect(named.test(haystack), `${e.id} names ${token}`).toBe(false);
      }
    }
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
