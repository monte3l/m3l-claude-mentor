/**
 * The `Stop` hook process entry (`dist/hooks/entry-stop.js`), run by
 * `hooks/hooks.json`. It runs only as the process entry point: importing
 * it does nothing.
 */
import { stopHandler } from "./handlers/stop.js";
import { isMainModule } from "./main-guard.js";
import { runHook } from "./process-shell.js";

if (isMainModule(import.meta, process.argv[1])) {
  await runHook("Stop", stopHandler, { catalog: false });
}
