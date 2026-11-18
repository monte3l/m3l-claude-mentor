# Roadmap

What this project intends to do, and not do, over roughly the next year. It is
kept in a file rather than in GitHub Issues so it survives outside any one tool.
It lists what is still ahead. What has shipped is in the git history and the
GitHub releases, and the design behind it is in [`spec.md`](spec.md).

## Now: the road to 1.0.0, then the 1.x series

The contract in the [Versioning policy](../README.md#versioning-policy) is
frozen from 1.0.0 on and changes only in a major release. The 0.x releases
before that may still change it in a minor release. What is left before 1.0.0
is the release itself. From then on fixes, docs and CI changes ship as patch
releases, and a new skill, option or topic ships as a minor release.

## Next 12 months

- **Run the evals in CI.** It needs a pinned model and a credential, and has no
  date. The tip rate limit and the silence on a mastered topic are not evals,
  because a `claude plugin eval` case cannot seed `CLAUDE_PLUGIN_DATA`, set
  `userConfig` or run two live prompts. Tests that run the real hooks cover
  them (see [`evals/README.md`](../evals/README.md)). They would become evals if
  those three capabilities arrive.
- **Keep the lessons current.** Re-check the topic catalogue against the Claude
  Code docs when its behaviour changes. This is ordinary maintenance, not a
  milestone.
- **Reach the OpenSSF Silver badge and the Baseline levels the project can
  honestly meet.** See [Governance](GOVERNANCE.md#gold-level-criteria-this-project-does-not-meet)
  for what Gold needs and why it is out of reach.
- **Grow the set of people who can run the project.** See
  [Governance](GOVERNANCE.md#bus-factor). It needs contributors from outside the
  organization. There is no committed timeline.

## Known issues and follow-ups

Defects and decisions that are recorded here so they are not lost, with what
would change them. The limits the project accepts for 1.0 are listed in
[`spec.md`](spec.md#15-open-questions).

- **Fix the false "tips muted" notice.** `UserPromptSubmit` can say "Mentor tips
  muted for X" when the 500-topic cap stopped the mute from being saved. It
  predates the state lock, and the fix starts with a failing test. There is no
  date.
- **File the upstream request for eval seeding.** Optional, and not filed yet. A
  `claude plugin eval` case would need to seed the plugin data directory, set
  `userConfig` values and run more than one prompt before the tip rate limit and
  the silence on a mastered topic could become evals.
- **Revisit the evidence log if it becomes a problem.** It is never rotated and
  grows by about 5 MiB a year of heavy use, and only the last 2 MiB is read.
  That is accepted for 1.0, and no size trigger is set. Add one if a report
  shows it matters. A compaction step that keeps the last events, run under the
  state lock, is the likely shape.
- **Considered, not planned: a `doctor` command.** A broken install or an
  unwritable data directory only shows in Claude Code's verbose output, so the
  learner sees nothing. A command that checks the install could surface it. It
  is not planned for 1.x.

## What this project will not do

- **Store conversation content.** Only feature-usage signals are kept, never
  prompts, code or tool output, and `transcriptAnalysis` can switch even those
  off.
- **Block the learner's work.** A hook that fails exits quietly with one line on
  stderr. It never returns a decision that stops a tool call.
- **Add a runtime dependency.** The hooks and the CLI use only Node's built-in
  modules, which keeps the installed plugin small and easy to read.
- **Send state anywhere.** The learning state stays in the plugin data
  directory. Nothing is uploaded, apart from the model calls Claude Code makes
  itself.
- **Put model ids, prices or limits in a lesson.** They change too fast, so the
  mentor looks them up in the live docs instead.
- **Run a live eval in CI without a cap.** Evals call a real model and spend
  money, so they run by hand or under a cost ceiling.
