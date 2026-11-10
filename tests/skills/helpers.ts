import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runCommand } from "../../src/cli/commands.js";
import { BUNDLED, NOW, SESSION } from "../cli/helpers.js";

export const SKILLS_DIR = resolve(import.meta.dirname, "../../skills");

export const SKILL_NAMES = [
  "assess",
  "ask",
  "profile",
  "quiz",
  "teach",
  "whats-new",
] as const;

export interface ParsedSkill {
  readonly data: Readonly<Record<string, string>>;
  readonly body: string;
}

export function readSkill(name: string): string {
  return readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf8");
}

/**
 * Strict tiny frontmatter parser: the text must start with a `---` line,
 * hold `key: value` lines (bare or quoted scalars), and close with `---`.
 */
export function parseFrontmatter(text: string): ParsedSkill {
  const lines = text.split("\n");
  if (lines[0] !== "---") throw new Error("frontmatter must start with ---");
  const end = lines.indexOf("---", 1);
  if (end === -1) throw new Error("frontmatter is not closed by ---");
  const data: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!match) throw new Error(`not a key: value line: ${line}`);
    const key = match[1] ?? "";
    let value = (match[2] ?? "").trim();
    const quote = value[0];
    if (
      value.length >= 2 &&
      (quote === '"' || quote === "'") &&
      value.endsWith(quote)
    ) {
      value = value.slice(1, -1);
    }
    if (Object.hasOwn(data, key)) throw new Error(`duplicate key: ${key}`);
    data[key] = value;
  }
  return { data, body: lines.slice(end + 1).join("\n") };
}

/** Lines held inside fenced bash blocks. */
export function bashLines(body: string): string[] {
  const out: string[] = [];
  let inBash = false;
  let inOther = false;
  for (const line of body.split("\n")) {
    const fence = /^\s*```(\w*)\s*$/.exec(line);
    if (fence) {
      if (inBash || inOther) {
        inBash = false;
        inOther = false;
      } else if (fence[1] === "bash") {
        inBash = true;
      } else {
        inOther = true;
      }
      continue;
    }
    if (inBash && line.trim() !== "") out.push(line.trim());
  }
  return out;
}

/** Reads the valid command names from the CLI's own usage line. */
export async function cliCommands(): Promise<string[]> {
  const root = mkdtempSync(join(tmpdir(), "skills-"));
  try {
    const result = await runCommand(["nope"], {
      dir: join(root, "data"),
      now: NOW,
      session: SESSION,
      bundled: BUNDLED,
    });
    const match = /commands: ([^\n]+)/.exec(result.stderr);
    if (!match) throw new Error(`no commands list in: ${result.stderr}`);
    return (match[1] ?? "").split(",").map((c) => c.trim());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const STANDARD =
  /^node \$\{CLAUDE_PLUGIN_ROOT\}\/dist\/cli\/mentor-state\.js --data-dir \$\{CLAUDE_PLUGIN_DATA\} ([a-z][a-z-]*)(?: .*)?$/;

/** Rule 4: state access only via the standard CLI invocation. */
export function checkStateAccess(
  body: string,
  commands: readonly string[],
): string[] {
  const problems: string[] = [];
  for (const line of bashLines(body)) {
    const std = STANDARD.exec(line);
    if (std) {
      const command = std[1] ?? "";
      if (!commands.includes(command))
        problems.push(`unknown CLI command: ${command}`);
    } else {
      problems.push(`bash line is not the standard CLI invocation: ${line}`);
    }
  }
  for (const line of body.split("\n")) {
    const named = /mentor-state\.js\s+--data-dir\s+\S+\s+([a-z][a-z-]*)/.exec(
      line,
    );
    if (named && !commands.includes(named[1] ?? ""))
      problems.push(`unknown CLI command: ${named[1] ?? ""}`);
    if (/CLAUDE_PLUGIN_DATA=/.test(line))
      problems.push(
        `CLAUDE_PLUGIN_DATA used as an env assignment: ${line.trim()}`,
      );
    const direct =
      /\b(profile\.json|state\.json|evidence\.jsonl|catalog\.json|goals\.md)\b/.test(
        line,
      ) &&
      /\b(write|writing|edit|editing|modify|overwrite|append|update|echo|sed|tee)\b|>>?\s*\S*(json|jsonl|md)\b/i.test(
        line,
      ) &&
      !/\b(never|not|don't|do not|only through)\b/i.test(line);
    if (direct) problems.push(`direct state-file edit: ${line.trim()}`);
  }
  return problems;
}

/** Rule 5: destructive commands only after an explicit-confirmation instruction. */
export function checkSafety(body: string): string[] {
  const problems: string[] = [];
  const lines = body.split("\n");
  let gated = false;
  let sawExplicit = false;
  let sawConfirm = false;
  for (const [index, line] of lines.entries()) {
    const prose = line.replace(/--confirm|--replace/g, "");
    const destructive = /\bpurge\b|import --from/.test(line);
    const flag = /--confirm|--replace/.test(line);
    if ((destructive || flag) && !gated) {
      problems.push(
        `line ${String(index + 1)} precedes any confirmation: ${line.trim()}`,
      );
    }
    if (/\bexplicit(ly)?\b/i.test(prose)) sawExplicit = true;
    if (/\bconfirm/i.test(prose)) sawConfirm = true;
    // The gate opens only for lines AFTER the instruction line itself.
    if (sawExplicit && sawConfirm && !destructive && !flag) gated = true;
  }
  return problems;
}

/** Rule 6: no fast-moving facts. */
export function checkFastFacts(body: string): string[] {
  const rules: [string, RegExp][] = [
    ["model id", /claude-(?:opus|sonnet|haiku|\d)[\w.-]*/i],
    ["model family version", /\b(?:opus|sonnet|haiku)[ -]\d/i],
    ["price", /\$\s?\d/],
    [
      "rate limit",
      /\b\d[\d,]*\s*(?:requests?|messages?|prompts?|tokens?)\s*(?:per|\/|every)\s*(?:\d+\s*)?(?:minute|hour|day|week|month)s?\b/i,
    ],
    ["rate limit", /\b\d[\d,]*\s*(?:rpm|tpm)\b/i],
  ];
  return rules.flatMap(([label, re]) => {
    const hit = re.exec(body);
    return hit ? [`${label}: ${hit[0]}`] : [];
  });
}

/** Rule 7: docs sourcing. `needs` lists substrings the body must contain. */
export function checkDocsSourcing(
  body: string,
  needs: readonly string[],
): string[] {
  const missing = needs
    .filter((needle) => !body.includes(needle))
    .map((n) => `missing ${n}`);
  if (!/\blink\b/i.test(body))
    missing.push("missing instruction to give a link");
  return missing;
}

/** Every markdown file under skills/<name>/ (relative path, body without frontmatter). */
export function skillMarkdownFiles(
  name: string,
): { path: string; body: string }[] {
  const out: { path: string; body: string }[] = [];
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(SKILLS_DIR, name, rel), {
      withFileTypes: true,
    })) {
      const next = join(rel, entry.name);
      if (entry.isDirectory()) walk(next);
      else if (entry.name.endsWith(".md")) {
        const text = readFileSync(join(SKILLS_DIR, name, next), "utf8");
        out.push({
          path: join(name, next),
          body: text.startsWith("---\n") ? parseFrontmatter(text).body : text,
        });
      }
    }
  };
  walk("");
  return out;
}

export const CLI_TOOL =
  "Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/cli/mentor-state.js *)";

/** Rule: allowed-tools entries (comma separated). */
export function toolEntries(allowedTools: string | undefined): string[] {
  return (allowedTools ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "");
}

/** Rule: allowed-tools problems for one skill. */
export function checkAllowedTools(
  entries: readonly string[],
  webFetchAllowed: boolean,
): string[] {
  const problems: string[] = [];
  for (const entry of entries) {
    if (entry === "Bash" || entry.startsWith("Bash(")) {
      if (entry !== CLI_TOOL) problems.push(`disallowed Bash entry: ${entry}`);
    } else if (entry === "WebFetch") {
      if (!webFetchAllowed)
        problems.push("WebFetch not allowed for this skill");
    } else {
      problems.push(`disallowed tool: ${entry}`);
    }
  }
  return problems;
}
