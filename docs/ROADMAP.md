---
reviewed: 2026-11-21
---

# Roadmap

What this project intends to do, and not do, over roughly the next year. It
lists what is still ahead. What has shipped is in the git history and the
GitHub releases, and the design behind it is in [`spec.md`](spec.md). Work that
can be closed is a GitHub issue, linked from here. What stays true until
something changes is written here, so it survives outside any one tool. The rule
for which goes where is the org's [tracking
policy](https://github.com/monte3l/.github/blob/main/blueprint/tracking.md).

## Now: the road to 1.0.0, then the 1.x series

The contract in the [Versioning policy](../README.md#versioning-policy) is
frozen from 1.0.0 on and changes only in a major release. The 0.x releases
before that may still change it in a minor release. What is left before 1.0.0
is the release itself. From then on fixes, docs and CI changes ship as patch
releases, and a new skill, option or topic ships as a minor release.

Keep the lessons current. Re-check the topic catalogue against the Claude Code
docs when its behaviour changes. This is ordinary maintenance, not a milestone.

Keep the exam tracks current. Re-review a track in `data/tracks/` whenever its
exam guide changes version or its effective date arrives (the `tracks` command
flags both), and re-check the objective-to-topic mappings against the new guide.
The Associate certifications are out of scope; adding one needs only a new track
file and any topics it needs.

## Next 12 months

- **Run the evals in CI.** It needs a pinned model and a credential, and has no
  date. What the evals cannot cover today is under Known limits.
- **Reach the OpenSSF Silver badge and the Baseline levels the project can
  honestly meet.** Tracked in
  [#67](https://github.com/monte3l/m3l-claude-mentor/issues/67). See
  [Governance](GOVERNANCE.md#gold-level-criteria-this-project-does-not-meet) for
  what Gold needs and why it is out of reach.

## Known limits

The limits accepted for 1.0 are listed in
[`spec.md`](spec.md#15-open-questions): the best-effort state lock, a skipped
write after a 2 s lock wait, `export` racing a writer, and project exclusion on
symlinks and case folding. The ones the roadmap adds:

- **Two behaviours are covered by tests, not evals.** The tip rate limit and the
  silence on a mastered topic are not evals, because a `claude plugin eval` case
  cannot seed `CLAUDE_PLUGIN_DATA`, set `userConfig` or run two live prompts.
  Tests that run the real hooks cover them (see
  [`evals/README.md`](../evals/README.md)). They would become evals if those
  three capabilities arrive. An upstream request for them is optional and not
  filed.
- **The evidence log is never rotated.** It grows by about 5 MiB a year of heavy
  use, and only the last 2 MiB is read. That is accepted for 1.0, and no size
  trigger is set. Add one if a report shows it matters. A compaction step that
  keeps the last events, run under the state lock, is the likely shape.
- **A broken install shows the learner nothing.** A broken install or an
  unwritable data directory only shows in Claude Code's verbose output. A
  `doctor` command that checks the install could surface it. It is considered
  and not planned for 1.x.
- **The "tips muted" notice can be false.** `UserPromptSubmit` can say "Mentor
  tips muted for X" when the 500-topic cap stopped the mute from being saved.
  Tracked in [#66](https://github.com/monte3l/m3l-claude-mentor/issues/66).
- **Few people can run the project.** See [Governance](GOVERNANCE.md#bus-factor).
  It needs contributors from outside the organization. There is no committed
  timeline.

- **Exam practice has no human review.** The questions and answer keys are written
  by the model, and a wrong key is caught only when a learner disputes it, which
  then needs `exam-void`. A reviewed question bank is not planned.
- **Exam readiness is unvalidated.** Its weights, decay and thresholds are this
  project's own and were never compared with real exam outcomes, so it is
  labelled a practice indicator and never a prediction.
- **The exam guide links are unverified.** The certification pages refused
  automated access, so each track's `sourceUrl` has not been opened by a script.
  Check them in a browser.

## Unverified

| Claim                                                                                                                          | Source                                                                                 | Date       |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ---------- |
| Claude Code versions other than 2.1.327 that support `userConfig` work. The minimum supported version has not been established | [`spec.md`](spec.md#15-open-questions), carried over and not re-tested for this change | 2026-11-20 |

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
