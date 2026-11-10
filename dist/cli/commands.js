import { MentorStateError } from "../internal/errors.js";
import { parseSessionId } from "../internal/schema.js";
import { CliUsageError, parseArgs } from "./args.js";
import { recordBatch } from "./batch-commands.js";
import { setTopicOverride, topics } from "./catalog-commands.js";
import { GLOBAL_USAGE } from "./global-options.js";
import { excludeProject, exportData, getGoals, importData, purge, recordEvidence, setChangelogVersion, setGoals, setMute, setTopicMute, show, } from "./data-commands.js";
import { getProfile, introduce, recompute, recordPass, } from "./profile-commands.js";
const ON_OFF = ["on", "off"];
function spec(usage, valueFlags = [], options = {}) {
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
    "record-evidence": spec("record-evidence --topic <id> --channel <observed|explain-back|quiz|self-report> --result <positive|negative>", ["topic", "channel", "result"]),
    recompute: spec("recompute --topic <id> [--claim <level>]", [
        "topic",
        "claim",
    ]),
    "record-batch": spec("record-batch --topic <id> --events <channel:result,...> [--pass <pass|fail>] [--claim <level>]", ["topic", "events", "pass", "claim"]),
    introduce: spec("introduce --topic <id>", ["topic"]),
    "record-pass": spec("record-pass --topic <id> --result <pass|fail>", [
        "topic",
        "result",
    ]),
    "set-mute": spec("set-mute <on|off>", [], { positional: ON_OFF }),
    "set-topic-mute": spec("set-topic-mute <on|off> --topic <id>", ["topic"], {
        positional: ON_OFF,
    }),
    "exclude-project": spec("exclude-project <add|remove> --path <absolute path>", ["path"], { positional: ["add", "remove"] }),
    "get-goals": spec("get-goals"),
    "set-goals": spec("set-goals --text <text>", ["text"]),
    export: spec("export --to <absolute path>", ["to"]),
    import: spec("import --from <absolute path> --replace", ["from"], {
        booleanFlags: ["replace"],
    }),
    purge: spec("purge --confirm", [], { booleanFlags: ["confirm"] }),
    topics: spec("topics"),
    "set-topic-override": spec("set-topic-override --topic <id> [--enabled <true|false>] [--target <level>] [--style <style>] | --topic <id> --reset", ["topic", "enabled", "target", "style"], { booleanFlags: ["reset"] }),
    "set-changelog-version": spec("set-changelog-version --version <version>", [
        "version",
    ]),
};
const GENERAL_USAGE = `${GLOBAL_USAGE}; commands: ${Object.keys(COMMANDS).join(", ")}`;
function isCommandName(value) {
    return value !== undefined && Object.hasOwn(COMMANDS, value);
}
function checkContext(ctx) {
    const now = ctx.now;
    if (typeof now !== "number" || !Number.isFinite(now) || now < 0) {
        throw new RangeError("now must be a finite, non-negative number");
    }
    const session = parseSessionId(ctx.session);
    if (!session.ok)
        throw new RangeError(session.reason);
    return {
        dir: ctx.dir,
        now,
        session: session.value,
        bundled: ctx.bundled ?? [],
    };
}
function dispatch(name, argv, env) {
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
    }
}
function oneLine(text) {
    return text.replace(/[\r\n]+/g, " ");
}
function failure(exitCode, stderr) {
    return { exitCode, stdout: "", stderr: `${oneLine(stderr)}\n` };
}
function mapError(error, usage) {
    if (error instanceof CliUsageError)
        return failure(2, `usage: ${usage}`);
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
 * Known limitation: commands that update state or the profile do a
 * read-modify-write with no lock, so two concurrent invocations race and the
 * last writer wins.
 *
 * @param argv - The command name followed by its arguments.
 * @param ctx - The data directory, clock, session and bundled catalog.
 * @throws RangeError when `ctx.now` is not finite and non-negative, or
 * `ctx.session` is not a valid session id (checked before anything else).
 *
 * @example
 * ```ts
 * import { runCommand } from "./commands.js";
 * const result = await runCommand(["set-mute", "on"], {
 *   dir: "/var/data/m3l",
 *   now: Date.now(),
 *   session: "sess_1",
 *   bundled: [],
 * });
 * // result: { exitCode: 0, stdout: "{\"muted\":true}\n", stderr: "" }
 * ```
 */
export async function runCommand(argv, ctx) {
    const env = checkContext(ctx);
    const [name, ...rest] = argv;
    if (!isCommandName(name))
        return failure(2, `usage: ${GENERAL_USAGE}`);
    let value;
    try {
        value = await dispatch(name, rest, env);
    }
    catch (error) {
        return mapError(error, COMMANDS[name].usage);
    }
    const json = JSON.stringify(value);
    if (typeof json !== "string") {
        throw new TypeError("command output does not serialize to JSON");
    }
    return { exitCode: 0, stdout: `${json}\n`, stderr: "" };
}
//# sourceMappingURL=commands.js.map