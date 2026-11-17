# Architecture

This page shows the actors and actions in the system and every external
interface the released plugin has. The design and the reasons behind it are in
[`spec.md`](spec.md), and the conventions for working in the repository
are in [`CLAUDE.md`](../CLAUDE.md). The threat analysis is in the
[assurance case](assurance-case.md).

## Actors and actions

| Actor                               | What it does here                                                                                                                                                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Learner**                         | Installs the plugin from the `monte3l/m3l-plugins` catalog, works in Claude Code as usual, and invokes the skills `/m3l-claude-mentor:<name>`                                                                               |
| **Claude Code**                     | Loads the plugin, runs the hooks with the event JSON on stdin, substitutes `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}`, and runs a skill's pre-approved command                                                     |
| **Hooks** (`src/hooks/entry-*.ts`)  | Load the profile at session start, decide whether a tip is due, record usage signals and activity. They read and write the state files only, make no network call and never block                                           |
| **Skills** (`skills/*/SKILL.md`)    | Teach, answer, quiz, summarize what changed, verify a claim and manage the profile. They read and write state only through the CLI                                                                                          |
| **CLI** (`src/cli/mentor-state.ts`) | The single way a skill reads or changes the stored state, including export, import and deletion                                                                                                                             |
| **Agents** (`agents/*.md`)          | `docs-researcher` fetches pages from `code.claude.com` with the web fetch tool. `mastery-assessor` reads files the learner names and judges answers. Both are read-only                                                     |
| **Maintainers**                     | Review and merge pull requests, and merge the release pull request                                                                                                                                                          |
| **Contributor**                     | Opens issues and pull requests                                                                                                                                                                                              |
| **CI (GitHub Actions)**             | Runs the tests, coverage gate, style and lint checks, docs gate, scanners and the weekly Scorecard. Holds read-only tokens and no secrets, except the jobs named in [`SECURITY.md`](../SECURITY.md#secrets-and-credentials) |
| **Release workflow**                | Opens a release pull request, and on merge tags the commit and publishes the release. It also tells the `m3l-plugins` catalog                                                                                               |

## Data flow

```text
Claude Code event -stdin JSON-> src/hooks/entry-*.ts -> state files in ${CLAUDE_PLUGIN_DATA}
                                          |                         ^
                                          | additionalContext       | read and write
                                          v                         |
                                   Claude (tip line)    skill -> src/cli/mentor-state.ts
```

The state is `profile.json`, `evidence.jsonl`, `state.json`, and the optional
`goals.md` and `catalog.json`. It stays on the learner's machine. Only
feature-usage signals are stored, never conversation content.

## External interfaces

**Interface 1: the skills.** `teach`, `ask`, `quiz`, `whats-new`, `assess` and
`profile`, invoked as `/m3l-claude-mentor:<name>`. Each pre-approves exactly
`Bash(node ${CLAUDE_PLUGIN_ROOT}/src/cli/mentor-state.ts *)` through its
`allowed-tools`, and nothing else. This is part of the public contract.

**Interface 2: the plugin options.** `dial` (0 to 5, default 2) and
`transcriptAnalysis` (default on), which Claude Code hands to the hooks as
`CLAUDE_PLUGIN_OPTION_DIAL` and `CLAUDE_PLUGIN_OPTION_TRANSCRIPTANALYSIS`. This
is part of the public contract.

**Interface 3: hook events.** The hooks read the JSON Claude Code sends for
`SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Stop` and `PostCompact`, and
return `additionalContext` for the first two. Claude Code owns the payload
format, so it is an input and not a promise made by this project. A payload that
does not parse is ignored, and the hook exits 0.

**Interface 4: the CLI.** `mentor-state` takes a leading
`--data-dir <absolute path>` and one command. The commands are listed in
[`spec.md`](spec.md#5-plugin-architecture). It is an implementation detail
of the skills and not part of the contract.

**Interface 5: the export format.** `export` writes a JSON bundle of the whole
state and `import` reads one back after validating it against the schema. This
is part of the public contract.

**Interface 6: the agents and the network.** `docs-researcher` has only the web
fetch tool and is told to read pages on `code.claude.com`. The first fetch of a
domain asks the learner for permission, because a plugin cannot ship permission
rules. This is the only network use in the plugin.

**Interface 7: distribution.** The plugin is installed from the
`monte3l/m3l-plugins` catalog, which pins a release tag and commit over HTTPS.
Nothing is built and no generated file is committed: Node runs `src/*.ts` directly by removing the types, so the hooks and CLI run from a plain clone.
The docs site at `claude-mentor.monte3l.com` is static HTML deployed to
Cloudflare Workers Static Assets.
