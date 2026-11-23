# m3l-mentor

[![CI](https://github.com/monte3l/m3l-claude-mentor/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/monte3l/m3l-claude-mentor/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/monte3l/m3l-claude-mentor/badge)](https://securityscorecards.dev/viewer/?uri=github.com/monte3l/m3l-claude-mentor)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/16729/badge)](https://www.bestpractices.dev/projects/16729)
[![OpenSSF Baseline](https://www.bestpractices.dev/projects/16729/baseline)](https://www.bestpractices.dev/projects/16729)
[![REUSE status](https://api.reuse.software/badge/github.com/monte3l/m3l-claude-mentor)](https://api.reuse.software/info/github.com/monte3l/m3l-claude-mentor)

m3l-mentor is a Claude Code plugin that mentors one learner on Claude
and Claude Code. It keeps a private map of what you know, adds at most one short
tip when it fits what you are doing, and teaches, quizzes and answers questions
on request. It stays quiet on topics you have already shown you know. The
docs are at [mentor.monte3l.com](https://mentor.monte3l.com).

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
   claude plugin install m3l-mentor@monte3l
   ```

   Or inside a Claude Code session:

   ```text
   /plugin marketplace add monte3l/m3l-plugins
   /plugin install m3l-mentor@monte3l
   ```

   To add the marketplace and install in one step, use
   `claude plugin install m3l-mentor --marketplace monte3l/m3l-plugins`
   (Claude Code 2.1.292 or newer) or
   `/plugin install m3l-mentor --marketplace monte3l/m3l-plugins`
   (2.1.275 or newer).

   The shell form installs at user scope unless you pass `--scope project` or
   `--scope local`. The session form opens the plugin's details and asks you to
   pick a scope.

2. Ask for a lesson, for example `/m3l-mentor:teach hooks`. The mentor
   runs a short lesson, then records what you showed it. After a few prompts
   about a topic you have not mastered, you may see one `💡 Mentor tip:` line.

To go deeper, see [Skills](#skills) and [Settings](#settings).

### Moving from `m3l-claude-mentor`

Until 1.2.0 the plugin was called `m3l-claude-mentor`. The new name is
`m3l-mentor`. If you installed the old one, do this once:

1. Refresh the catalog and install the renamed plugin:

   ```bash
   claude plugin marketplace update monte3l
   claude plugin install m3l-mentor@monte3l
   ```

   Inside a session, use `/plugin marketplace update monte3l` and
   `/plugin install m3l-mentor@monte3l`. The catalog lists the old name under
   `renames`, so Claude Code moves your enabled setting across. If it reports
   that the plugin is not cached, the install command above is all it needs.

2. Use the new skill names: `/m3l-claude-mentor:teach` is now
   `/m3l-mentor:teach`, and every other skill follows the same rule.

3. Start a session. The first one copies your learner state (profile, evidence,
   goals, catalog overrides, exam items and the rest) from the old data
   directory, `~/.claude/plugins/data/m3l-claude-mentor-monte3l/`, into the new
   one, `~/.claude/plugins/data/m3l-mentor-monte3l/`. It copies only files the
   new directory does not have, never changes the old directory, and runs once.
   If it fails, the session still starts and the mentor says so in one line;
   the next session tries again.

4. Once the new plugin has run a session, you can remove the old one with
   `claude plugin uninstall m3l-claude-mentor@monte3l`. Do it after step 3:
   Claude Code deletes a plugin's data directory on uninstall unless you pass
   `--keep-data`.

An export made before the rename (`m3l-claude-mentor-export`) still imports. New
exports are tagged `m3l-mentor-export`.

## How it works

The plugin has four parts. **Hooks** are the deterministic part: they load your
profile at session start, decide whether a tip is due, and note which features
you use. **Skills** are the on-demand part: lessons, quizzes, lookups and
verification. **Agents** do isolated work: one fetches the official docs, one
judges your answers. A small CLI, `src/cli/mentor-state.ts`, is the only way
skills read or write your state, so Markdown never edits the data files.

Each topic has a level, from Unseen up to Fluent, computed per competency
dimension from your own evidence: quiz answers, explain-back answers, observed
use and self-reports. A self-report never counts for more than Claimed. A tip
needs a topic you have not mastered, that relates to the current task, and a
quiet gap since the last tip. The full design is in [`docs/spec.md`](docs/spec.md).

State lives in the plugin data directory, outside your projects. Only
feature-usage signals are stored, such as "created a skill", never conversation
content. The hooks never block your work: if one fails, it exits with a single
stderr line. Writes go through a short lock on the data directory, so two
sessions at once do not overwrite each other; a hook that cannot get the lock
within 2 seconds skips that write instead of waiting.

The `docs-researcher` agent uses Claude Code's web fetch tool on
`code.claude.com` only, and `mastery-assessor` can only read files you name.
Both are read-only. The opt-in output style
`/output-style m3l-mentor:mentor` gives a clear, encouraging teaching
voice and keeps Claude Code's normal coding behaviour. It is never applied
automatically.

## Skills

Skills are namespaced `/m3l-mentor:<name>`. Say "stop tips" or "resume
tips" at any time, in plain words.

| Skill       | Use it to                                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------------- |
| `teach`     | Learn a topic in a short lesson, in a style matched to the topic                                                     |
| `ask`       | Get a reference answer sourced from the live docs, with a link                                                       |
| `quiz`      | Practise recall on what is due for review                                                                            |
| `whats-new` | See the changelog digest since your last session, filtered to your goals                                             |
| `assess`    | Have a claimed level checked with a verification probe                                                               |
| `exam`      | Prepare for a Claude certification exam: practice questions, a per-domain readiness view and a study plan            |
| `profile`   | See or change goals, mutes, project exclusions and catalog overrides, and export, import or delete everything stored |

## Certification prep

The `exam` skill helps you prepare for four official Claude certification exams: Claude Certified Developer - Foundations (`CCDV-F`), Architect - Foundations (`CCAR-F`), Architect - Professional (`CCAR-P`) and Developer - Professional (`CCDV-P`). Try `/m3l-mentor:exam CCAR-F drill`, `mock`, `readiness` or `plan`.

- The practice questions are original, written by Claude from the live docs, and each explanation links its page. They are not real exam questions, and the mentor will not use or discuss real ones.
- **A person does not review the questions or their answer keys.** If a key looks wrong, tell the mentor; when the docs agree with you, it can void that result so it leaves your readiness and levels.
- The readiness view is a coverage and practice indicator built from this plugin's own weights. It is **not a prediction of your exam score** and has not been checked against real results.
- The exam blueprints are short paraphrases of the public exam guides. The guide, not this plugin, is the authority on what an exam covers. A guide that is not yet in force is flagged.
- Stored: your topic levels, plus one line per practice question with its exam, domain, objective, topic, result and time. The question and your answer are never stored.

## Settings

Both options are plugin options in `/config`.

| Option               | Default | Meaning                                                                                          |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| `dial`               | 2       | Tip frequency from 0 (off) to 5 (most frequent). At 2 the minimum gap between tips is 30 minutes |
| `transcriptAnalysis` | true    | Let the mentor note which features you use (feature names only, stored locally)                  |

## Manage the plugin

| Task                           | From your shell                                                                                            | Inside a session                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Update                         | `claude plugin update m3l-mentor@monte3l`                                                                  | `/plugin`, then **Installed**, the plugin, **Update now**                      |
| Update automatically           | Not available                                                                                              | `/plugin`, then **Marketplaces**, `monte3l`, **Enable auto-update**            |
| Turn off or on                 | `claude plugin disable m3l-mentor@monte3l`, then `claude plugin enable m3l-mentor@monte3l`                 | `/plugin disable m3l-mentor@monte3l`, then `/plugin enable m3l-mentor@monte3l` |
| Uninstall                      | `claude plugin uninstall m3l-mentor@monte3l`                                                               | `/plugin uninstall m3l-mentor@monte3l`                                         |
| Run a checkout for one session | `claude --plugin-dir /path/to/m3l-mentor` (nothing to build: it runs from the source)                      | Not available                                                                  |
| Run an older release           | Check out its tag, `m3l-mentor--vX.Y.Z` (`m3l-claude-mentor--vX.Y.Z` up to 1.2.0), then use `--plugin-dir` | Not available                                                                  |

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
    "allow": ["Bash(node */src/cli/mentor-state.ts *)"]
  }
}
```

> [!NOTE]
> If you added this rule for an earlier release, replace
> `dist/cli/mentor-state.js` with `src/cli/mentor-state.ts`. The plugin no
> longer ships a built `dist/` folder, so the old rule matches nothing and the
> approval prompts come back until you change it.

The rule allows only `node` running a file named `mentor-state.ts` under a
`src/cli/` directory, which is how the plugin saves your learning state. It
does not allow other commands. It does also cover the plugin's delete and
import commands, so for those the `profile` skill's own confirmation question
is then the only guard; remove the rule at any time. To keep native prompts on
delete, import and export, allow only the day-to-day commands instead (these
narrower rules were checked in a live session on Claude Code 2.1.327, with the
permission mode set to manual, and an unmatched command simply prompts as
before):

```json
{
  "permissions": {
    "allow": [
      "Bash(node */src/cli/mentor-state.ts --data-dir * show)",
      "Bash(node */src/cli/mentor-state.ts --data-dir * get-profile)",
      "Bash(node */src/cli/mentor-state.ts --data-dir * topics)",
      "Bash(node */src/cli/mentor-state.ts --data-dir * get-goals)",
      "Bash(node */src/cli/mentor-state.ts --data-dir * introduce *)",
      "Bash(node */src/cli/mentor-state.ts --data-dir * record-batch *)"
    ]
  }
}
```

The `docs-researcher` agent fetches pages with Claude Code's web fetch tool.
A plugin cannot ship permission rules, so the first lookup asks you to allow
the docs domain. Choose "don't ask again for this domain" or add the rule
yourself. The Claude Code docs are enough for `teach`, `ask` and `whats-new`.
The `exam` skill also reads the Claude API docs, the Model Context Protocol
docs and Anthropic's engineering posts, so allow these as well if you use it:

```json
{
  "permissions": {
    "allow": [
      "WebFetch(domain:code.claude.com)",
      "WebFetch(domain:platform.claude.com)",
      "WebFetch(domain:modelcontextprotocol.io)",
      "WebFetch(domain:www.anthropic.com)"
    ]
  }
}
```

These only let the web fetch tool read pages on those four official sites. The
agent is told to fetch nothing else (on `www.anthropic.com` only the
`/engineering` pages), but the domain prompt is the real guard: if a lookup
ever asks to fetch some other domain, deny it.

## Requirements

- **Claude Code**, a version that supports plugins with `userConfig`. It was
  checked in a live session on 2.1.327. Older versions that support plugins with
  `userConfig` are expected to work but are untested. `claude plugin eval` needs
  2.1.269 or newer.
- **Node 24.3 or newer** on your `PATH`, because the hooks and the CLI run as
  `node src/...ts`. Node removes the types itself, so nothing is built. Node
  24.0 to 24.2 print an experimental-feature warning every time they run
  TypeScript, and 24.3 does not. `.node-version` (24) is the authority for
  development, and `engines` in `package.json` says `>=24.3.0`.
- **pnpm**, only to work on a checkout: its checks and tests. Nothing is built,
  so a plain clone already runs.

## Working on this repo

```bash
pnpm install   # dependencies and the lefthook git hooks
pnpm verify    # every gate CI runs: format, lint, harness, toolchain, knip,
               # typecheck, tests with coverage, node pin, no-dist,
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
(`git commit -s`). See [`.claude/CLAUDE.md`](.claude/CLAUDE.md) for the conventions and the
agent workflow. The code of conduct and support are the
[organization defaults](https://github.com/monte3l/.github).

### Project docs

- [Documentation site](https://mentor.monte3l.com) -- these pages and
  the skill and agent prompts, built from the repository's Markdown. A page is
  on it only if it is listed in `docs.config.mjs`.
- [`docs/spec.md`](docs/spec.md) -- the specification: mastery model, ambient engine,
  state and privacy, evaluation, and the decisions behind them.
- [`.claude/CLAUDE.md`](.claude/CLAUDE.md) -- the commands, conventions and agent operating
  model, written for Claude Code.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) -- how to report a bug, commit, open a
  pull request and release.
- [`docs/architecture.md`](docs/architecture.md) -- the actors, the data flow
  and every external interface.
- [`docs/assurance-case.md`](docs/assurance-case.md) -- the threat model and why
  each threat is countered.
- [`docs/GOVERNANCE.md`](docs/GOVERNANCE.md) -- who decides, who has access, and
  the Gold criteria this project cannot meet.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) -- what is planned and what is ruled out.
- [`SECURITY.md`](SECURITY.md) -- reporting a vulnerability.
- [`design/README.md`](design/README.md) -- the vendored m3l-design copy that
  styles the docs site.
- [`CHANGELOG.md`](CHANGELOG.md) -- what changed in each release.
- [`docs/research/`](docs/research) -- the living trackers for TypeScript and
  Claude Code harness guidance.
- [Glossary](https://github.com/monte3l/m3l-groundwork/blob/main/docs/glossary.md)
  -- terms used in `CLAUDE.md` and the `.claude/` harness.

## Versioning policy

Releases follow [Semantic Versioning](https://semver.org). From 1.0.0 on, the
public contract below changes only in a major release. The 0.x releases before
that may still change any of it in a minor release.

**The contract** is:

- the seven skill names, invoked as `/m3l-mentor:<name>` (`ask`, `assess`,
  `exam`, `profile`, `quiz`, `teach`, `whats-new`);
- the two plugin options, `dial` and `transcriptAnalysis`, with their meaning and
  ranges;
- the export format that `export` writes and `import` reads. This is format
  version 1, and every 1.x release imports a version 1 export. A later format
  must keep reading version 1;
- the guarantees in [What this project will not do](docs/ROADMAP.md#what-this-project-will-not-do):
  only feature-usage signals are stored, nothing leaves your machine, and a hook
  never blocks your work.

**Not part of the contract:** the hook internals, the `mentor-state` CLI and its
path, the evals, the topic catalogue, and the layout of the plugin data
directory beyond the export format. The skills ship in the same plugin version
as the CLI they call, so no skill ever calls a CLI from another version, and the
CLI can change in any release. The CLI's path has already changed once.

A contract test (`tests/contract/plugin-contract.test.ts`) and a committed
version 1 export (`tests/internal/fixtures/bundle-v1.json`) pin the skill names,
the options and the export format, so a rename or a format change fails CI
instead of slipping into a minor release. Adding a skill or an option does not
fail it, because that is a minor release.

| Bump  | When                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Major | A skill or option is removed or renamed, an export from the previous major cannot import, or a documented guarantee above is weakened |
| Minor | A new skill, option or topic, with existing ones unchanged                                                                            |
| Patch | A fix, or a docs or CI change, with no change to the contract                                                                         |

Renaming the plugin from `m3l-claude-mentor` to `m3l-mentor` changed the
invocation prefix of every skill, so it ships as a major release, 2.0.0. The
export format stays version 1, and an export written under the old name still
imports.

Release-please opens one release pull request from the Conventional Commits.
Merging it tags `m3l-mentor--vX.Y.Z` (releases up to 1.2.0 carry the earlier
name, `m3l-claude-mentor--vX.Y.Z`) and publishes a GitHub release, and
`CHANGELOG.md` lists what changed.

## License

[MIT](LICENSE).
