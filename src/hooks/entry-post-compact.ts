/**
 * The `PostCompact` hook process entry (`src/hooks/entry-post-compact.ts`), run by
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

/**
 * Whether this module is the process entry point, using only `node:`
 * built-ins: `realpath(process.argv[1])` equals the real path of this
 * module's file. Any failure yields `false`.
 */
async function isProcessEntry(): Promise<boolean> {
  try {
    const [{ realpathSync }, { fileURLToPath }] = await Promise.all([
      import("node:fs"),
      import("node:url"),
    ]);
    const argv1 = process.argv[1];
    if (argv1 === undefined || argv1 === "") return false;
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    // Unresolvable path or unloadable built-in: not provably the entry point.
    return false;
  }
}

let loaded = false;
try {
  const { isMainModule } = await import("./main-guard.ts");
  if (isMainModule(import.meta, process.argv[1])) {
    const [{ runHook }, { postCompactHandler }] = await Promise.all([
      import("./process-shell.ts"),
      import("./handlers/post-compact.ts"),
    ]);
    loaded = true;
    await runHook("PostCompact", postCompactHandler, { catalog: false });
  }
} catch {
  // This path uses only node: built-ins because the plugin's own modules
  // (main-guard, process-shell, runtime's hookNote) may be the broken part.
  // The stderr error listener is inline for the same reason: no plugin
  // import is allowed here. This note is the only signal of a broken
  // install, and it is written only when this file is the process entry.
  if (await isProcessEntry()) {
    process.stderr.on("error", () => undefined);
    const reason = loaded ? "failed unexpectedly" : "could not start";
    process.stderr.write(
      `m3l-claude-mentor: PostCompact: ${reason}; ignored\n`,
    );
    process.exitCode = 0;
  }
}
