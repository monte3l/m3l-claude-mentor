/**
 * The `UserPromptSubmit` hook process entry (`dist/hooks/entry-user-prompt-submit.js`), run by
 * `hooks/hooks.json`. It runs only as the process entry point: importing
 * it does nothing.
 *
 * Every plugin module is loaded with a dynamic `import()`, so a broken or
 * partial install cannot crash the hook. A failure while loading writes the
 * fixed stderr note `could not start; ignored`; a failure from `runHook`
 * after loading writes `failed unexpectedly; ignored`. Either way stdout is
 * untouched, the exit code is 0 and the error itself is never echoed (it may
 * carry input or paths).
 */
export {};
//# sourceMappingURL=entry-user-prompt-submit.d.ts.map