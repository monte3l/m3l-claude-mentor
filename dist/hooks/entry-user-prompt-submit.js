/**
 * The `UserPromptSubmit` hook process entry (`dist/hooks/entry-user-prompt-submit.js`), run by
 * `hooks/hooks.json`. It runs only as the process entry point: importing
 * it does nothing.
 */
import { userPromptSubmitHandler } from "./handlers/user-prompt-submit.js";
import { isMainModule } from "./main-guard.js";
import { runHook } from "./process-shell.js";
if (isMainModule(import.meta, process.argv[1])) {
    await runHook("UserPromptSubmit", userPromptSubmitHandler);
}
//# sourceMappingURL=entry-user-prompt-submit.js.map