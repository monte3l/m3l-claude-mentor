# Export, import and delete

Always ask for an absolute path; never choose one silently. Wrap the path in single
quotes, escaping an embedded `'` as `'\''`; never use double quotes or backticks.

## Export

Say the exact target path first, and ask before overwriting an existing file.

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/cli/mentor-state.js --data-dir ${CLAUDE_PLUGIN_DATA} export --to '<absolute path>'
```

Report the path written. The file holds the learner's profile and settings; tell them
to keep it private.

## Import (REPLACES everything)

Before running anything, tell the learner: "This replaces ALL stored mentor data
(profile, evidence, goals, catalog, state) with the contents of that file. Please
confirm explicitly if you want that." Wait for a clear yes. Suggest an export first.

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/cli/mentor-state.js --data-dir ${CLAUDE_PLUGIN_DATA} import --from '<absolute path>' --replace
```

## Delete everything

Before running anything, list what goes: the profile, the evidence log, goals, catalog
overrides and state. Say it cannot be undone and suggest an export first. Ask the
learner to confirm explicitly. Only after a clear yes:

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/cli/mentor-state.js --data-dir ${CLAUDE_PLUGIN_DATA} purge --confirm
```

If the command fails, say so, do not claim anything was deleted or replaced, and do
not retry. Afterwards, on success, confirm that the mentor now holds nothing.
