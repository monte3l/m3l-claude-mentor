import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  matchTopics,
  mergeCatalog,
  isUnprompted,
  parseCatalog,
  parseUserCatalog,
} from "../../src/internal/catalog.ts";
import type { CatalogEntry } from "../../src/internal/schema.ts";

function raw(
  id: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    title: `Title ${id}`,
    type: "concept",
    dependencies: [],
    keywords: [],
    targetLevel: "Understood",
    enabled: true,
    ...extra,
  };
}

function parsed(id: string, extra: Record<string, unknown> = {}): CatalogEntry {
  const r = parseCatalog([raw(id, extra)]);
  if (!r.ok) throw new Error(`fixture invalid: ${r.reason}`);
  const [entry] = r.value;
  if (entry === undefined) throw new Error("fixture empty");
  return entry;
}

function ids(entries: readonly CatalogEntry[]): string[] {
  return entries.map((e) => e.id);
}

const ORIGINAL_IDS: readonly string[] = [
  "context-window",
  "compaction",
  "agentic-loop",
  "permissions-model",
  "settings-scopes",
  "mcp",
  "claude-md",
  "slash-commands",
  "plan-mode",
  "skills",
  "subagents",
  "hooks",
  "plugins",
  "output-styles",
  "worktrees",
  "verify-your-work",
  "explore-plan-code",
  "context-hygiene",
  "specific-prompts",
  "review-ai-changes",
  "term-token",
  "term-system-prompt",
  "term-harness",
  "model-names-and-limits",
  "new-features",
];

const FOUNDATIONS_IDS: readonly string[] = [
  "messages-api",
  "streaming-events",
  "prompt-caching",
  "batch-processing",
  "extended-thinking",
  "workflow-vs-agent-patterns",
  "multi-agent-orchestration",
  "session-management",
  "model-selection",
  "generation-mechanics",
  "tool-use-api",
  "structured-output",
  "vision-and-files",
  "agent-sdk",
  "mcp-server-development",
  "claude-code-headless-ci",
  "built-in-tools",
  "tool-design",
  "api-error-handling",
  "prompt-design",
  "few-shot-examples",
  "grounding-and-citations",
  "eval-design",
  "failure-diagnosis",
  "prompt-injection-defense",
  "api-key-handling",
  "human-in-the-loop",
];

const PROFESSIONAL_IDS: readonly string[] = [
  "deployment-surfaces",
  "agent-runtimes",
  "retrieval-architecture",
  "rate-limits-throughput",
  "durable-agent-state",
  "context-editing-and-memory",
  "progressive-discovery",
  "governance-compliance",
  "production-reliability",
  "observability-telemetry",
  "incident-response",
  "online-evaluation",
  "llm-as-judge",
  "cost-latency-optimization",
  "model-migration-and-change-management",
  "agent-threat-defense",
  "enterprise-identity-and-audit",
  "ai-risk-and-bias",
  "stakeholder-communication",
  "org-agent-governance",
  "agent-fleet-operations",
  "guardrail-design",
];

describe("parseCatalog", () => {
  test("preserves input order", () => {
    const r = parseCatalog([
      raw("c"),
      raw("a", { dependencies: ["c"] }),
      raw("b"),
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(ids(r.value)).toEqual(["c", "a", "b"]);
  });

  test("accepts an empty array", () => {
    expect(parseCatalog([])).toEqual({ ok: true, value: [] });
  });

  test.each([
    ["object", {}],
    ["null", null],
    ["string", "x"],
  ])("rejects non-array %s", (_n, v) => {
    expect(parseCatalog(v).ok).toBe(false);
  });

  test("a bad entry reason names its index", () => {
    const r = parseCatalog([raw("a"), raw("b"), raw("Bad Id")]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("2");
  });

  test("rejects duplicate ids", () => {
    expect(parseCatalog([raw("a"), raw("b"), raw("a")]).ok).toBe(false);
  });

  test("rejects an unknown dependency", () => {
    expect(parseCatalog([raw("a", { dependencies: ["ghost"] })]).ok).toBe(
      false,
    );
  });

  test("accepts a diamond (shared dependency, no cycle)", () => {
    const r = parseCatalog([
      raw("a"),
      raw("b", { dependencies: ["a"] }),
      raw("c", { dependencies: ["a"] }),
      raw("d", { dependencies: ["b", "c"] }),
    ]);
    expect(r.ok).toBe(true);
  });

  test("rejects a 2-cycle", () => {
    const r = parseCatalog([
      raw("a", { dependencies: ["b"] }),
      raw("b", { dependencies: ["a"] }),
    ]);
    expect(r.ok).toBe(false);
  });

  test("rejects a longer cycle reachable from an acyclic entry", () => {
    const r = parseCatalog([
      raw("root"),
      raw("a", { dependencies: ["root", "c"] }),
      raw("b", { dependencies: ["a"] }),
      raw("c", { dependencies: ["b"] }),
    ]);
    expect(r.ok).toBe(false);
  });

  test("caps at 500 entries", () => {
    const make = (n: number): Record<string, unknown>[] =>
      Array.from({ length: n }, (_, i) => raw(`t${String(i)}`));
    expect(parseCatalog(make(500)).ok).toBe(true);
    expect(parseCatalog(make(501)).ok).toBe(false);
  });

  test("the shipped catalog parses with the expected shape", () => {
    const text = readFileSync(
      new URL("../../data/topic-catalog.json", import.meta.url),
      "utf8",
    );
    const r = parseCatalog(JSON.parse(text) as unknown);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toHaveLength(74);
    expect(r.value.slice(0, 25).map((e) => e.id as string)).toEqual(
      ORIGINAL_IDS,
    );
    for (const e of r.value.slice(0, 25)) {
      expect(e.ambient, `${e.id} ambient`).toBeUndefined();
    }
    for (const e of r.value.slice(25)) {
      expect(e.enabled, `${e.id} enabled`).toBe(true);
      expect(e.ambient, `${e.id} ambient`).toBe(false);
    }
    expect(r.value.slice(25, 52).map((e) => e.id as string)).toEqual(
      FOUNDATIONS_IDS,
    );
    expect(r.value.slice(52, 74).map((e) => e.id as string)).toEqual(
      PROFESSIONAL_IDS,
    );
    const fast = r.value.filter((e) => e.type === "fast-moving");
    expect(fast.length).toBeGreaterThan(0);
    for (const e of fast) expect(e.targetLevel).toBe("Introduced");
    for (const e of r.value.filter((x) => x.type !== "fast-moving")) {
      expect(e.keywords.length).toBeGreaterThan(0);
    }
  });
});

describe("parseUserCatalog", () => {
  test("missing overrides and custom default to empty", () => {
    const r = parseUserCatalog({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.overrides).toEqual({});
      expect(r.value.custom).toEqual([]);
    }
  });

  test.each([
    ["null", null],
    ["array", []],
    ["string", "x"],
  ])("rejects non-object %s", (_n, v) => {
    expect(parseUserCatalog(v).ok).toBe(false);
  });

  test("accepts valid overrides and custom entries", () => {
    const r = parseUserCatalog({
      overrides: {
        "plan-mode": {
          enabled: false,
          targetLevel: "Applied",
          style: "reference",
          keywords: ["  PLAN "],
        },
      },
      custom: [raw("mine")],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.overrides["plan-mode"]).toEqual({
        enabled: false,
        targetLevel: "Applied",
        style: "reference",
        keywords: ["plan"],
      });
      expect(ids(r.value.custom)).toEqual(["mine"]);
    }
  });

  test("ignores unknown override keys", () => {
    const r = parseUserCatalog({
      overrides: { a: { enabled: true, bogus: 1 } },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const o = r.value.overrides["a"];
      expect(o).toBeDefined();
      expect(o?.enabled).toBe(true);
      expect(Object.hasOwn(o ?? {}, "bogus")).toBe(false);
    }
  });

  test.each([
    ["enabled", { enabled: "yes" }],
    ["targetLevel", { targetLevel: "Master" }],
    ["style", { style: "nope" }],
    ["keywords type", { keywords: "x" }],
    ["keyword too long", { keywords: ["k".repeat(41)] }],
    ["keyword empty", { keywords: [" "] }],
  ])("rejects wrong-typed override %s", (_n, override) => {
    expect(parseUserCatalog({ overrides: { a: override } }).ok).toBe(false);
  });

  test("rejects a non-object override", () => {
    expect(parseUserCatalog({ overrides: { a: 5 } }).ok).toBe(false);
  });

  test("rejects an override key that is not a topic id", () => {
    expect(parseUserCatalog({ overrides: { "Bad Id": {} } }).ok).toBe(false);
  });

  test("rejects an own __proto__ override key without polluting", () => {
    const input = JSON.parse(
      '{"overrides":{"__proto__":{"enabled":false}}}',
    ) as unknown;
    const r = parseUserCatalog(input);
    expect(r.ok).toBe(false);
    expect(({} as Record<string, unknown>)["enabled"]).toBeUndefined();
  });

  test("rejects bad overrides / custom containers and bad custom entries", () => {
    expect(parseUserCatalog({ overrides: [] }).ok).toBe(false);
    expect(parseUserCatalog({ custom: {} }).ok).toBe(false);
    expect(parseUserCatalog({ custom: [raw("Bad Id")] }).ok).toBe(false);
  });
});

describe("mergeCatalog", () => {
  const bundledResult = parseCatalog([
    raw("a", { keywords: ["alpha"] }),
    raw("b", { dependencies: ["a"] }),
  ]);
  if (!bundledResult.ok) throw new Error("fixture invalid");
  const bundled = bundledResult.value;
  const userOf = (
    u: Record<string, unknown>,
  ): Parameters<typeof mergeCatalog>[1] => {
    const r = parseUserCatalog(u);
    if (!r.ok) throw new Error(`fixture invalid: ${r.reason}`);
    return r.value;
  };

  test("with an empty user catalog returns bundled unchanged", () => {
    const r = mergeCatalog(bundled, userOf({}));
    expect(r).toEqual({
      ok: true,
      value: { entries: bundled, shadowedCustom: [] },
    });
  });

  test("applies overrides and appends custom after bundled", () => {
    const r = mergeCatalog(
      bundled,
      userOf({
        overrides: {
          a: {
            enabled: false,
            targetLevel: "Fluent",
            style: "socratic",
            keywords: ["Beta"],
          },
        },
        custom: [raw("z", { dependencies: ["b"] }), raw("y")],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(ids(r.value.entries)).toEqual(["a", "b", "z", "y"]);
    const a = r.value.entries[0];
    expect(a?.enabled).toBe(false);
    expect(a?.targetLevel).toBe("Fluent");
    expect(a?.style).toBe("socratic");
    expect(a?.keywords).toEqual(["beta"]);
    expect(r.value.entries[1]).toEqual(bundled[1]);
  });

  test("an override can target a custom entry", () => {
    const r = mergeCatalog(
      bundled,
      userOf({ custom: [raw("z")], overrides: { z: { enabled: false } } }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.entries[2]?.enabled).toBe(false);
  });

  test("does not mutate the bundled input", () => {
    const before = structuredClone(bundled);
    mergeCatalog(bundled, userOf({ overrides: { a: { enabled: false } } }));
    expect(bundled).toEqual(before);
  });

  test("fails when an override names an unknown id", () => {
    expect(
      mergeCatalog(
        bundled,
        userOf({ overrides: { ghost: { enabled: false } } }),
      ).ok,
    ).toBe(false);
  });

  describe("a custom id equal to a bundled id", () => {
    test("is dropped: the bundled entry wins and the id is reported", () => {
      const r = mergeCatalog(
        bundled,
        userOf({
          custom: [raw("a", { title: "Mine", keywords: ["mine"] }), raw("z")],
        }),
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(ids(r.value.entries)).toEqual(["a", "b", "z"]);
      expect(r.value.entries[0]).toEqual(bundled[0]);
      expect(r.value.shadowedCustom).toEqual(["a"]);
    });

    test("shadowedCustom is sorted", () => {
      const r = mergeCatalog(bundled, userOf({ custom: [raw("b"), raw("a")] }));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.shadowedCustom).toEqual(["a", "b"]);
    });

    test("another custom entry may still depend on the shadowed id", () => {
      const r = mergeCatalog(
        bundled,
        userOf({ custom: [raw("a"), raw("z", { dependencies: ["a"] })] }),
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(ids(r.value.entries)).toEqual(["a", "b", "z"]);
        expect(r.value.entries[2]?.dependencies).toEqual(["a"]);
      }
    });

    test("an override targeting the shadowed id applies to the bundled entry", () => {
      const r = mergeCatalog(
        bundled,
        userOf({
          custom: [raw("a")],
          overrides: { a: { enabled: false, targetLevel: "Fluent" } },
        }),
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.entries[0]).toEqual({
        ...bundled[0],
        enabled: false,
        targetLevel: "Fluent",
      });
      expect(r.value.entries).toHaveLength(2);
    });

    test("a duplicate id among the custom entries is still an error", () => {
      expect(
        mergeCatalog(
          bundled,
          userOf({ custom: [raw("a"), raw("z"), raw("z")] }),
        ).ok,
      ).toBe(false);
      // Two custom entries both shadowing the same bundled id also duplicate
      // each other.
      expect(
        mergeCatalog(bundled, userOf({ custom: [raw("a"), raw("a")] })).ok,
      ).toBe(false);
    });

    test("the shadowed entry does not count toward the 500 cap", () => {
      const many = Array.from({ length: 499 }, (_, i) => raw(`c${String(i)}`));
      // 2 bundled + 498 kept custom = 500 (the shadowed one is dropped before
      // the cap is computed).
      const r = mergeCatalog(
        bundled,
        userOf({ custom: [raw("a"), ...many.slice(0, 498)] }),
      );
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.entries).toHaveLength(500);
      // 2 bundled + 499 kept custom = 501 still fails.
      expect(
        mergeCatalog(
          bundled,
          userOf({ custom: [raw("a"), ...many.slice(0, 499)] }),
        ).ok,
      ).toBe(false);
    });

    test("a cycle through the final merged set is still an error", () => {
      const r = mergeCatalog(
        bundled,
        userOf({
          custom: [
            raw("a", { dependencies: ["z"] }),
            raw("z", { dependencies: ["b"] }),
          ],
        }),
      );
      // a is dropped (bundled a has no dependencies), so z -> b -> a is not a
      // cycle and the merge succeeds.
      expect(r.ok).toBe(true);
      // The x <-> y cycle fails with or without the drop; only the first case
      // above discriminates the drop.
      const cyc = mergeCatalog(
        bundled,
        userOf({
          custom: [
            raw("a"),
            raw("x", { dependencies: ["y"] }),
            raw("y", { dependencies: ["x"] }),
          ],
        }),
      );
      expect(cyc.ok).toBe(false);
    });

    test("no collision reports an empty shadowedCustom", () => {
      const r = mergeCatalog(bundled, userOf({ custom: [raw("z")] }));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.shadowedCustom).toEqual([]);
    });
  });

  test("fails on duplicate custom ids", () => {
    expect(
      mergeCatalog(bundled, userOf({ custom: [raw("z"), raw("z")] })).ok,
    ).toBe(false);
  });

  test("fails on a custom entry with an unknown dependency", () => {
    expect(
      mergeCatalog(
        bundled,
        userOf({ custom: [raw("z", { dependencies: ["ghost"] })] }),
      ).ok,
    ).toBe(false);
  });

  test("fails on a cycle introduced by custom entries", () => {
    const r = mergeCatalog(
      bundled,
      userOf({
        custom: [
          raw("x", { dependencies: ["y"] }),
          raw("y", { dependencies: ["x"] }),
        ],
      }),
    );
    expect(r.ok).toBe(false);
  });

  test("allows disabling a topic another enabled topic depends on", () => {
    const r = mergeCatalog(
      bundled,
      userOf({ overrides: { a: { enabled: false } } }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.entries[1]?.enabled).toBe(true);
  });
});

describe("matchTopics", () => {
  const entry = (
    id: string,
    keywords: string[],
    enabled = true,
  ): CatalogEntry => parsed(id, { keywords, enabled });

  test("matches whole words case-insensitively", () => {
    const cat = [entry("plan", ["plan"])];
    expect(ids(matchTopics(cat, "Enter PLAN mode"))).toEqual(["plan"]);
    expect(ids(matchTopics(cat, "a plan."))).toEqual(["plan"]);
    expect(ids(matchTopics(cat, "plan"))).toEqual(["plan"]);
  });

  test.each(["explanation", "planning", "airplane", "plan2"])(
    "does not match inside %s",
    (text) => {
      expect(matchTopics([entry("plan", ["plan"])], text)).toEqual([]);
    },
  );

  test("matches multi-word keywords", () => {
    const cat = [entry("cw", ["context window"])];
    expect(ids(matchTopics(cat, "the context window is full"))).toEqual(["cw"]);
  });

  test("the dot in a keyword is literal", () => {
    const cat = [entry("md", ["claude.md"])];
    expect(ids(matchTopics(cat, "edit claude.md now"))).toEqual(["md"]);
    expect(matchTopics(cat, "edit claudeXmd now")).toEqual([]);
  });

  test("ignores disabled entries", () => {
    const cat = [entry("off", ["plan"], false), entry("on", ["plan"])];
    expect(ids(matchTopics(cat, "plan"))).toEqual(["on"]);
  });

  describe("ambient: false entries", () => {
    const quiet = parsed("quiet", { keywords: ["plan"], ambient: false });
    const loud = parsed("loud", { keywords: ["plan"] });
    const explicitLoud = parsed("explicit", {
      keywords: ["plan"],
      ambient: true,
    });

    test("are excluded by default, ambient and absent-ambient entries still match", () => {
      expect(ids(matchTopics([quiet, loud, explicitLoud], "plan"))).toEqual([
        "loud",
        "explicit",
      ]);
      expect(matchTopics([quiet], "plan")).toEqual([]);
    });

    test("are included when listed in includeAmbientOff", () => {
      const hits = matchTopics([quiet, loud], "plan", 3, {
        includeAmbientOff: new Set(["quiet"]),
      });
      expect(ids(hits)).toEqual(["quiet", "loud"]);
    });

    test("only the listed ids are opted in", () => {
      const other = parsed("other", { keywords: ["plan"], ambient: false });
      const hits = matchTopics([quiet, other], "plan", 3, {
        includeAmbientOff: new Set(["other"]),
      });
      expect(ids(hits)).toEqual(["other"]);
    });

    test("an opted-in entry that is disabled is still excluded", () => {
      const off = parsed("off", {
        keywords: ["plan"],
        ambient: false,
        enabled: false,
      });
      expect(
        matchTopics([off], "plan", 3, {
          includeAmbientOff: new Set(["off"]),
        }),
      ).toEqual([]);
    });

    test("an empty opt-in set behaves like no options", () => {
      expect(
        matchTopics([quiet, loud], "plan", 3, {
          includeAmbientOff: new Set(),
        }),
      ).toEqual(matchTopics([quiet, loud], "plan"));
    });
  });

  describe("override cannot set ambient", () => {
    test("an ambient key in an override is ignored like any unknown key", () => {
      const r = parseUserCatalog({
        overrides: { a: { ambient: false, enabled: false } },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const bundledA = parsed("a");
      const merged = mergeCatalog([bundledA], r.value);
      expect(merged.ok).toBe(true);
      if (!merged.ok) return;
      expect(merged.value.entries[0]?.enabled).toBe(false);
      expect(Object.hasOwn(merged.value.entries[0] ?? {}, "ambient")).toBe(
        false,
      );
    });
  });

  test("excludes entries with zero matches", () => {
    expect(matchTopics([entry("a", ["alpha"])], "nothing here")).toEqual([]);
  });

  test("counts distinct keywords and ranks by count descending", () => {
    const cat = [
      entry("one", ["alpha"]),
      entry("two", ["alpha", "beta"]),
      entry("three", ["alpha", "beta", "gamma"]),
    ];
    expect(ids(matchTopics(cat, "alpha beta gamma"))).toEqual([
      "three",
      "two",
      "one",
    ]);
  });

  test("repeated occurrences of one keyword count once", () => {
    const cat = [entry("rep", ["alpha"]), entry("two", ["alpha", "beta"])];
    expect(ids(matchTopics(cat, "alpha alpha alpha alpha beta"))).toEqual([
      "two",
      "rep",
    ]);
  });

  test("ties are broken by catalog order", () => {
    const cat = [entry("first", ["x"]), entry("second", ["x"])];
    expect(ids(matchTopics(cat, "x"))).toEqual(["first", "second"]);
  });

  test("default limit is 3; explicit limit honored", () => {
    const cat = ["a", "b", "c", "d", "e"].map((i) => entry(i, ["x"]));
    expect(matchTopics(cat, "x")).toHaveLength(3);
    expect(matchTopics(cat, "x", 5)).toHaveLength(5);
    expect(ids(matchTopics(cat, "x", 1))).toEqual(["a"]);
  });

  test.each([0, -1])("limit %i returns []", (limit) => {
    expect(matchTopics([entry("a", ["x"])], "x", limit)).toEqual([]);
  });

  test("truncates text to its first 20000 chars", () => {
    const cat = [entry("late", ["needle"])];
    expect(matchTopics(cat, `${"a ".repeat(10000)}needle`)).toEqual([]);
    expect(ids(matchTopics(cat, `${"a ".repeat(9990)}needle`))).toEqual([
      "late",
    ]);
  });
});

describe("isUnprompted", () => {
  test.each([
    [true, undefined, true],
    [true, true, true],
    [true, false, false],
    [false, undefined, false],
    [false, true, false],
    [false, false, false],
  ] as const)("enabled=%s ambient=%s -> %s", (enabled, ambient, expected) => {
    const extra: Record<string, unknown> =
      ambient === undefined ? { enabled } : { enabled, ambient };
    expect(isUnprompted(parsed("t", extra))).toBe(expected);
  });
});
