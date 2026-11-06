/**
 * Feature-usage signals read from a Claude Code `PostToolUse` hook payload.
 *
 * Pure: no I/O, no environment, no clock. The extractor reads only the
 * payload's own `tool_name` and `tool_input` fields (never `tool_response`,
 * which may carry file contents or secrets) and builds its output solely from
 * the fixed allowlist below, so no substring of the payload is ever returned.
 */
import {
  parseEvidence,
  type Evidence,
  type SessionId,
  type TopicId,
} from "./schema.js";

/**
 * Every kind of feature usage the extractor can report, frozen.
 *
 * @example
 * ```ts
 * import { USAGE_KINDS } from "./signals.js";
 * USAGE_KINDS.includes("invoked-skill"); // true
 * ```
 */
export const USAGE_KINDS: readonly [
  "created-skill",
  "wrote-agent",
  "wrote-command",
  "wrote-output-style",
  "edited-claude-md",
  "edited-settings",
  "configured-hook",
  "edited-mcp-config",
  "edited-plugin-manifest",
  "added-mcp-server",
  "used-worktree",
  "used-plugin-cli",
  "invoked-skill",
  "dispatched-subagent",
  "used-plan-mode",
] = Object.freeze([
  "created-skill",
  "wrote-agent",
  "wrote-command",
  "wrote-output-style",
  "edited-claude-md",
  "edited-settings",
  "configured-hook",
  "edited-mcp-config",
  "edited-plugin-manifest",
  "added-mcp-server",
  "used-worktree",
  "used-plugin-cli",
  "invoked-skill",
  "dispatched-subagent",
  "used-plan-mode",
] as const);

/**
 * One kind of feature usage, a member of {@link USAGE_KINDS}.
 *
 * @example
 * ```ts
 * import type { UsageKind } from "./signals.js";
 * const k: UsageKind = "used-plan-mode";
 * ```
 */
export type UsageKind = (typeof USAGE_KINDS)[number];

/**
 * One observed use of a Claude Code feature: the catalog topic it exercises
 * and the kind of use.
 *
 * @example
 * ```ts
 * import { extractUsageSignals, type UsageSignal } from "./signals.js";
 * const [s]: readonly UsageSignal[] = extractUsageSignals({
 *   tool_name: "Skill",
 *   tool_input: {},
 * });
 * s?.topic; // "skills"
 * ```
 */
export interface UsageSignal {
  readonly topic: TopicId;
  readonly kind: UsageKind;
}

/**
 * The most signals {@link extractUsageSignals} returns for one event.
 *
 * @example
 * ```ts
 * import { MAX_SIGNALS_PER_EVENT } from "./signals.js";
 * MAX_SIGNALS_PER_EVENT; // 4
 * ```
 */
export const MAX_SIGNALS_PER_EVENT = 4;

/** Only this many leading characters of a Bash `command` are inspected. */
const MAX_COMMAND_CHARS = 2_000;
/** Only this many leading characters of `content`/`new_string` are inspected. */
const MAX_CONTENT_CHARS = 100_000;

/** The catalog topics the table maps to; each is a catalog id (tested). */
type SignalTopic =
  | "skills"
  | "subagents"
  | "slash-commands"
  | "output-styles"
  | "claude-md"
  | "settings-scopes"
  | "hooks"
  | "mcp"
  | "plugins"
  | "worktrees"
  | "plan-mode";

/** A command word starts the string or follows a separator or a path `/`. */
const COMMAND_START = String.raw`(?:^|[\s;&|(/])`;
const MCP_ADD = new RegExp(String.raw`${COMMAND_START}claude\s+mcp\s+add\b`);
const WORKTREE_ADD = new RegExp(
  String.raw`${COMMAND_START}git\s+worktree\s+add\b`,
);
const CLAUDE_WORKTREE = new RegExp(
  String.raw`${COMMAND_START}claude\s+(?:-w|--worktree)\b`,
);
const PLUGIN_CLI = new RegExp(
  String.raw`${COMMAND_START}claude\s+plugin\s+(?:install|add|validate)\b`,
);

function signal(topic: SignalTopic, kind: UsageKind): UsageSignal {
  // Every SignalTopic literal is a valid kebab-case catalog id, which the
  // vocabulary test asserts against data/topic-catalog.json.
  return { topic: topic as TopicId, kind };
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Readonly<Record<string, unknown>>;
}

/** Reads an own string field exactly once; anything else is `undefined`. */
function ownString(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  const value: unknown = record[key];
  return typeof value === "string" ? value : undefined;
}

/** Whether `content` opens with YAML frontmatter that has a description. */
function hasSkillFrontmatter(content: string): boolean {
  const text = content.slice(0, MAX_CONTENT_CHARS);
  if (!text.startsWith("---")) return false;
  const close = text.indexOf("\n---", 3);
  if (close === -1) return false;
  return text
    .slice(3, close)
    .split("\n")
    .some((line) => line.startsWith("description:"));
}

function mentionsHooks(text: string | undefined): boolean {
  return (
    text !== undefined && text.slice(0, MAX_CONTENT_CHARS).includes('"hooks"')
  );
}

/** Signals for a Write or Edit, judged on the forward-slash path segments. */
function fileSignals(
  tool: "Write" | "Edit",
  input: Readonly<Record<string, unknown>>,
): UsageSignal[] {
  const filePath = ownString(input, "file_path");
  if (filePath === undefined) return [];
  const content = ownString(input, "content");
  const newString = ownString(input, "new_string");

  const segments = filePath.replaceAll("\\", "/").split("/");
  const count = segments.length;
  const base = segments[count - 1];
  const parent = segments[count - 2];
  const grand = segments[count - 3];
  const out: UsageSignal[] = [];

  if (
    tool === "Write" &&
    count >= 5 &&
    base === "SKILL.md" &&
    parent !== "" &&
    grand === "skills" &&
    segments[count - 4] === ".claude" &&
    content !== undefined &&
    hasSkillFrontmatter(content)
  ) {
    out.push(signal("skills", "created-skill"));
  }

  const namedMd =
    count >= 4 &&
    grand === ".claude" &&
    base !== undefined &&
    base.length > 3 &&
    base.endsWith(".md");
  if (namedMd && parent === "agents") {
    out.push(signal("subagents", "wrote-agent"));
  }
  if (namedMd && parent === "commands") {
    out.push(signal("slash-commands", "wrote-command"));
  }
  if (namedMd && parent === "output-styles") {
    out.push(signal("output-styles", "wrote-output-style"));
  }
  if (base === "CLAUDE.md") {
    out.push(signal("claude-md", "edited-claude-md"));
  }

  const settings =
    count >= 3 &&
    parent === ".claude" &&
    (base === "settings.json" || base === "settings.local.json");
  if (settings) {
    out.push(signal("settings-scopes", "edited-settings"));
  }
  if (settings && (mentionsHooks(content) || mentionsHooks(newString))) {
    out.push(signal("hooks", "configured-hook"));
  }
  if (count >= 3 && parent === "hooks" && base === "hooks.json") {
    out.push(signal("hooks", "configured-hook"));
  }
  if (base === ".mcp.json") {
    out.push(signal("mcp", "edited-mcp-config"));
  }
  if (count >= 3 && parent === ".claude-plugin" && base === "plugin.json") {
    out.push(signal("plugins", "edited-plugin-manifest"));
  }
  return out;
}

function bashSignals(input: Readonly<Record<string, unknown>>): UsageSignal[] {
  const raw = ownString(input, "command");
  if (raw === undefined) return [];
  const command = raw.slice(0, MAX_COMMAND_CHARS);
  const out: UsageSignal[] = [];
  if (MCP_ADD.test(command)) out.push(signal("mcp", "added-mcp-server"));
  if (WORKTREE_ADD.test(command) || CLAUDE_WORKTREE.test(command)) {
    out.push(signal("worktrees", "used-worktree"));
  }
  if (PLUGIN_CLI.test(command)) out.push(signal("plugins", "used-plugin-cli"));
  return out;
}

function toolSignals(
  tool: string,
  input: Readonly<Record<string, unknown>>,
): UsageSignal[] {
  switch (tool) {
    case "Write":
    case "Edit":
      return fileSignals(tool, input);
    case "Bash":
      return bashSignals(input);
    case "Skill":
      return [signal("skills", "invoked-skill")];
    case "Agent":
    case "Task":
      return [signal("subagents", "dispatched-subagent")];
    case "EnterPlanMode":
    case "ExitPlanMode":
      return [signal("plan-mode", "used-plan-mode")];
    default:
      return [];
  }
}

/**
 * Extracts feature-usage signals from a `PostToolUse` hook payload.
 *
 * Reads only the payload's own `tool_name` (a string) and `tool_input` (an
 * object); a payload missing either, or holding the wrong type, yields `[]`.
 * Path fields are compared on their forward-slash form, case-sensitively;
 * only the first 2,000 chars of a Bash `command` and the first 100,000 chars
 * of `content`/`new_string` are inspected. The result is deduplicated by
 * topic and kind, in table order, and capped at
 * {@link MAX_SIGNALS_PER_EVENT}. Never throws on JSON-plain input, and never
 * returns any text from the payload: only fixed topics and kinds.
 *
 * @example
 * ```ts
 * import { extractUsageSignals } from "./signals.js";
 * extractUsageSignals({
 *   tool_name: "Bash",
 *   tool_input: { command: "claude mcp add docs" },
 * }); // [{ topic: "mcp", kind: "added-mcp-server" }]
 * ```
 */
export function extractUsageSignals(payload: unknown): readonly UsageSignal[] {
  const record = asRecord(payload);
  if (record === null) return [];
  const tool = ownString(record, "tool_name");
  if (tool === undefined) return [];
  const input = asRecord(
    Object.hasOwn(record, "tool_input") ? record["tool_input"] : undefined,
  );
  if (input === null) return [];

  const seen = new Set<string>();
  const out: UsageSignal[] = [];
  for (const s of toolSignals(tool, input)) {
    const key = `${s.topic}\u0000${s.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length === MAX_SIGNALS_PER_EVENT) break;
  }
  return out;
}

/**
 * Turns a usage signal into positive `observed` evidence for its topic.
 *
 * @throws RangeError when `at` is not finite or is negative (the same check
 * `parseEvidence` makes).
 *
 * @example
 * ```ts
 * import { parseSessionId } from "./schema.js";
 * import { extractUsageSignals, signalToEvidence } from "./signals.js";
 * const session = parseSessionId("sess_1");
 * const [s] = extractUsageSignals({ tool_name: "Skill", tool_input: {} });
 * if (session.ok && s !== undefined) {
 *   signalToEvidence(s, session.value, Date.now()).channel; // "observed"
 * }
 * ```
 */
export function signalToEvidence(
  usage: UsageSignal,
  session: SessionId,
  at: number,
): Evidence {
  const parsed = parseEvidence({
    channel: "observed",
    topic: usage.topic,
    result: "positive",
    at,
    session,
  });
  if (!parsed.ok) throw new RangeError(parsed.reason);
  return parsed.value;
}
