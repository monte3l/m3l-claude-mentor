# Security Policy

## Reporting a vulnerability

Use GitHub's [private vulnerability reporting](https://github.com/monte3l/m3l-claude-mentor/security/advisories/new):
open the repository's **Security** tab, then **Report a vulnerability**.

> [!IMPORTANT]
> Do not open a public issue for a suspected vulnerability.

Include the affected version, reproduction steps, and the impact you think it
has.

## What to expect

| Step        | Target                                                                 |
| ----------- | ---------------------------------------------------------------------- |
| Acknowledge | Within 7 days                                                          |
| Fix         | Within 60 days of confirming a medium-or-higher severity vulnerability |
| Disclose    | A published GitHub security advisory, crediting you unless you decline |

These are targets for a small maintainer team, not a service-level agreement.
The project is below 1.0.0: only the latest release and `main` are supported.

## Secrets and credentials

The plugin's hooks and CLI store no credential and make no network call. The
`docs-researcher` agent reads pages on `code.claude.com` through Claude Code's
web fetch tool. These are the credentials the repository's automation uses.

| Secret                                             | Scope                                                                                                                                   | Reaches                                                                                     |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `RELEASE_APP_CLIENT_ID`, `RELEASE_APP_PRIVATE_KEY` | Organization secrets, passed by name to `release.yml` only                                                                              | A GitHub App that opens the release pull request, creates the tag and publishes the release |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`    | Organization secrets shared with this repository, read by the deploy job of `docs.yml`, which runs in the `docs-cloudflare` environment | Deploys the static docs site                                                                |
| `JANITOR_APP_CLIENT_ID`, `JANITOR_APP_PRIVATE_KEY` | Organization secrets, read by `environments.yml`                                                                                        | A GitHub App that deletes stale deployment environments                                     |
| `GITLEAKS_LICENSE`                                 | Organization secret shared with this repository                                                                                         | A free license for the Gitleaks action. It reads nothing in the repository                  |

No workflow holds an Anthropic API key. The evals use whichever credential
`claude` resolves on the maintainer's machine and never run in CI.

**Storing.** A credential lives only in GitHub's secret store, or in the
maintainer's password manager. It is never written to a file in the repository,
a workflow log, an issue or a message. Secret scanning, push protection and
Gitleaks refuse a commit that contains one.

**Accessing.** A workflow gets a credential only by name, through `env:` or
`with:` on the one step that needs it, and never through `secrets: inherit`. A
pull request workflow gets none, except the Gitleaks license.

**Rotating.** Each GitHub App's private key and the Cloudflare token are rotated
at least once a year, and the Gitleaks license is renewed annually. The old value
is revoked when the new one is in place.

**If one is exposed.** Revoke it first, then rotate it, check the workflow runs
and the provider's audit log for use, and clean up the history. Publish an
advisory if anything was released or deployed with it.

## Accepted OpenSSF Scorecard findings

Background, not policy: this explains the Scorecard results for anyone who
looks them up. `scorecard.yml` runs weekly and surfaces its findings as Code
Scanning alerts. The ones below are dismissed as deliberate or time-based, not
defects. Do not "fix" the first one into a standing bypass.

| Check             | Score | Why it stays                                                                                                                                                                                                                                         |
| ----------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch-Protection | 8     | The top tier asks for two approvals. The organization has two members, so a PR has one reviewer who is not its author, and requiring two would block every merge unless a standing bypass existed. The `main` ruleset has no bypass actor on purpose |
| Maintained        | 0     | Scorecard scores any repository under 90 days old as 0. This one was created on 2026-11-04, so it resolves itself in early February 2027                                                                                                             |

Two other findings are open, not accepted: Fuzzing (the CLI's `import` and the
hooks parse JSON input that stays on the local machine) and CII-Best-Practices
(the repository is not registered for the OpenSSF badge yet). A later change
either fixes them or adds them to this table with a reason.
