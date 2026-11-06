/**
 * The `PostToolUse` hook process entry (`dist/hooks/entry-post-tool-use.js`), run by
 * `hooks/hooks.json`. It runs only as the process entry point: importing
 * it does nothing.
 */
import { postToolUseHandler } from "./handlers/post-tool-use.js";
import { isMainModule } from "./main-guard.js";
import { runHook } from "./process-shell.js";

if (isMainModule(import.meta, process.argv[1])) {
  await runHook("PostToolUse", postToolUseHandler);
}
