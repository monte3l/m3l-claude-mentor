/**
 * The `SessionStart` hook process entry (`dist/hooks/entry-session-start.js`), run by
 * `hooks/hooks.json`. It runs only as the process entry point: importing
 * it does nothing.
 */
import { sessionStartHandler } from "./handlers/session-start.js";
import { isMainModule } from "./main-guard.js";
import { runHook } from "./process-shell.js";
if (isMainModule(import.meta, process.argv[1])) {
    await runHook("SessionStart", sessionStartHandler);
}
//# sourceMappingURL=entry-session-start.js.map