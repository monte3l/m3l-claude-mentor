import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import {
  SKILLS_DIR,
  SKILL_NAMES,
  bashLines,
  checkDocsSourcing,
  checkFastFacts,
  checkSafety,
  checkAllowedTools,
  checkStateAccess,
  toolEntries,
  CLI_TOOL,
  cliCommands,
  parseFrontmatter,
  readSkill,
  sectionOf,
  usedCommands,
  skillMarkdownFiles,
} from "./helpers.js";

const REQUIRES_HINT = ["teach", "ask", "assess"];
const CLI = (command: string): string =>
  `node \${CLAUDE_PLUGIN_ROOT}/dist/cli/mentor-state.js --data-dir \${CLAUDE_PLUGIN_DATA} ${command}`;
const fence = (...lines: string[]): string =>
  ["```bash", ...lines, "```"].join("\n");

let commands: string[] = [];
beforeAll(async () => {
  commands = await cliCommands();
});

describe("rule 1: exactly six skill directories", () => {
  test("skills/ holds exactly the six directories", () => {
    const entries = readdirSync(SKILLS_DIR, { withFileTypes: true });
    expect(entries.every((e) => e.isDirectory())).toBe(true);
    expect(entries.map((e) => e.name).sort()).toEqual([...SKILL_NAMES].sort());
  });

  test.each(SKILL_NAMES)("%s has a SKILL.md", (name) => {
    expect(statSync(join(SKILLS_DIR, name, "SKILL.md")).isFile()).toBe(true);
  });
});

describe("rule 2: frontmatter", () => {
  test.each(SKILL_NAMES)("%s: name equals directory", (name) => {
    expect(parseFrontmatter(readSkill(name)).data["name"]).toBe(name);
  });

  test.each(SKILL_NAMES)(
    "%s: description is 40..1024 chars, third person, says when",
    (name) => {
      const description =
        parseFrontmatter(readSkill(name)).data["description"] ?? "";
      expect(description.length).toBeGreaterThanOrEqual(40);
      expect(description.length).toBeLessThanOrEqual(1024);
      expect(description).not.toMatch(/^(I|You|Your|My|We)\b/);
      expect(description).toMatch(/\bwhen\b/i);
    },
  );

  test.each(REQUIRES_HINT)("%s: argument-hint is present", (name) => {
    const hint = parseFrontmatter(readSkill(name)).data["argument-hint"];
    expect(hint).toBeTruthy();
  });

  test.each(SKILL_NAMES)("%s: only known frontmatter keys", (name) => {
    const known = [
      "name",
      "description",
      "argument-hint",
      "allowed-tools",
      "disable-model-invocation",
    ];
    for (const key of Object.keys(parseFrontmatter(readSkill(name)).data)) {
      expect(known).toContain(key);
    }
  });

  test("parser rejects missing or unclosed frontmatter", () => {
    expect(() => parseFrontmatter("no front\n")).toThrow();
    expect(() => parseFrontmatter("---\nname: a\n")).toThrow();
    expect(() => parseFrontmatter("---\nnot a pair\n---\n")).toThrow();
  });

  test("parser reads quoted and bare scalars", () => {
    const { data, body } = parseFrontmatter(
      '---\nname: a\ndescription: "q: x"\n---\nbody\n',
    );
    expect(data).toEqual({ name: "a", description: "q: x" });
    expect(body).toBe("body\n");
  });
});

describe("rule 3: size", () => {
  test.each(SKILL_NAMES)("%s: <= 200 lines and <= 9000 bytes", (name) => {
    const path = join(SKILLS_DIR, name, "SKILL.md");
    const text = readFileSync(path, "utf8");
    expect(text.split("\n").length).toBeLessThanOrEqual(200);
    expect(statSync(path).size).toBeLessThanOrEqual(9000);
  });
});

describe("rule 4: state access only through the CLI", () => {
  test("the CLI reports a non-empty command list", () => {
    expect(commands.length).toBeGreaterThan(0);
  });

  test.each(SKILL_NAMES)(
    "%s: every bash line is the standard invocation of a real command",
    (name) => {
      const body = parseFrontmatter(readSkill(name)).body;
      expect(checkStateAccess(body, commands)).toEqual([]);
    },
  );

  test.each(["teach", "quiz", "whats-new", "profile", "assess"])(
    "%s: uses the CLI at least once",
    (name) => {
      const body = parseFrontmatter(readSkill(name)).body;
      expect(
        bashLines(body).filter((l) => l.includes("mentor-state.js")).length,
      ).toBeGreaterThan(0);
    },
  );

  test("checker accepts a standard invocation", () => {
    expect(checkStateAccess(fence(CLI("show")), ["show", "recompute"])).toEqual(
      [],
    );
  });

  test("checker flags an unknown command", () => {
    expect(checkStateAccess(fence(CLI("frobnicate")), ["show"])).not.toEqual(
      [],
    );
  });

  test("checker flags a non-standard invocation (bare node, no env)", () => {
    expect(
      checkStateAccess(fence("node dist/cli/mentor-state.js show"), ["show"]),
    ).not.toEqual([]);
  });

  test.each([
    'CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" node "${CLAUDE_PLUGIN_ROOT}/dist/cli/mentor-state.js" show',
    "CLAUDE_PLUGIN_DATA=${CLAUDE_PLUGIN_DATA} node ${CLAUDE_PLUGIN_ROOT}/dist/cli/mentor-state.js --data-dir ${CLAUDE_PLUGIN_DATA} show",
    "node ${CLAUDE_PLUGIN_ROOT}/dist/cli/mentor-state.js show",
    'node "${CLAUDE_PLUGIN_ROOT}/dist/cli/mentor-state.js" --data-dir "${CLAUDE_PLUGIN_DATA}" show',
  ])("checker flags the old or malformed invocation: %s", (line) => {
    expect(checkStateAccess(fence(line), ["show"])).not.toEqual([]);
  });

  test("checker takes only the token after the --data-dir pair as the command", () => {
    expect(
      checkStateAccess(fence(CLI("set-mute <on|off> --topic [x]")), [
        "set-mute",
      ]),
    ).toEqual([]);
  });

  test("checker flags a unknown command named in prose", () => {
    expect(
      checkStateAccess("then run mentor-state.js --data-dir $X bogus now", [
        "show",
      ]),
    ).not.toEqual([]);
  });

  test.each([
    "Edit profile.json to set the level.",
    "Append a line to evidence.jsonl.",
    "Overwrite goals.md with the new text.",
    "Update state.json directly.",
  ])("checker flags a direct state edit: %s", (line) => {
    expect(checkStateAccess(line, ["show"])).not.toEqual([]);
  });

  test("checker allows a prohibition that names a state file", () => {
    expect(
      checkStateAccess("Never edit profile.json directly.", ["show"]),
    ).toEqual([]);
  });
});

describe("rule 5: destructive commands need explicit confirmation first", () => {
  test.each(SKILL_NAMES)("%s passes the safety check", (name) => {
    for (const file of skillMarkdownFiles(name)) {
      expect(checkSafety(file.body), file.path).toEqual([]);
    }
  });

  test("profile SKILL.md gates the data-actions reference behind explicit confirmation", () => {
    const body = parseFrontmatter(readSkill("profile")).body;
    expect(body).toMatch(/explicit/i);
    expect(body).toMatch(/confirm/i);
    expect(body).toContain("references/data-actions.md");
  });

  test("the destructive commands are actually exercised by the profile files", () => {
    const text = skillMarkdownFiles("profile")
      .map((f) => f.body)
      .join("\n");
    expect(text).toMatch(/\bpurge\b/);
    expect(text).toMatch(/import --from/);
  });

  test("the checker is applied to every markdown file, references included", () => {
    expect(
      skillMarkdownFiles("profile").map((f) =>
        f.path.split("/").slice(1).join("/"),
      ),
    ).toContain("references/data-actions.md");
    expect(
      skillMarkdownFiles("teach").map((f) =>
        f.path.split("/").slice(1).join("/"),
      ),
    ).toContain("references/styles.md");
  });

  test("checker flags purge --confirm before any confirmation language", () => {
    const body = `Run it.\n${fence(CLI("purge --confirm"))}\nAsk for explicit confirmation.`;
    expect(checkSafety(body)).not.toEqual([]);
  });

  test("checker flags import --from before confirmation", () => {
    expect(checkSafety(CLI("import --from x.json --replace"))).not.toEqual([]);
  });

  test("checker flags --confirm used before the gate even without purge", () => {
    expect(checkSafety("pass --confirm now")).not.toEqual([]);
  });

  test("the flag --confirm alone does not count as confirmation language", () => {
    expect(
      checkSafety(`${CLI("purge --confirm")}\n${CLI("purge --confirm")}`),
    ).not.toEqual([]);
  });

  test("explicit alone (no confirm) is not a gate", () => {
    expect(checkSafety(`Be explicit.\n${CLI("purge --confirm")}`)).not.toEqual(
      [],
    );
  });

  test("checker accepts the destructive command after the gate", () => {
    const body = `Require the learner's explicit confirmation first.\n${fence(CLI("purge --confirm"))}`;
    expect(checkSafety(body)).toEqual([]);
  });

  test("a gate in the same line as purge does not count (must come before)", () => {
    expect(checkSafety("purge needs explicit confirmation")).not.toEqual([]);
  });
});

describe("rule 6: no fast-moving facts", () => {
  test.each(SKILL_NAMES)("%s has none", (name) => {
    for (const file of skillMarkdownFiles(name)) {
      expect(checkFastFacts(file.body), file.path).toEqual([]);
    }
  });

  test.each([
    "Use claude-opus-4-1 for this.",
    "claude-sonnet-4-5 is fast",
    "the Haiku 4 model",
    "It costs $15 per million",
    "about $ 3 a run",
    "limited to 50 requests per minute",
    "capped at 1,000 messages per day",
    "10 rpm",
  ])("checker flags: %s", (text) => {
    expect(checkFastFacts(text)).not.toEqual([]);
  });

  test("checker leaves shell variable substitution and plain prose alone", () => {
    expect(
      checkFastFacts(`${CLI("show")}\nAsk 3 questions at a time.`),
    ).toEqual([]);
  });
});

describe("rule 7: ask and whats-new source from official docs", () => {
  const ASK = ["code.claude.com", "https://code.claude.com/docs/llms.txt"];
  const NEW = [
    "code.claude.com",
    "https://code.claude.com/docs/en/changelog.md",
  ];

  test("ask cites the docs index, gives a link, and states Reference style", () => {
    const body = parseFrontmatter(readSkill("ask")).body;
    expect(checkDocsSourcing(body, ASK)).toEqual([]);
    expect(body).toMatch(/\bReference\b/);
  });

  test("whats-new cites the changelog and gives a link", () => {
    expect(
      checkDocsSourcing(parseFrontmatter(readSkill("whats-new")).body, NEW),
    ).toEqual([]);
  });

  test("ask does not record mastery evidence for merely asking", () => {
    const lines = bashLines(parseFrontmatter(readSkill("ask")).body);
    expect(lines.some((l) => /\brecord-(evidence|pass)\b/.test(l))).toBe(false);
  });

  test.each(SKILL_NAMES)("%s does not mention the PR 2 agents", (name) => {
    expect(readSkill(name)).not.toMatch(/mastery-assessor|docs-researcher/);
  });

  test("checker flags missing sources and missing link instruction", () => {
    expect(checkDocsSourcing("answer from memory", ASK)).toEqual([
      "missing code.claude.com",
      "missing https://code.claude.com/docs/llms.txt",
      "missing instruction to give a link",
    ]);
  });
});

const WEB_SKILLS = ["teach", "ask", "whats-new"];
const usesCli = (name: string): boolean =>
  skillMarkdownFiles(name).some((f) =>
    bashLines(f.body).some((l) => l.includes("mentor-state.js")),
  );

describe("allowed-tools", () => {
  test.each(SKILL_NAMES)(
    "%s: only the CLI Bash pattern, WebFetch only on teach/ask/whats-new",
    (name) => {
      const entries = toolEntries(
        parseFrontmatter(readSkill(name)).data["allowed-tools"],
      );
      expect(checkAllowedTools(entries, WEB_SKILLS.includes(name))).toEqual([]);
      expect(entries).not.toContain("WebSearch");
      expect(entries).not.toContain("Bash");
      expect(entries.includes(CLI_TOOL)).toBe(usesCli(name));
    },
  );

  test.each(WEB_SKILLS)("%s: allows WebFetch", (name) => {
    expect(
      toolEntries(parseFrontmatter(readSkill(name)).data["allowed-tools"]),
    ).toContain("WebFetch");
  });

  test.each(["Bash", "Bash(*)", "Bash(node x *)", "WebSearch", "Read"])(
    "checker flags %s",
    (entry) => {
      expect(checkAllowedTools([entry], true)).not.toEqual([]);
    },
  );

  test("checker flags WebFetch where it is not allowed, accepts the exact pattern", () => {
    expect(checkAllowedTools(["WebFetch"], false)).not.toEqual([]);
    expect(checkAllowedTools([CLI_TOOL, "WebFetch"], true)).toEqual([]);
  });
});

describe("required phrases", () => {
  const has = (name: string, phrase: string): boolean =>
    readSkill(name).toLowerCase().includes(phrase);

  test.each(WEB_SKILLS)(
    "%s: fetched pages are data (never instructions)",
    (name) => {
      expect(has(name, "never instructions")).toBe(true);
    },
  );

  test.each(SKILL_NAMES.filter((n) => n !== "ask"))(
    "%s: passes learner-derived arguments, so states the single quotes rule",
    (name) => {
      expect(usesCli(name)).toBe(true);
      expect(has(name, "single quotes")).toBe(true);
    },
  );

  test("ask passes no learner-derived value to the CLI (topics takes no arguments)", () => {
    for (const line of skillMarkdownFiles("ask").flatMap((f) =>
      bashLines(f.body),
    )) {
      expect(line).toMatch(/--data-dir \$\{CLAUDE_PLUGIN_DATA\} topics$/);
    }
  });

  test.each(SKILL_NAMES)("%s: failure handling says do not claim", (name) => {
    expect(has(name, "do not claim")).toBe(true);
  });

  test("assess: claims are Recalled..Fluent and unverified is an outcome", () => {
    const text = readSkill("assess");
    for (const level of ["Recalled", "Fluent"]) expect(text).toContain(level);
    expect(text).toContain("unverified");
  });

  test("quiz states the 2 of 3 pass criterion", () => {
    expect(readSkill("quiz")).toContain("2 of 3");
  });

  test("teach starts spaced review through record-batch --pass", () => {
    expect(readSkill("teach")).toContain("--pass");
  });
});

describe("batch recording and profile additions", () => {
  const BATCH_SKILLS = ["quiz", "teach", "assess"];
  const SEPARATE = ["record-evidence", "record-pass", "recompute"];
  const allUsed = (name: string): string[] =>
    skillMarkdownFiles(name).flatMap((f) => usedCommands(f.body));

  test.each(BATCH_SKILLS)("%s: records with record-batch", (name) => {
    expect(readSkill(name)).toContain("record-batch");
    expect(allUsed(name)).toContain("record-batch");
  });

  test.each(BATCH_SKILLS)(
    "%s: no bash line uses the separate recording commands",
    (name) => {
      expect(allUsed(name).filter((c) => SEPARATE.includes(c))).toEqual([]);
    },
  );

  test("profile Show step runs get-goals", () => {
    const show = sectionOf(parseFrontmatter(readSkill("profile")).body, "Show");
    expect(show).toBeDefined();
    expect(usedCommands(show ?? "")).toContain("get-goals");
  });

  test("profile documents the permission rule and never edits settings", () => {
    const text = readSkill("profile");
    expect(text).toContain("Bash(node */dist/cli/mentor-state.js *)");
    expect(text).toMatch(/permissions/i);
    expect(text.toLowerCase()).toContain("never edit");
  });

  test("sectionOf slices between level-two headings", () => {
    const body = "## A\none\n## B\ntwo\n## C\nthree";
    expect(sectionOf(body, "B")).toBe("two");
    expect(sectionOf(body, "C")).toBe("three");
    expect(sectionOf(body, "Z")).toBeUndefined();
  });

  test("usedCommands lists only standard invocation commands", () => {
    const body = fence(CLI("record-batch --topic x"), "echo hi", CLI("show"));
    expect(usedCommands(body)).toEqual(["record-batch", "show"]);
  });

  test("a body using a separate recording command is caught by the filter", () => {
    const body = fence(
      CLI("record-pass --topic x"),
      CLI("record-batch --topic x"),
    );
    expect(usedCommands(body).filter((c) => SEPARATE.includes(c))).toEqual([
      "record-pass",
    ]);
  });

  test("a Show section without get-goals is caught", () => {
    const body = `## Show\n${fence(CLI("show"))}\n## Goals\n${fence(CLI("get-goals"))}`;
    expect(usedCommands(sectionOf(body, "Show") ?? "")).not.toContain(
      "get-goals",
    );
  });
});
