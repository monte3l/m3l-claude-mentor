# Harness refresh tracker

<!-- harness-refresh: last-verified=2026-11-04 claude-code-version=2.1.318 -->

Living record of `harness-guidance` (refresh mode) sweeps — the per-facet,
per-source state a run diffs against, so each sweep reports what
**changed** since the last one instead of rediscovering the whole `.claude/`
surface from scratch. Updated **in place** on every run, never as a new
dated file.

First sweep run 2026-11-04 (`/customize`, plugin kind). CHANGELOG read for 2.1.304 to 2.1.318 only (no recorded prior version; older entries not read).

## Outstanding drift

| Item                                                                             | Status                                                                                                                                                      |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Read(./.env)` deny anchored to project root                                     | **Applied 2026-11-04**: widened to `Read(**/.env)` and `Read(**/.env.*)`.                                                                                   |
| PostToolUse `if: Write(*.ts)` entries (Write path rules never match per docs)    | **Applied**: collapsed to one `Write\|Edit` handler; `post-edit-verify.mjs` filters by extension itself.                                                    |
| `Bash` matcher may not cover Monitor-started commands                            | **Applied**: added a `Monitor` matcher running `guard-hub-src-writes.mjs`. Needs a live Monitor test to confirm it fires.                                   |
| `guard-js-extension.mjs` ignored MultiEdit `edits[].new_string`                  | **Applied**.                                                                                                                                                |
| `agent-dispatch.md` permissionMode and fork-wait wording                         | **Applied**: permissionMode precedence corrected; fork mode blocks waiting for spokes, so sequential TDD needs `CLAUDE_CODE_FORK_SUBAGENT=0` interactively. |
| Reviewers on Opus 5.5 vs Sonnet 5.5                                              | Deferred by user; no official reviewer-tier guidance.                                                                                                       |
| `disable-model-invocation` on `finishing-work` / `creating-prs`                  | Deferred by user.                                                                                                                                           |
| `permissions.blockWritesOutsideWorkingDirectories`                               | Not adopted (needs 2.1.314+; no minimum version pinned).                                                                                                    |
| `CLAUDE.md` at 198 lines vs official under-200 target                            | No headroom; consider moving detail into `.claude/rules/`.                                                                                                  |
| Reference files over 100 lines lack a TOC                                        | Optional (`.claude/skills/customize/step-0-reconcile.md`, `step-3-round-1.md`, typescript-guidance `references/`).                                          |
| `.claude/skills/customize/step-3-round-1.md` claim "no folder-trust auto-prompt" | No source in fetched docs; soften or cite.                                                                                                                  |
| Plugin ids in `enabledPlugins` not checked against the marketplace               | Open; verify with `/plugin` after install.                                                                                                                  |
| Optional hardening: PreToolUse Bash validator in reviewer agents' frontmatter    | Open (Bash is not read-only).                                                                                                                               |

## Facet state

| Facet                        | Last verified | Notes                                                                                                                                                               |
| ---------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `models-tiering`             | 2026-11-04    | All five pins (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`) Active; effort `medium` valid. Bedrock/Vertex/Foundry resolution of bare IDs unverified. |
| `cc-features-settings`       | 2026-11-04    | `enabledPlugins` format and no-local-install behaviour confirmed. No official CI lane set exists (coverage gap); repo lanes match `verify-steps.mjs` groups.        |
| `agent-subagent-design`      | 2026-11-04    | Frontmatter fields valid; `disallowedTools: Agent` still the flat-roster method. `mcpServers` string-reference mismatch behaviour undocumented.                     |
| `skills-context-engineering` | 2026-11-04    | Descriptions under 1,024 chars; SKILL.md under 500 lines; listing budget 1% of context window.                                                                      |
| `hooks-lifecycle`            | 2026-11-04    | 33 events; `onFailure` needs 2.1.295+, no effect on Stop/SubagentStop/TaskCompleted/TeammateIdle. Hooks reference read to 100k of 286k chars.                       |
