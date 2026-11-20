import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { loadBundledTracks } from "../../src/internal/bundled-tracks.ts";
import { checkTrackAgainstCatalog } from "../../src/internal/tracks.ts";
import { loadBundledCatalog } from "../../src/internal/bundled-catalog.ts";
import {
  DAY,
  makeSandbox,
  readJson,
  run,
  runOk,
  type Sandbox,
} from "./helpers.ts";
import { realCtx } from "./exam-helpers.ts";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

const TRACKS_USAGE = "usage: mentor-state tracks\n";
const SET_TRACK_USAGE =
  "usage: mentor-state set-track --code <code> | --clear\n";

interface TrackRow {
  code: string;
  title: string;
  tier: string;
  assumes: string | null;
  guide: {
    version: string;
    effective: string;
    sourceUrl: string;
    reviewedAt: string;
  };
  effectiveFuture: boolean;
  reviewStale: boolean;
  domains: { id: string; name: string; weight: number; objectives: number }[];
  unknownTopics: string[];
  disabledObjectives: string[];
}
interface TracksOut {
  active: string | null;
  tracks: TrackRow[];
}

const tracksOut = async (overrides = {}): Promise<TracksOut> =>
  (await runOk(sb.dir, ["tracks"], await realCtx(overrides))) as TracksOut;

/** First instant of an `effective` value ('YYYY-MM' or 'YYYY-MM-DD'), UTC. */
function effectiveMs(effective: string): number {
  return Date.parse(effective.length === 7 ? `${effective}-01` : effective);
}

describe("tracks", () => {
  test("lists the four bundled tracks in code order with no active track", async () => {
    const out = await tracksOut();
    expect(out.active).toBeNull();
    expect(out.tracks.map((t) => t.code)).toEqual([
      "CCAR-F",
      "CCAR-P",
      "CCDV-F",
      "CCDV-P",
    ]);
  });

  test("each row mirrors the bundled track file", async () => {
    const out = await tracksOut();
    const catalog = await loadBundledCatalog();
    for (const track of loadBundledTracks()) {
      const row = out.tracks.find((t) => t.code === track.code);
      expect(row, track.code).toBeDefined();
      expect(row).toMatchObject({
        code: track.code,
        title: track.title,
        tier: track.tier,
        assumes: track.assumes,
        guide: track.guide,
        domains: track.domains.map((d) => ({
          id: d.id,
          name: d.name,
          weight: d.weight,
          objectives: d.objectives.length,
        })),
        ...checkTrackAgainstCatalog(track, catalog),
      });
      expect(Object.keys(row ?? {}).sort()).toEqual(
        [
          "code",
          "title",
          "tier",
          "assumes",
          "guide",
          "effectiveFuture",
          "reviewStale",
          "domains",
          "unknownTopics",
          "disabledObjectives",
        ].sort(),
      );
    }
  });

  test("hand-pinned: CCAR-F domain weights and objective counts", async () => {
    const row = (await tracksOut()).tracks.find((t) => t.code === "CCAR-F");
    expect(row?.domains.map((d) => [d.id, d.weight, d.objectives])).toEqual([
      ["D1", 27, 7],
      ["D2", 18, 5],
      ["D3", 20, 6],
      ["D4", 20, 6],
      ["D5", 15, 6],
    ]);
    expect(row?.tier).toBe("foundations");
    expect(row?.assumes).toBeNull();
  });

  test("active reflects state.activeTrack", async () => {
    await runOk(sb.dir, ["set-track", "--code", "CCDV-F"]);
    expect((await tracksOut()).active).toBe("CCDV-F");
  });

  test("effectiveFuture is strictly 'effective is after now' (YYYY-MM and YYYY-MM-DD)", async () => {
    for (const track of loadBundledTracks()) {
      const eff = effectiveMs(track.guide.effective);
      for (const [now, expected] of [
        [eff - 1, true],
        [eff, false],
        [eff + 1, false],
      ] as const) {
        const row = (await tracksOut({ now })).tracks.find(
          (t) => t.code === track.code,
        );
        expect(row?.effectiveFuture, `${track.code} at ${String(now)}`).toBe(
          expected,
        );
      }
    }
  });

  test("hand-pinned: CCAR-F 'effective 2026-11' starts 2026-11-01 UTC", async () => {
    const find = async (now: number): Promise<boolean | undefined> =>
      (await tracksOut({ now })).tracks.find((t) => t.code === "CCAR-F")
        ?.effectiveFuture;
    expect(await find(Date.UTC(2026, 9, 31, 23, 59, 59))).toBe(true);
    expect(await find(Date.UTC(2026, 10, 1))).toBe(false);
  });

  test("reviewStale flips just past 120 days after reviewedAt (UTC midnight)", async () => {
    for (const track of loadBundledTracks()) {
      const reviewed = Date.parse(track.guide.reviewedAt);
      for (const [now, expected] of [
        [reviewed, false],
        [reviewed + 120 * DAY, false],
        [reviewed + 120 * DAY + 1, true],
      ] as const) {
        const row = (await tracksOut({ now })).tracks.find(
          (t) => t.code === track.code,
        );
        expect(row?.reviewStale, `${track.code} at ${String(now)}`).toBe(
          expected,
        );
      }
    }
  });

  test("disabling the only topic of an objective lists it as disabled", async () => {
    // CCDV-F D7.3 maps exactly one topic: api-key-handling.
    const before = (await tracksOut()).tracks.find((t) => t.code === "CCDV-F");
    expect(before?.disabledObjectives).not.toContain("D7.3");
    await runOk(
      sb.dir,
      [
        "set-topic-override",
        "--topic",
        "api-key-handling",
        "--enabled",
        "false",
      ],
      await realCtx(),
    );
    const after = (await tracksOut()).tracks.find((t) => t.code === "CCDV-F");
    expect(after?.disabledObjectives).toContain("D7.3");
  });

  test("an argument is a usage error", async () => {
    const result = await run(sb.dir, ["tracks", "extra"], await realCtx());
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe(TRACKS_USAGE);
  });
});

describe("set-track", () => {
  const state = (): Record<string, unknown> =>
    readJson(sb.dir, "state.json") as Record<string, unknown>;

  test("--code sets the active track and persists it", async () => {
    expect(
      await runOk(sb.dir, ["set-track", "--code", "CCAR-F"], await realCtx()),
    ).toEqual({ active: "CCAR-F" });
    expect(state()["activeTrack"]).toBe("CCAR-F");
  });

  test("preserves every other state field", async () => {
    await runOk(sb.dir, ["set-mute", "on"]);
    await runOk(sb.dir, ["exclude-project", "add", "--path", "/work/a"]);
    await runOk(sb.dir, ["set-track", "--code", "CCAR-P"], await realCtx());
    expect(state()).toMatchObject({
      muted: true,
      excludedProjects: ["/work/a"],
      activeTrack: "CCAR-P",
    });
  });

  test("--clear removes the field entirely and keeps other state", async () => {
    await runOk(sb.dir, ["set-mute", "on"]);
    await runOk(sb.dir, ["set-track", "--code", "CCAR-F"], await realCtx());
    expect(
      await runOk(sb.dir, ["set-track", "--clear"], await realCtx()),
    ).toEqual({ active: null });
    expect(Object.hasOwn(state(), "activeTrack")).toBe(false);
    expect(state()["muted"]).toBe(true);
  });

  test("a well-formed but unbundled code is VALIDATION_FAILED (exit 1) and writes nothing", async () => {
    const result = await run(
      sb.dir,
      ["set-track", "--code", "CCXX-F"],
      await realCtx(),
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^VALIDATION_FAILED: /);
    expect((await tracksOut()).active).toBeNull();
  });

  test.each([
    ["neither flag", ["set-track"]],
    ["both flags", ["set-track", "--code", "CCAR-F", "--clear"]],
    ["malformed code", ["set-track", "--code", "lowercase"]],
    ["extra positional", ["set-track", "--clear", "extra"]],
  ])("%s -> usage error, exit 2", async (_name, argv) => {
    const result = await run(sb.dir, argv, await realCtx());
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(SET_TRACK_USAGE);
  });
});

describe("get-profile active-track topics", () => {
  const profile = async (): Promise<{
    activeTrack: string | null;
    activeTrackTopics: Record<string, number>;
  }> =>
    (await runOk(sb.dir, ["get-profile"], await realCtx())) as {
      activeTrack: string | null;
      activeTrackTopics: Record<string, number>;
    };

  test("no active track -> null and {}", async () => {
    const out = await profile();
    expect(out.activeTrack).toBeNull();
    expect(out.activeTrackTopics).toEqual({});
  });

  test("hand-computed CCDV-F weights: domain weight / objectives-in-domain, summed per topic", async () => {
    await runOk(sb.dir, ["set-track", "--code", "CCDV-F"], await realCtx());
    const out = await profile();
    expect(out.activeTrack).toBe("CCDV-F");
    const w = out.activeTrackTopics;
    // api-key-handling: only D7.3 (D7 weight 8, 3 objectives) -> 8/3.
    expect(w["api-key-handling"]).toBe(2.67);
    // streaming-events: only D2.4 (D2 weight 20, 4 objectives) -> 5.
    expect(w["streaming-events"]).toBe(5);
    // verify-your-work: only D4.1 (D4 weight 10, 2 objectives) -> 5.
    expect(w["verify-your-work"]).toBe(5);
    // hooks: D1.2 (17/3) + D3.2 (8/2) + D7.2 (8/3) = 12.333...
    expect(w["hooks"]).toBe(12.33);
    // messages-api: D2.1 + D2.2 + D2.4, each 20/4 = 15.
    expect(w["messages-api"]).toBe(15);
  });

  test("every mapped topic matches an independent computation; foreign topics are absent; sum covers the track total", async () => {
    await runOk(sb.dir, ["set-track", "--code", "CCDV-F"], await realCtx());
    const w = (await profile()).activeTrackTopics;
    const track = loadBundledTracks().find((t) => t.code === "CCDV-F");
    if (track === undefined) throw new Error("CCDV-F missing");
    const expected = new Map<string, number>();
    for (const d of track.domains) {
      for (const o of d.objectives) {
        for (const t of o.topics) {
          expected.set(
            t,
            (expected.get(t) ?? 0) + d.weight / d.objectives.length,
          );
        }
      }
    }
    expect(Object.keys(w).sort()).toEqual([...expected.keys()].sort());
    for (const [topic, value] of expected) {
      expect(w[topic], topic).toBeCloseTo(value, 2);
    }
    expect(w["plan-mode"]).toBeUndefined();
    expect(Object.values(w).reduce((s, v) => s + v, 0)).toBeGreaterThanOrEqual(
      100,
    );
  });

  test("clearing the track returns to null and {}", async () => {
    await runOk(sb.dir, ["set-track", "--code", "CCDV-F"], await realCtx());
    await runOk(sb.dir, ["set-track", "--clear"], await realCtx());
    const out = await profile();
    expect(out.activeTrack).toBeNull();
    expect(out.activeTrackTopics).toEqual({});
  });
});
