# Roadmap

What this project intends to do, and not do, over roughly the next year. It is
kept in a file rather than in GitHub Issues so it survives outside any one tool.
It lists what is still ahead. What has shipped is in the git history and the
GitHub releases, and the design behind it is in [`spec.md`](spec.md).

## Now: the 0.x series

The contract in the [Versioning policy](../README.md#versioning-policy) can
still change in a minor release while the version is below 1.0.0. Fixes, docs
and CI changes ship as patch releases. A new skill, option or topic ships as a
minor release.

## Next 12 months

- **Verify the open items live.** Three behaviours are covered by tests only and
  not yet confirmed in a real session: the narrower permission rules in the
  [README](../README.md#permissions), `PostToolUse` evidence recording in a
  tool-using session, and the tip dial at 0. Each gets a live check and a note
  in [`spec.md`](spec.md#15-open-questions).
- **Cover the tip behaviour with evals.** The rate limit and the silence on a
  mastered topic have no eval yet, because the eval docs do not say how to seed
  `CLAUDE_PLUGIN_DATA` or pass `userConfig` to hooks. They go ahead once that is
  possible. Running the evals in CI also needs a pinned model and a credential,
  and has no date.
- **Keep the lessons current.** Re-check the topic catalogue against the Claude
  Code docs when its behaviour changes. This is ordinary maintenance, not a
  milestone.
- **Reach the OpenSSF Silver badge and the Baseline levels the project can
  honestly meet.** See [Governance](GOVERNANCE.md#gold-level-criteria-this-project-does-not-meet)
  for what Gold needs and why it is out of reach.
- **First signed release asset.** The release workflow now attaches a source
  tarball and its Sigstore bundle. The next release is the first to carry them,
  and it is the check that the job works end to end. `signed_releases` in
  `.bestpractices.json` flips to Met once a release has been verified with
  `gh attestation verify` (see [`SECURITY.md`](../SECURITY.md#verifying-releases)).
- **Grow the set of people who can run the project.** See
  [Governance](GOVERNANCE.md#bus-factor). It needs contributors from outside the
  organization. There is no committed timeline.

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
