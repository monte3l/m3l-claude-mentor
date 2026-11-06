/**
 * The `mentor-state` CLI process entry (`dist/cli/mentor-state.js`). It runs
 * only as the process entry point: importing it does nothing. It never calls
 * `process.exit()`; it sets `process.exitCode` so pending writes flush.
 */
import { isMentorStateError } from "../internal/errors.js";
import { loadBundledCatalog } from "../internal/bundled-catalog.js";
import { resolveDataDir } from "../internal/paths.js";
import { parseSessionId } from "../internal/schema.js";
import { isMainModule } from "../hooks/main-guard.js";
import { oneLine } from "../hooks/runtime.js";
import { runCommand } from "./commands.js";
const SESSION_ENV = "CLAUDE_SESSION_ID";
const FALLBACK_SESSION = "cli";
/** The session id from the environment when valid, else `"cli"`. */
function sessionFrom(env) {
    const raw = Object.hasOwn(env, SESSION_ENV)
        ? env[SESSION_ENV]
        : undefined;
    return parseSessionId(raw).ok && typeof raw === "string"
        ? raw
        : FALLBACK_SESSION;
}
/**
 * Maps an error thrown outside `runCommand`'s own mapping to exit 1 with one
 * stderr line: a MentorStateError gives `CODE: message` (fixed text); any
 * other error only its name, so no input is echoed.
 */
function failureOf(error) {
    let line = "internal-error: UnknownError";
    try {
        if (isMentorStateError(error)) {
            line = `${error.code}: ${error.message}`;
        }
        else if (error instanceof Error) {
            const raw = error.name;
            line = `internal-error: ${typeof raw === "string" && raw !== "" ? raw : "Error"}`;
        }
    }
    catch {
        // An accessor on the thrown value failed; keep the fixed label.
    }
    return { exitCode: 1, stdout: "", stderr: `${oneLine(line)}\n` };
}
async function main() {
    let result;
    try {
        const env = process.env;
        result = await runCommand(process.argv.slice(2), {
            dir: resolveDataDir(env),
            now: Date.now(),
            session: sessionFrom(env),
            bundled: await loadBundledCatalog(),
        });
    }
    catch (error) {
        result = failureOf(error);
    }
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
}
if (isMainModule(import.meta, process.argv[1])) {
    await main();
}
//# sourceMappingURL=mentor-state.js.map