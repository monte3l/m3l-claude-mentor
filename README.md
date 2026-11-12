# m3l-claude-mentor

[![CI](https://github.com/monte3l/m3l-claude-mentor/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/monte3l/m3l-claude-mentor/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/monte3l/m3l-claude-mentor/badge)](https://securityscorecards.dev/viewer/?uri=github.com/monte3l/m3l-claude-mentor)
[![REUSE](https://github.com/monte3l/m3l-claude-mentor/actions/workflows/reuse.yml/badge.svg?branch=main)](https://github.com/monte3l/m3l-claude-mentor/actions/workflows/reuse.yml)

m3l-claude-mentor is a Claude Code plugin that mentors one learner on Claude
and Claude Code. It keeps a private map of what you know, adds at most one short
tip when it fits what you are doing, and teaches, quizzes and answers questions
on request. It stays quiet on topics you have already shown you know. The
docs are at [claude-mentor.monte3l.com](https://claude-mentor.monte3l.com).

## Who is this for

- Someone **learning Claude Code while using it** who wants help that arrives
  inside their real work, not in a separate course.
- Someone who **already knows parts of it** and wants the mentor to skip those,
  and to check a claim kindly instead of taking it on trust.
- Someone who wants to **keep up with what changes** in Claude Code, filtered to
  their own goals.

## Quickstart

You need Claude Code and Node (see [Requirements](#requirements)).

1. Install the plugin from the monte3l catalog. From your shell:

   ```bash
   claude plugin marketplace add monte3l/m3l-plugins
   claude plugin install m3l-claude-mentor@monte3l
   ```

   Or inside a Claude Code session:

   ```text
   /plugin marketplace add monte3l/m3l-plugins
   /plugin install m3l-claude-mentor@monte3l
   ```

   To add the marketplace and install in one step, use
   `claude plugin install m3l-claude-mentor --marketplace monte3l/m3l-plugins`
   (Claude Code 2.1.292 or newer) or
   `/plugin install m3l-claude-mentor --marketplace monte3l/m3l-plugins`
   (2.1.275 or newer).

   The shell form installs at user scope unless you pass `--scope project` or
   `--scope local`. The session form opens the plugin's details and asks you to
   pick a scope.

2. Ask for a lesson, for example `/m3l-claude-mentor:teach hooks`. The mentor
   runs a short lesson, then records what you showed it. After a few prompts
   about a topic you have not mastered, you may see one `💡 Mentor tip:` line.

To go deeper, see [Skills](#skills) and [Settings](#settings).

## How it works

The plugin has four parts. **Hooks** are the deterministic part: they load your
profile at session start, decide whether a tip is due, and note which features
you use. **Skills** are the on-demand part: lessons, quizzes, lookups and
verification. **Agents** do isolated work: one fetches the official docs, one
judges your answers. A small CLI, `dist/cli/mentor-state.js`, is the only way
skills read or write your state, so Markdown never edits the data files.

Each topic has a level, from Unseen up to Fluent, computed per competency
dimension from your own evidence: quiz answers, explain-back answers, observed
use and self-reports. A self-report never counts for more than Claimed. A tip
needs a topic you have not mastered, that relates to the current task, and a
quiet gap since the last tip. The full design is in [`DESIGN.md`](DESIGN.md).

State lives in the plugin data directory, outside your projects. Only
feature-usage signals are stored, such as "created a skill", never conversation
content. The hooks never block your work: if one fails, it exits with a single
stderr line.

The `docs-researcher` agent uses Claude Code's web fetch tool on
`code.claude.com` only, and `mastery-assessor` can only read files you name.
Both are read-only. The opt-in output style
`/output-style m3l-claude-mentor:mentor` gives a clear, encouraging teaching
voice and keeps Claude Code's normal coding behaviour. It is never applied
automatically.

## Skills

Skills are namespaced `/m3l-claude-mentor:<name>`. Say "stop tips" or "resume
tips" at any time, in plain words.

| Skill       | Use it to                                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------------- |
| `teach`     | Learn a topic in a short lesson, in a style matched to the topic                                                     |
| `ask`       | Get a reference answer sourced from the live docs, with a link                                                       |
| `quiz`      | Practise recall on what is due for review                                                                            |
| `whats-new` | See the changelog digest since your last session, filtered to your goals                                             |
| `assess`    | Have a claimed level checked with a verification probe                                                               |
| `profile`   | See or change goals, mutes, project exclusions and catalog overrides, and export, import or delete everything stored |

## Settings

Both options are plugin options in `/config`.

| Option               | Default | Meaning                                                                                          |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| `dial`               | 2       | Tip frequency from 0 (off) to 5 (most frequent). At 2 the minimum gap between tips is 30 minutes |
| `transcriptAnalysis` | true    | Let the mentor note which features you use (feature names only, stored locally)                  |

## Manage the plugin

| Task                           | From your shell                                                                                          | Inside a session                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Update                         | `claude plugin update m3l-claude-mentor@monte3l`                                                         | `/plugin`, then **Installed**, the plugin, **Update now**                                    |
| Update automatically           | Not available                                                                                            | `/plugin`, then **Marketplaces**, `monte3l`, **Enable auto-update**                          |
| Turn off or on                 | `claude plugin disable m3l-claude-mentor@monte3l`, then `claude plugin enable m3l-claude-mentor@monte3l` | `/plugin disable m3l-claude-mentor@monte3l`, then `/plugin enable m3l-claude-mentor@monte3l` |
| Uninstall                      | `claude plugin uninstall m3l-claude-mentor@monte3l`                                                      | `/plugin uninstall m3l-claude-mentor@monte3l`                                                |
| Run a checkout for one session | `claude --plugin-dir /path/to/m3l-claude-mentor` (build it first with `pnpm install && pnpm build`)      | Not available                                                                                |
| Run an older release           | Check out its tag, `m3l-claude-mentor--vX.Y.Z`, then use `--plugin-dir`                                  | Not available                                                                                |

`monte3l` is not an official Anthropic marketplace, so Claude Code does not
update its plugins automatically unless you turn auto-update on. Claude Code
keeps you on the installed version until the plugin's `version` changes. After a
change inside a session, run `/reload-plugins` to apply it. Uninstalling deletes
your learning state in the plugin data directory unless you pass
`--keep-data`; you can also export it first with the `profile` skill.

## Permissions

A skill can pre-approve its own commands only for the turn in which you invoke
it. In a lesson or quiz, the mentor saves results after your next message, so
Claude Code may ask you to approve those saves. Approving them one by one is
fine. To stop the prompts, add this rule once to your user settings
(`~/.claude/settings.json`, or through `/permissions`):

```json
{
  "permissions": {
    "allow": ["Bash(node */dist/cli/mentor-state.js *)"]
  }
}
```

The rule allows only `node` running a file named `mentor-state.js` under a
`dist/cli/` directory, which is how the plugin saves your learning state. It
does not allow other commands. It does also cover the plugin's delete and
import commands, so for those the `profile` skill's own confirmation question
is then the only guard; remove the rule at any time. To keep native prompts on
delete, import and export, allow only the day-to-day commands instead (these
narrower rules are not yet verified in a live session, and an unmatched
command simply prompts as before):

```json
{
  "permissions": {
    "allow": [
      "Bash(node */dist/cli/mentor-state.js --data-dir * show)",
      "Bash(node */dist/cli/mentor-state.js --data-dir * get-profile)",
      "Bash(node */dist/cli/mentor-state.js --data-dir * topics)",
      "Bash(node */dist/cli/mentor-state.js --data-dir * get-goals)",
      "Bash(node */dist/cli/mentor-state.js --data-dir * introduce *)",
      "Bash(node */dist/cli/mentor-state.js --data-dir * record-batch *)"
    ]
  }
}
```

The `docs-researcher` agent fetches pages with Claude Code's web fetch tool.
A plugin cannot ship permission rules, so the first lookup asks you to allow
the docs domain. Choose "don't ask again for this domain" or add the rule
yourself:

```json
{
  "permissions": {
    "allow": ["WebFetch(domain:code.claude.com)"]
  }
}
```

It only lets the web fetch tool read pages on `code.claude.com`. The agent is
told to fetch nothing else, but the domain prompt is the real guard: if a
lookup ever asks to fetch some other domain, deny it.

## Requirements

- **Claude Code**, a version that supports plugins with `userConfig`. It was
  developed against 2.1.322. `claude plugin eval` needs 2.1.269 or newer.
- **Node** on your `PATH`, because the hooks and the CLI run as
  `node dist/...`. `.node-version` (24) is the authority for development, and
  `engines` in `package.json` says `>=24`.
- **pnpm**, only to build from a checkout. `dist/` is committed, so a plain
  clone already runs.

## Working on this repo

```bash
pnpm install   # dependencies and the lefthook git hooks
pnpm verify    # every gate CI runs: format, lint, harness, toolchain, knip,
               # typecheck, build, tests with coverage, node pin, dist-fresh,
               # version-sync, docs site, file budget
```

```bash
node design/source/docs-kit/build.mjs --check      # docs site gate: links, page coverage, design checksums, doc-versus-code parity
node design/source/docs-kit/build.mjs --out _site  # build the docs site locally
node scripts/doc-parity.mjs                        # only the doc-versus-code parity checks
```

The evals call a real model, so each case run costs about $0.20. Run them
locally, with a cost cap. CI does not run them:

```bash
claude plugin eval . --trust-plugin --ablation none --max-cost-usd 5
```

The seven cases in `evals/` cover skill triggers for natural phrasing, the
over-claim probe, and agent dispatch by `ask` and `assess`. The skill and agent
graders are `with-only` indicators, so they only score with `--ablation none`.
The tip rate limit and the mastered-topic silence are not covered yet, because
the eval docs do not say how to seed `CLAUDE_PLUGIN_DATA`. Results go to
`evals/results/`, which is git-ignored.

Commits are Conventional Commits, signed, with a `Signed-off-by` trailer
(`git commit -s`). See [`CLAUDE.md`](CLAUDE.md) for the conventions and the
agent workflow. The code of conduct, support and contributing guide are the
[organization defaults](https://github.com/monte3l/.github).

### Project docs

- [Documentation site](https://claude-mentor.monte3l.com) -- these pages and
  the skill and agent prompts, built from the repository's Markdown. A page is
  on it only if it is listed in `docs.config.mjs`.
- [`DESIGN.md`](DESIGN.md) -- the design spec: mastery model, ambient engine,
  state and privacy, evaluation, and the decisions behind them.
- [`CLAUDE.md`](CLAUDE.md) -- the commands, conventions and agent operating
  model, written for Claude Code.
- [`SECURITY.md`](SECURITY.md) -- reporting a vulnerability.
- [`design/README.md`](design/README.md) -- the vendored m3l-design copy that
  styles the docs site.
- [`CHANGELOG.md`](CHANGELOG.md) -- what changed in each release.
- [`docs/research/`](docs/research) -- the living trackers for TypeScript and
  Claude Code harness guidance.
- [Glossary](https://github.com/monte3l/m3l-groundwork/blob/main/docs/glossary.md)
  -- terms used in `CLAUDE.md` and the `.claude/` harness.

## Versioning policy

Releases follow [Semantic Versioning](https://semver.org). While the version is
below 1.0.0, a minor release may change any of the contract below. The public
contract is the skill names (`/m3l-claude-mentor:<name>`), the plugin options
`dial` and `transcriptAnalysis`, and the format `export` writes and `import`
reads. The hook internals, the `mentor-state` CLI, the evals and the topic
catalogue are not part of it.

| Bump  | When                                                                                        |
| ----- | ------------------------------------------------------------------------------------------- |
| Major | A skill or option is removed or renamed, or an export from the previous major cannot import |
| Minor | A new skill, option or topic, with existing ones unchanged                                  |
| Patch | A fix, or a docs or CI change, with no change to the contract                               |

Release-please opens one release pull request from the Conventional Commits.
Merging it tags `m3l-claude-mentor--vX.Y.Z` and publishes a GitHub release, and
`CHANGELOG.md` lists what changed.

## License

[MIT](LICENSE).
