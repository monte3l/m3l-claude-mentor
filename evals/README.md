# Evals

Model-facing checks for the plugin, run with `claude plugin eval`. They answer
questions only a real model can answer: does the right skill fire for natural
phrasing, does the mentor probe an over-claim, are the agents dispatched. They
call a real model, so they run by hand under a cost cap. CI does not run them.

## Run them

```bash
claude plugin eval . --trust-plugin --ablation none --max-cost-usd 5
```

- `--trust-plugin` answers the first-run trust prompt for this repository's own
  plugin. Only use it on a plugin you trust: a run loads the plugin's hooks and
  runs as you.
- `--ablation none` skips the no-plugin baseline arm. The skill and agent
  graders are `with-only` indicators, so those cases score only without the
  baseline.
- `--max-cost-usd 5` stops before the next run starts once the list-price
  estimate passes the cap, and exits with code 2 and partial results. A case run
  costs roughly $0.20.
- Needs Claude Code 2.1.269 or newer. Results go to `evals/results/`, which is
  git-ignored. Add `--case '<glob>'` to run a subset.

## The cases

Each case is `evals/<group>/<name>/case.yaml`, schema `1.1`, with `runs: 3` and
inline graders.

| Group      | Directory         | Prompt                                         | What it checks                                                        |
| ---------- | ----------------- | ---------------------------------------------- | --------------------------------------------------------------------- |
| `triggers` | `quiz`            | "quiz me on hooks"                             | natural phrasing fires the `quiz` skill                               |
| `triggers` | `teach`           | "teach me plan mode"                           | natural phrasing fires the `teach` skill                              |
| `triggers` | `assess`          | "I know MCP really well, so skip the basics."  | an over-claim of expertise fires the `assess` skill                   |
| `triggers` | `whats-new`       | "what changed in Claude Code lately?"          | natural phrasing fires the `whats-new` skill                          |
| `behavior` | `overclaim-probe` | "I'm advanced at hooks, skip the basics."      | the mentor probes the claim instead of accepting it (an `llm` grader) |
| `dispatch` | `ask-docs`        | "Use the ask skill: how do subagents differ…?" | `ask` hands the lookup to the `docs-researcher` agent                 |
| `dispatch` | `assess-judge`    | probe answers to judge                         | `assess` hands the judging to the `mastery-assessor` agent            |

## Case fields in use

```yaml
schema_version: "1.1"
name: quiz-trigger
description: Natural phrasing reaches the quiz skill.
runs: 3
execution:
  max_turns: 6
  allowed_tools: [Skill, Agent]
  prompt: "quiz me on hooks"
graders:
  - name: skill-fired
    type: tool_used # also: regex, tool_order, file_exists, llm, baseline
    arm: with-only
    tool: Skill
    input_match: '"skill"\s*:\s*"(?:[\w-]+:)?quiz"'
  - name: rubric
    type: llm
    criteria: >
      PASS if ... FAIL if ...
```

The full field list, the other grader types and the scoring rules are in the
[plugin evals documentation](https://code.claude.com/docs/en/plugin-evals).

## What an eval cannot test here

An eval case is one live prompt in an empty workspace, with a temporary home and
a fresh Claude Code configuration. As of Claude Code 2.1.327 that rules out the
two tip behaviours:

- **The tip rate limit** (at most one tip per segment) needs two prompts in one
  session. A case has one live prompt, and replaying a saved transcript is not
  documented to run hooks.
- **Silence on a mastered topic** needs a seeded `state.json` and `profile.json`
  in the plugin data directory. A case cannot set `CLAUDE_PLUGIN_DATA`, cannot
  set the plugin's `userConfig` values (only `EVAL_*` environment variables), and
  no grader can read that directory afterwards.

Those behaviours are covered by tests that run the real hooks as processes
instead, with a seeded data directory and the plugin options in the environment:

- `tests/internal/segment-gate*.test.ts`: the tip gate, including the minimum gap
  for each dial and the order of the checks
- `tests/hooks/handlers/user-prompt-submit-tips.test.ts` and
  `mastered-silence.test.ts`: one tip per segment, and no tip for a topic at its
  target even when its review is due
- `tests/hooks/handlers/session-start*.test.ts`: the `review due:` lines
- `tests/entries/`: the spawned hook processes, including dial 0 and parallel
  prompts that must produce at most one tip

Keep evals for what the hooks cannot decide: how the model words a tip, which
skill it picks, whether it dispatches an agent. Grade those with an `llm`
grader that tolerates variation, and keep the rate limit and the mastery rule in
the hook tests.
