# m3l-claude-mentor

Bootstrapped by [m3l-groundwork](https://github.com/monte3l/m3l-groundwork) —
a deterministic TypeScript + Claude Code project bootstrapper.

## What you just got

A TypeScript project wired up with a strict compiler configuration, ESLint,
Prettier, Vitest (with a coverage gate), and a Claude Code harness under
`.claude/` — agents, skills, hooks, and rules that shape how Claude Code
works in this repository. All of it is deliberately generic: a correct,
working starting point for any TypeScript project, not yet specific to what
m3l-claude-mentor actually does.

## Getting started

```bash
pnpm install
pnpm verify
```

`pnpm verify` runs the same checks CI runs, in one command, so you can catch
a failure locally before pushing. In order: format check, lint, the Claude
Code harness grader, the TypeScript toolchain grader, knip (unused code and
dependencies), typecheck, build, tests with coverage, a package-exports check,
and a Node version pin check. See `CLAUDE.md` for the full command reference and this
project's conventions.

## Using the plugin

m3l-claude-mentor is a Claude Code plugin that mentors one learner on Claude
and Claude Code. To try it from a checkout, build once and load it from the
directory:

```bash
pnpm install && pnpm build
claude --plugin-dir /path/to/m3l-claude-mentor
```

- **Ambient tips.** Hooks add at most one short `💡 Mentor tip:` line to an
  answer, only when it relates to what you are doing and to a topic you have
  not mastered yet. Say "stop tips" or "resume tips" at any time.
- **Skills**, namespaced `/m3l-claude-mentor:<name>`: `teach`, `ask`, `quiz`,
  `whats-new`, `assess` and `profile` (goals, mutes, project exclusions,
  catalog overrides, export, import and deletion of everything stored).
- **Settings.** The tip dial and the usage-observation switch are plugin
  options in `/config`. State lives in the plugin data directory, outside your
  projects, and only feature-usage signals are stored, never conversation
  content.

### Permissions

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

## Notable files

- `.github/dependabot.yml` — weekly Dependabot updates for the GitHub Actions
  pinned in `.github/workflows/` (npm updates are left off by default).
- `pnpm-workspace.yaml` — pnpm's install-script approval list (`allowBuilds`),
  which pnpm 10+ reads from here rather than from `package.json`.
- `bin/strip-claude-trailers.mjs` — run by the `commit-msg` hook in
  `lefthook.yml` before commit linting; strips harness-injected `Claude-*`
  trailers and leaves `Co-Authored-By:` alone.

## Tailor it to your project

This baseline is frozen at the moment it was generated, and deliberately
generic until you adapt it. To tailor it to m3l-claude-mentor:

1. Open this repository in [Claude Code](https://claude.com/claude-code).
2. Run the `/customize` slash command.
3. Answer a short interview (project kind, runtime target, test strictness,
   CI depth). Claude Code then tailors the baseline to your answers and
   runs a live guidance pass against current official TypeScript and
   Anthropic documentation, so the result reflects up-to-date recommended
   practice rather than what was true when this baseline was generated.

## Glossary

Run into an unfamiliar term in `CLAUDE.md`, this README, or the `.claude/`
harness? See the upstream
[glossary](https://github.com/monte3l/m3l-groundwork/blob/main/docs/glossary.md).
