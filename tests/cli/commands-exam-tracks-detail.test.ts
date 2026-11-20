import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { loadBundledTracks } from "../../src/internal/bundled-tracks.ts";
import { makeSandbox, run, runOk, type Sandbox } from "./helpers.ts";
import { realCtx } from "./exam-helpers.ts";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

const TRACKS_USAGE =
  "usage: mentor-state tracks [--code <code> [--domain <id>]]\n";

interface Detail {
  id: string;
  domain: string;
  officialRef?: string;
  summary: string;
  topics: string[];
  external?: string[];
}
interface Row {
  code: string;
  domains: { id: string; objectives: number }[];
  unknownTopics: string[];
  disabledObjectives: string[];
  objectiveDetails?: Detail[];
}
interface Out {
  active: string | null;
  tracks: Row[];
}

const detail = async (args: string[], overrides = {}): Promise<Out> =>
  (await runOk(sb.dir, ["tracks", ...args], await realCtx(overrides))) as Out;

describe("tracks --code", () => {
  test("returns only the requested track, with objectiveDetails", async () => {
    const out = await detail(["--code", "CCDV-F"]);
    expect(out.active).toBeNull();
    expect(out.tracks).toHaveLength(1);
    expect(out.tracks[0]?.code).toBe("CCDV-F");
    expect(Array.isArray(out.tracks[0]?.objectiveDetails)).toBe(true);
  });

  test.each([
    ["CCDV-F", 24],
    ["CCAR-F", 30],
    ["CCAR-P", 39],
    ["CCDV-P", 25],
  ])("%s lists %i objectives, matching the domain totals", async (code, n) => {
    const row = (await detail(["--code", code])).tracks[0];
    expect(row?.objectiveDetails).toHaveLength(n);
    expect(row?.domains.reduce((sum, d) => sum + d.objectives, 0)).toBe(n);
  });

  test("mirrors the bundled track file in track order", async () => {
    for (const track of loadBundledTracks()) {
      const row = (await detail(["--code", track.code])).tracks[0];
      const expected = track.domains.flatMap((domain) =>
        domain.objectives.map((o) => ({ domain: domain.id, o })),
      );
      expect(
        row?.objectiveDetails?.map((d) => d.id),
        track.code,
      ).toEqual(expected.map((e) => e.o.id));
      row?.objectiveDetails?.forEach((d, i) => {
        const e = expected[i];
        expect(d.domain).toBe(e?.domain);
        expect(d.summary).toBe(e?.o.summary);
        expect(d.topics).toEqual([...(e?.o.topics ?? [])]);
        expect(Object.hasOwn(d, "officialRef")).toBe(
          e?.o.officialRef !== undefined,
        );
        expect(Object.hasOwn(d, "external")).toBe(e?.o.external !== undefined);
      });
    }
  });

  test("CCDV-F D7.3 maps api-key-handling and has no officialRef or external", async () => {
    const d = (await detail(["--code", "CCDV-F"])).tracks[0]?.objectiveDetails;
    const o = d?.find((x) => x.id === "D7.3");
    expect(o).toBeDefined();
    expect(o?.domain).toBe("D7");
    expect(o?.topics).toEqual(["api-key-handling"]);
    expect(o?.summary).toMatch(/Anthropic keys/);
    expect(Object.hasOwn(o ?? {}, "officialRef")).toBe(false);
    expect(Object.hasOwn(o ?? {}, "external")).toBe(false);
  });

  test("CCAR-F D1.1 carries officialRef 1.1", async () => {
    const d = (await detail(["--code", "CCAR-F"])).tracks[0]?.objectiveDetails;
    const o = d?.find((x) => x.id === "D1.1");
    expect(o?.officialRef).toBe("1.1");
    expect(o?.domain).toBe("D1");
    expect(o?.topics).toEqual([
      "agentic-loop",
      "agent-sdk",
      "workflow-vs-agent-patterns",
    ]);
    expect(Object.hasOwn(o ?? {}, "external")).toBe(false);
  });

  test("CCDV-P D7.2 carries the three external framework names", async () => {
    const d = (await detail(["--code", "CCDV-P"])).tracks[0]?.objectiveDetails;
    const o = d?.find((x) => x.id === "D7.2");
    expect(o?.external).toEqual([
      "OWASP Top 10 for LLM Applications",
      "NIST AI Risk Management Framework",
      "NIST AI RMF Generative AI Profile",
    ]);
    expect(Object.hasOwn(o ?? {}, "officialRef")).toBe(false);
  });

  test("still computes disabledObjectives against the merged catalog", async () => {
    const set = await run(
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
    expect(set.exitCode).toBe(0);
    const row = (await detail(["--code", "CCDV-F"])).tracks[0];
    expect(row?.disabledObjectives).toContain("D7.3");
    expect(row?.unknownTopics).toEqual([]);
  });

  test("the track fields other than objectiveDetails match the plain listing", async () => {
    const plain = (await detail([])).tracks.find((t) => t.code === "CCAR-P");
    const { objectiveDetails: _d, ...rest } = (
      await detail(["--code", "CCAR-P"])
    ).tracks[0] as Row;
    expect(rest).toEqual(plain);
  });
});

describe("tracks --code --domain", () => {
  test("CCDV-F --domain D7 returns exactly D7.1 to D7.3", async () => {
    const row = (await detail(["--code", "CCDV-F", "--domain", "D7"]))
      .tracks[0];
    expect(row?.objectiveDetails?.map((d) => d.id)).toEqual([
      "D7.1",
      "D7.2",
      "D7.3",
    ]);
    expect(row?.objectiveDetails?.every((d) => d.domain === "D7")).toBe(true);
  });

  test("leaves the track's other fields unchanged", async () => {
    const full = (await detail(["--code", "CCDV-F"])).tracks[0] as Row;
    const part = (await detail(["--code", "CCDV-F", "--domain", "D7"]))
      .tracks[0] as Row;
    expect({ ...part, objectiveDetails: undefined }).toEqual({
      ...full,
      objectiveDetails: undefined,
    });
    expect(part.domains).toEqual(full.domains);
  });
});

describe("tracks flag errors", () => {
  test.each([
    ["--domain without --code", ["--domain", "D7"]],
    ["malformed --code", ["--code", "nope"]],
    ["malformed --domain", ["--code", "CCDV-F", "--domain", "7"]],
    ["lowercase --domain", ["--code", "CCDV-F", "--domain", "d7"]],
    ["zero --domain", ["--code", "CCDV-F", "--domain", "D0"]],
    ["three-digit --domain", ["--code", "CCDV-F", "--domain", "D100"]],
  ])("%s is a usage error", async (_name, args) => {
    const result = await run(sb.dir, ["tracks", ...args], await realCtx());
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe(TRACKS_USAGE);
  });

  test("a well-formed code that is not bundled is VALIDATION_FAILED without echoing it", async () => {
    const result = await run(
      sb.dir,
      ["tracks", "--code", "ZZZZ-Q"],
      await realCtx(),
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^VALIDATION_FAILED: /);
    expect(result.stderr).not.toContain("ZZZZ-Q");
  });

  test("a well-formed domain the track lacks is VALIDATION_FAILED without echoing it", async () => {
    const result = await run(
      sb.dir,
      ["tracks", "--code", "CCDV-F", "--domain", "D99"],
      await realCtx(),
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^VALIDATION_FAILED: /);
    expect(result.stderr).not.toContain("D99");
  });
});

describe("tracks without flags", () => {
  test("adds no objectiveDetails key to any track", async () => {
    const out = await detail([]);
    expect(out.tracks).toHaveLength(4);
    for (const row of out.tracks) {
      expect(Object.hasOwn(row, "objectiveDetails")).toBe(false);
    }
  });
});
