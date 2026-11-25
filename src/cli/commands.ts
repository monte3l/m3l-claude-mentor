import { MentorStateError } from "../internal/errors.ts";
import type { LockOptions } from "../internal/lock.ts";
import { parseSessionId, type CatalogEntry } from "../internal/schema.ts";
import { CliUsageError, parseArgs, type CommandSpec } from "./args.ts";
import { recordBatch } from "./batch-commands.ts";
import { setTopicOverride, topics } from "./catalog-commands.ts";
import { GLOBAL_USAGE } from "./global-options.ts";
import {
  excludeProject,
  exportData,
  getGoals,
  importData,
  purge,
  recordEvidence,
  setChangelogVersion,
  setGoals,
  setMute,
  setTopicMute,
  show,
} from "./data-commands.ts";
import type { CommandEnv } from "./env.ts";
import { examItems, readiness } from "./exam-report-commands.ts";
import { examAnswer, examBegin } from "./exam-session-commands.ts";
import { setTrack, tracks } from "./exam-track-commands.ts";
import { examUnvoid, examVoid } from "./exam-void-commands.ts";
import {
  getProfile,
  introduce,
  recompute,
  recordPass,
  resetTopic,
} from "./profile-commands.ts";

const ON_OFF = ["on", "off"] as const;

function spec(
  usage: string,
  valueFlags: readonly string[] = [],
  options: {
    readonly positional?: readonly string[];
    readonly booleanFlags?: readonly string[];
  } = {},
): CommandSpec {
  return {
    usage: `mentor-state ${usage}`,
    positional: options.positional,
    valueFlags,
    booleanFlags: options.booleanFlags ?? [],
  };
}

const COMMANDS = {
  show: spec("show"),
  "get-profile": spec("get-profile"),
  "record-evidence": spec(
    "record-evidence --topic <id> --channel <observed|explain-back|quiz|self-report> --result <positive|negative>",
    ["topic", "channel", "result"],
  ),
  recompute: spec("recompute --topic <id> [--claim <level>]", [
    "topic",
    "claim",
  ]),
  "record-batch": spec(
    "record-batch --topic <id> --events <channel:result,...> [--pass <pass|fail>] [--claim <level>]",
    ["topic", "events", "pass", "claim"],
  ),
  introduce: spec("introduce --topic <id>", ["topic"]),
  "reset-topic": spec("reset-topic --topic <id> [--undo]", ["topic"], {
    booleanFlags: ["undo"],
  }),
  "record-pass": spec("record-pass --topic <id> --result <pass|fail>", [
    "topic",
    "result",
  ]),
  "set-mute": spec("set-mute <on|off>", [], { positional: ON_OFF }),
  "set-topic-mute": spec("set-topic-mute <on|off> --topic <id>", ["topic"], {
    positional: ON_OFF,
  }),
  "exclude-project": spec(
    "exclude-project <add|remove> --path <absolute path>",
    ["path"],
    { positional: ["add", "remove"] },
  ),
  "get-goals": spec("get-goals"),
  "set-goals": spec("set-goals --text <text>", ["text"]),
  export: spec("export --to <absolute path>", ["to"]),
  import: spec("import --from <absolute path> --replace", ["from"], {
    booleanFlags: ["replace"],
  }),
  purge: spec("purge --confirm", [], { booleanFlags: ["confirm"] }),
  topics: spec("topics"),
  "set-topic-override": spec(
    "set-topic-override --topic <id> [--enabled <true|false>] [--target <level>] [--style <style>] | --topic <id> --reset",
    ["topic", "enabled", "target", "style"],
    { booleanFlags: ["reset"] },
  ),
  "set-changelog-version": spec("set-changelog-version --version <version>", [
    "version",
  ]),
  tracks: spec("tracks [--code <code> [--domain <id>]]", ["code", "domain"]),
  "set-track": spec("set-track --code <code> | --clear", ["code"], {
    booleanFlags: ["clear"],
  }),
  "exam-begin": spec(
    "exam-begin --track <code> --mode <drill|mock> --items <spec;spec...>",
    ["track", "mode", "items"],
  ),
  "exam-answer": spec("exam-answer --answers <letters;letters...>", [
    "answers",
  ]),
  readiness: spec("readiness [--track <code>]", ["track"]),
  "exam-items": spec("exam-items [--track <code>] [--limit <n>]", [
    "track",
    "limit",
  ]),
  "exam-void": spec("exam-void [--at <ms> --session <id>]", ["at", "session"]),
  "exam-unvoid": spec("exam-unvoid --at <ms> --session <id>", [
    "at",
    "session",
  ]),
} as const satisfies Readonly<Record<string, CommandSpec>>;

type CommandName = keyof typeof COMMANDS;

const GENERAL_USAGE = `${GLOBAL_USAGE}; commands: ${Object.keys(COMMANDS).join(", ")}`;

function isCommandName(value: string | undefined): value is CommandName {
  return value !== undefined && Object.hasOwn(COMMANDS, value);
}

/**
 * What {@link runCommand} needs from its caller.
 *
 * @example
 * ```ts
 * import type { CliContext } from "./commands.ts";
 * const ctx: CliContext = {
 *   dir: "/var/data/m3l",
 *   now: Date.now(),
 *   session: "sess_1",
 *   bundled: [],
 * };
 * ```
 */
export interface CliContext {
  /** The data directory; validated by the store functions. */
  readonly dir: string;
  /** The current time in epoch milliseconds; finite and non-negative. */
  readonly now: number;
  /** The Claude Code session id; must pass `parseSessionId`. */
  readonly session: string;
  /**
   * The bundled topic catalog (`data/topic-catalog.json`, already parsed).
   * Absent means an EMPTY catalog, so every topic command then fails as an
   * unknown topic: callers must pass it.
   */
  readonly bundled?: readonly CatalogEntry[];
  /**
   * Lock tuning over the CLI defaults, a test seam; real callers leave it
   * out (see `lockedState` in `./env.ts`).
   */
  readonly lock?: LockOptions;
}

/**
 * The outcome of one command: an exit code and the full stdout and stderr
 * text. On success `stdout` is one JSON document plus `"\n"` and `stderr`
 * is empty; on failure `stdout` is empty and `stderr` is one line.
 *
 * @example
 * ```ts
 * import type { CliResult } from "./commands.ts";
 * const ok: CliResult = { exitCode: 0, stdout: "{\"muted\":true}\n", stderr: "" };
 * ```
 */
export interface CliResult {
  /** 0 success, 1 a data or argument failure, 2 a usage error. */
  readonly exitCode: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
}

function checkContext(ctx: CliContext): CommandEnv {
  const now = ctx.now;
  if (typeof now !== "number" || !Number.isFinite(now) || now < 0) {
    throw new RangeError("now must be a finite, non-negative number");
  }
  const session = parseSessionId(ctx.session);
  if (!session.ok) throw new RangeError(session.reason);
  return {
    dir: ctx.dir,
    now,
    session: session.value,
    bundled: ctx.bundled ?? [],
    ...(ctx.lock !== undefined ? { lock: ctx.lock } : {}),
  };
}

function dispatch(
  name: CommandName,
  argv: readonly string[],
  env: CommandEnv,
): Promise<unknown> {
  const args = parseArgs(argv, COMMANDS[name]);
  switch (name) {
    case "show":
      return show(env);
    case "get-profile":
      return getProfile(env);
    case "record-evidence":
      return recordEvidence(args, env);
    case "recompute":
      return recompute(args, env);
    case "record-batch":
      return recordBatch(args, env);
    case "introduce":
      return introduce(args, env);
    case "reset-topic":
      return resetTopic(args, env);
    case "record-pass":
      return recordPass(args, env);
    case "set-mute":
      return setMute(args, env);
    case "set-topic-mute":
      return setTopicMute(args, env);
    case "exclude-project":
      return excludeProject(args, env);
    case "get-goals":
      return getGoals(env);
    case "set-goals":
      return setGoals(args, env);
    case "export":
      return exportData(args, env);
    case "import":
      return importData(args, env);
    case "purge":
      return purge(args, env);
    case "topics":
      return topics(env);
    case "set-topic-override":
      return setTopicOverride(args, env);
    case "set-changelog-version":
      return setChangelogVersion(args, env);
    case "tracks":
      return tracks(args, env);
    case "set-track":
      return setTrack(args, env);
    case "exam-begin":
      return examBegin(args, env);
    case "exam-answer":
      return examAnswer(args, env);
    case "readiness":
      return readiness(args, env);
    case "exam-items":
      return examItems(args, env);
    case "exam-void":
      return examVoid(args, env);
    case "exam-unvoid":
      return examUnvoid(args, env);
  }
}

function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, " ");
}

function failure(exitCode: 1 | 2, stderr: string): CliResult {
  return { exitCode, stdout: "", stderr: `${oneLine(stderr)}\n` };
}

function mapError(error: unknown, usage: string): CliResult {
  if (error instanceof CliUsageError) return failure(2, `usage: ${usage}`);
  if (error instanceof MentorStateError) {
    return failure(1, `${error.code}: ${error.message}`);
  }
  if (error instanceof RangeError || error instanceof TypeError) {
    return failure(1, `invalid-argument: ${error.message}`);
  }
  throw error;
}

/**
 * Runs one `mentor-state` command. Never reads `process`, never writes to
 * the console and never exits: the caller prints `stdout`/`stderr` and
 * exits with `exitCode`.
 *
 * A usage error (unknown command; a missing, extra, repeated or invalid
 * argument; a topic not in the merged catalog) yields exit 2 and the fixed
 * usage line of the command. A `MentorStateError` yields exit 1 and
 * `<code>: <message>`; a `RangeError` or `TypeError` from a deeper layer
 * yields exit 1 and `invalid-argument: <message>`. That mapping is by error
 * class alone, so a `RangeError`/`TypeError` from a bug deeper down is
 * reported the same way. No argument value is
 * written to `stderr` by this module; a deeper layer's message is forwarded
 * as is (those messages are fixed text). Any other error is rethrown.
 *
 * Every command that changes stored data does its whole read-modify-write
 * under the data lock (`../internal/lock.ts`), so concurrent invocations
 * serialize; one that cannot get the lock in time fails with
 * `LOCK_TIMEOUT` (exit 1) and changes nothing. Read-only commands never lock.
 *
 * @param argv - The command name followed by its arguments.
 * @param ctx - The data directory, clock, session and bundled catalog.
 * @throws RangeError when `ctx.now` is not finite and non-negative, or
 * `ctx.session` is not a valid session id (checked before anything else).
 *
 * @example
 * ```ts
 * import { runCommand } from "./commands.ts";
 * const result = await runCommand(["set-mute", "on"], {
 *   dir: "/var/data/m3l",
 *   now: Date.now(),
 *   session: "sess_1",
 *   bundled: [],
 * });
 * // result: { exitCode: 0, stdout: "{\"muted\":true}\n", stderr: "" }
 * ```
 */
export async function runCommand(
  argv: readonly string[],
  ctx: CliContext,
): Promise<CliResult> {
  const env = checkContext(ctx);
  const [name, ...rest] = argv;
  if (!isCommandName(name)) return failure(2, `usage: ${GENERAL_USAGE}`);
  let value: unknown;
  try {
    value = await dispatch(name, rest, env);
  } catch (error) {
    return mapError(error, COMMANDS[name].usage);
  }
  const json: unknown = JSON.stringify(value);
  if (typeof json !== "string") {
    throw new TypeError("command output does not serialize to JSON");
  }
  return { exitCode: 0, stdout: `${json}\n`, stderr: "" };
}
