import { describe, expect, test } from "vitest";
import { loadBundledCatalog } from "../../src/internal/bundled-catalog.ts";
import { loadBundledTracks } from "../../src/internal/bundled-tracks.ts";
import { checkTrackAgainstCatalog } from "../../src/internal/tracks.ts";

const tracks = loadBundledTracks();
const catalog = await loadBundledCatalog();
const byId = new Map(catalog.map((e) => [e.id as string, e]));

describe("bundled tracks (data/tracks)", () => {
  // No data/tracks/ exists yet, so the set is empty and this skips. Phase 2
  // must replace the skip with a non-empty assertion once tracks ship.
  test.skipIf(tracks.length === 0)(
    "every bundled track satisfies the data invariants",
    () => {
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
    },
  );
});
