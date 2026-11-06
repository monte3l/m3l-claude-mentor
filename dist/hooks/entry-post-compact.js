/**
 * The `PostCompact` hook process entry (`dist/hooks/entry-post-compact.js`), run by
 * `hooks/hooks.json`. It runs only as the process entry point: importing
 * it does nothing.
 */
import { postCompactHandler } from "./handlers/post-compact.js";
import { isMainModule } from "./main-guard.js";
import { runHook } from "./process-shell.js";
if (isMainModule(import.meta, process.argv[1])) {
    await runHook("PostCompact", postCompactHandler, { catalog: false });
}
//# sourceMappingURL=entry-post-compact.js.map