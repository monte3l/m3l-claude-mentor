# Security assurance case

This page explains why the plugin is reasonably safe to install and run. It
lists what could go wrong, and for each case what stops it and where that is
enforced. It follows the shape the OpenSSF Best Practices badge asks for: a
threat model, the trust boundaries it implies, the secure design principles
applied, and the common weaknesses countered. It also serves as the project's
security assessment and threat model for the Baseline `SA-03` criteria.

It covers the plugin as released: the hooks, the CLI, the skills, the agents and
the manifest. CI and the release path are covered where they handle credentials.
The architecture is in [Architecture](architecture.md).

## Threat model

**Assets:**

- The learner's learning state: topic levels, evidence and goals. It is small
  but personal.
- The learner's conversation, code and tool output, which the hooks can see and
  must never store.
- The learner's machine: the hooks and the CLI run with the user's privileges.
- The plugin's supply chain: the release tag, the catalog pin and the CI that
  builds and publishes the release.
- The repository settings, the release GitHub App credentials and the
  Cloudflare token for the docs site.

**Actors and threats considered:**

| Threat                                                           | Why it matters                                                                |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| A hook stores or leaks conversation content                      | Prompts and tool output are private, and the state may be exported and shared |
| A malformed or hostile hook payload, state file or import bundle | The hooks and the CLI parse JSON and run with the user's privileges           |
| Text the learner or a fetched page supplies steers a skill       | A skill runs shell commands through a pre-approved pattern                    |
| A skill command gains more than it should                        | `allowed-tools` pre-approves a command for a whole turn                       |
| The docs agent follows an instruction inside a fetched page      | A page is untrusted text, and the agent has a network tool                    |
| A hook breaks the learner's work                                 | A failing hook could block a tool call or a prompt                            |
| A compromised GitHub Action or CI dependency                     | It could alter the release or reach a credential                              |
| A pull request from a fork reaching a credential                 | Workflows run code from the branch                                            |
| A tampered release                                               | Users install a pinned tag through the catalog                                |
| An unreviewed or unsigned change reaching `main`                 | It would bypass every other control                                           |

## Attack surface and critical code paths

| Code path                                   | Input                                                      | Exposure                                                                                                                                                                                 |
| ------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hook entry points (`dist/hooks/entry-*.js`) | The event JSON on stdin                                    | Validated at the boundary, with unknown fields ignored. No network, no shell, no `eval`. A failure exits 0 with one stderr line                                                          |
| Prompt and tool-use signal detectors        | Text from the prompt and fields of the tool call           | Pattern matching only. The tool-use extractor reads `tool_name` and `tool_input`, never `tool_response`, and returns only names from a fixed allowlist, never a substring of the payload |
| The state store and `import`                | Files in the data directory and a bundle the learner picks | Parsed and validated against a schema before use. Writes are atomic, and an unreadable file is reported, not trusted                                                                     |
| The CLI arguments                           | Command-line values from a skill                           | The data directory must be an absolute path. Values from the learner are single-quoted by the skill and validated by the CLI                                                             |
| The `docs-researcher` agent                 | Pages on `code.claude.com`                                 | Read-only tool, fetched text treated as data, and the domain prompt is the permission guard                                                                                              |
| CI workflows                                | Pull request branches and metadata                         | Read-only tokens, event values passed through `env:`                                                                                                                                     |

## Trust boundaries

1. **Claude Code to hooks.** The event JSON is Claude Code's own output, but it
   can carry anything a user or a tool produced, so every field is treated as
   untrusted data. It is parsed, reduced to a feature signal and discarded.
2. **Hooks to the learner's session.** Only a short `additionalContext` string
   crosses it, and a skill's output is shown as text. A hook cannot return a
   decision that blocks a tool call.
3. **Skills to the CLI.** A skill pre-approves one command pattern for the turn
   it was invoked in. Destructive commands (`purge`, `import`) run only after an
   explicit confirmation in the `profile` skill.
4. **Agents to the network.** Only `docs-researcher` has a network tool, and
   fetched text is data, never instructions, in the agent and in the skill that
   uses its answer.
5. **Contributor to `main`.** The ruleset needs signed commits, a code-owner
   approval from someone other than the author, resolved review threads and the
   required checks.
6. **CI to credentials.** No workflow uses `pull_request_target` or
   `workflow_run`. Pull request workflows hold read-only tokens.

## Secure design principles applied

| Principle                   | How it shows up                                                                                                         | Where it is enforced                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Least privilege             | Each skill pre-approves one command. Agents list only the tools they need. Workflows start from read-only tokens        | `skills/*/SKILL.md`, `agents/*.md`, `.github/workflows/`, zizmor, tests   |
| Economy of mechanism        | Plain TypeScript on Node's built-in modules, with no runtime dependency                                                 | `package.json`, knip                                                      |
| Fail-safe defaults          | A failing hook exits quietly. A recompute at session start only raises a level. Tips are rate-limited and off at dial 0 | `src/hooks/`, tests                                                       |
| Complete mediation          | Every state change goes through the CLI, and every change to `main` through the ruleset                                 | The skills' `allowed-tools`, the branch ruleset with an empty bypass list |
| Open design                 | Everything is public, and the skills are plain Markdown a user can read before installing                               | The README and the docs site                                              |
| Separation of privilege     | A merge needs a person other than the author, and a release needs the release workflow                                  | Ruleset, `release.yml`                                                    |
| Least common mechanism      | State lives in the plugin's own data directory and is shared with no other plugin                                       | `${CLAUDE_PLUGIN_DATA}`                                                   |
| Psychological acceptability | The mentor adds at most one short tip, can be muted in plain words, and everything stored can be shown or deleted       | The `profile` skill, the README                                           |

## Common implementation weaknesses countered

| Weakness                                     | Counter                                                                                                                        | Where                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| CWE-200 information exposure                 | Only feature names from a fixed allowlist are stored. The extractor never reads tool output and returns no part of the payload | `src/internal/signals.ts`, its tests           |
| CWE-20 improper input validation             | Hook payloads, state files and import bundles are validated, and the CLI rejects relative paths and bad values                 | `src/internal/schema.ts`, `src/cli/`, tests    |
| CWE-78 and CWE-94 command and code injection | No shell and no `eval` in the hooks or CLI. Learner text is single-quoted in skill commands. Workflows use `env:`              | Skill tests, zizmor, CodeQL                    |
| CWE-22 path traversal                        | The data directory must be absolute, and project exclusion compares normalised absolute paths                                  | `src/cli/`, `src/internal/paths.ts`, tests     |
| CWE-367 time-of-check to time-of-use         | Reads do not stat first, and writes are atomic (temporary file, then rename)                                                   | `src/internal/fs-atomic.ts`, CodeQL            |
| CWE-77 prompt injection through fetched text | Fetched pages and agent answers are data, never instructions, and the skills say so                                            | `agents/docs-researcher.md`, the skills' tests |
| CWE-798 hard-coded credentials               | Secret scanning, push protection and Gitleaks on every push                                                                    | `.github/workflows/gitleaks.yml`               |
| CWE-1357 untrusted components                | Actions are pinned by commit SHA, the CI tools by lockfile hash, and Dependabot proposes bumps after a cooldown                | `.github/dependabot.yml`, Scorecard            |
| CWE-829 inclusion of untrusted functionality | A repository setting allows only listed actions and requires SHA pins                                                          | Actions permissions                            |

## Residual risks

- **No locking.** Two hooks or a hook and the CLI writing at once are
  last-writer-wins, so a signal can be lost. The state is advisory, and nothing
  depends on it for safety.
- **Heuristics.** Topic matching and prompt-signal detection are keyword based,
  so a tip can be off-topic or a signal missed. Neither can write more than a
  feature name.
- **Lexical project exclusion.** Excluding a project compares paths as text and
  does not follow symlinks or fold case.
- **A plugin cannot ship permission rules.** The learner chooses the allow rules
  in the README, and the broad one also covers the delete and import commands.
- **The accepted CI install script.** See [`SECURITY.md`](../SECURITY.md).
- **A small maintainer team.** See [Governance](GOVERNANCE.md#bus-factor).
