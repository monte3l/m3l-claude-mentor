# Security Policy

## Reporting a vulnerability

Use GitHub's [private vulnerability reporting](https://github.com/monte3l/m3l-mentor/security/advisories/new):
open the repository's **Security** tab, then **Report a vulnerability**.

> [!IMPORTANT]
> Do not open a public issue for a suspected vulnerability.

Include the affected version, reproduction steps, and the impact you think it
has.

## Supported versions

| Version                                                    | Supported |
| ---------------------------------------------------------- | --------- |
| Latest release                                             | Yes       |
| Latest commit on `main`                                    | Yes       |
| Last `0.x` release, for 90 days after `1.0.0` is published | Yes       |
| Anything else                                              | No        |

This is a small-team project. Only the latest release and the latest commit on
`main` get a fix, apart from the 90-day window for the last `0.x` release below.

### Scope and duration of support

Support has no fixed length. Each release is supported until the next release is
published, and from then on it gets no security update. A fix ships as a new
release on the current line, never as a backport. When `1.0.0` is published, the
last `0.x` release (`0.3.0` unless another `0.x` release comes first) is
supported for 90 days after that date, and the `1.0.0` release notes state the
end date. Someone on an unsupported version should update to the latest release.

## Response process

This is the coordinated disclosure policy. The security contact is the
maintainer, reached through the advisory form above.

| Step                                                              | Target                                                                                                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Acknowledge the report                                            | Within 7 days                                                                                                                   |
| Confirm or reject it, and say how severe it is                    | Within 14 days of the acknowledgment                                                                                            |
| Ship a fix for a confirmed medium, high or critical vulnerability | Within 60 days of confirmation                                                                                                  |
| Publish a GitHub security advisory                                | When the fix is released, or after 90 days from the report if the reporter and the maintainer agree there is no fix to wait for |

Please keep the report private until the advisory is published. These are
targets for a small maintainer team, not a service-level agreement. If a target
slips, the maintainer says so in the advisory thread and gives a new date.

## Credit

The advisory credits the reporter by the name or handle they choose, unless they
ask not to be named.

## Published vulnerability data

Every confirmed vulnerability gets a GitHub security advisory, with a CVE
requested when it qualifies. The advisories for this repository are listed under
its Security tab. None has been published so far.

A published vulnerability in a component the plugin does not ship or use is
recorded as not affected in an [OpenVEX](https://openvex.dev) document,
[`docs/m3l-mentor.openvex.json`](docs/m3l-mentor.openvex.json),
with the reason. It holds one statement today: `picomatch`, a development-only
dependency with no patched version.

## Dependency and code-scanning findings

| Tool                                        | What it checks                                                                                           | Threshold                                                                                                                                                                                                                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependency Review (`dependency-review.yml`) | Dependencies a pull request adds or changes: known vulnerabilities and licenses                          | Fails the pull request on a `high` or `critical` vulnerability, or a license outside the allow list                                                                                                                                                                                     |
| Dependabot                                  | Pinned Actions, and the lockfiles of `tools/ci/` and `tools/deploy/`                                     | A bump arrives as a pull request, after a cooldown for the tool lockfiles. The root development packages are not Dependabot-managed: `pnpm audit` (`security-audit.yml`, daily) and Dependency Review cover them. A security advisory Dependabot cannot resolve is fixed by an override |
| CodeQL (default setup, extended suite)      | Static analysis of the JavaScript, the TypeScript and the workflows, on pushes, pull requests and weekly | A required check, so a finding blocks the merge                                                                                                                                                                                                                                         |
| zizmor and actionlint                       | The workflows                                                                                            | Fail the `workflow-lint` check                                                                                                                                                                                                                                                          |

**Remediation thresholds.** A `critical` or `high` finding in a dependency or in
the code is fixed before the change that introduced it merges, or before the next
release if it was already on `main`. A `medium` finding is fixed within 60 days.
A `low` finding is fixed or dismissed with a recorded reason within 90 days. A
license violation is fixed before merge, with no exception.

**Before a release.** No release is cut with an open `critical` or `high`
finding. A dismissed finding names its reason in the alert, and the accepted ones
are listed below.

## Secrets and credentials

The plugin's hooks and CLI store no credential and make no network call. The
`docs-researcher` agent reads pages on `code.claude.com` through Claude Code's
web fetch tool. These are the credentials the repository's automation uses.

| Secret                                             | Scope                                                                                                 | Reaches                                                                                     |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `RELEASE_APP_CLIENT_ID`, `RELEASE_APP_PRIVATE_KEY` | Organization secrets, passed by name to `release.yml` only                                            | A GitHub App that opens the release pull request, creates the tag and publishes the release |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`    | Secrets of the `docs-cloudflare` environment, limited to `main`, read by the deploy job of `docs.yml` | Deploys the static docs site                                                                |
| `JANITOR_APP_CLIENT_ID`, `JANITOR_APP_PRIVATE_KEY` | Secrets of the `env-janitor` environment, limited to `main`, read by `environments.yml`               | A GitHub App that deletes stale deployment environments                                     |
| `GITLEAKS_LICENSE`                                 | Organization secret shared with this repository                                                       | A free license for the Gitleaks action. It reads nothing in the repository                  |
| `ANTHROPIC_API_KEY`                                | Secret of the `evals` environment, read only by the weekly `evals.yml`                                | Runs `claude plugin eval` against a real model, with a cost cap                             |

Only `evals.yml` holds an Anthropic API key, and it runs weekly and on demand,
never on a pull request. Run by hand, the evals use whichever credential
`claude` resolves on the maintainer's machine.

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

## Verifying releases

A release has a git tag named `m3l-mentor--vX.Y.Z`, and the org tags
ruleset stops a tag from being moved or deleted. It also carries a source
tarball (`m3l-mentor-X.Y.Z.tar.gz`) and its Sigstore bundle
(`m3l-mentor-X.Y.Z.tar.gz.sigstore.json`).

**Releases before the rename.** The plugin was called `m3l-claude-mentor` until
`1.2.0`. Those releases keep their tags (`m3l-claude-mentor--vX.Y.Z`) and, from
`0.2.1` on, their tarballs (`m3l-claude-mentor-X.Y.Z.tar.gz`) and bundles. `0.1.0`
and `0.2.0` were published without assets, so only their tags can be checked.

**Integrity and authenticity of the tarball.** Download both assets, then run:

```zsh
gh attestation verify m3l-mentor-X.Y.Z.tar.gz \
  --bundle m3l-mentor-X.Y.Z.tar.gz.sigstore.json \
  -R monte3l/m3l-mentor \
  --signer-workflow monte3l/m3l-mentor/.github/workflows/release.yml
```

A pass means the file is byte-for-byte what the release workflow built from this
repository, and `--signer-workflow` pins the expected identity: that workflow
file in this repository, and nothing else.

**Use the repository name the release was built under.** The attestation
records the repository and workflow path as they were at build time. For a
release built while the repository was still named `m3l-claude-mentor` (every
release up to `1.2.0`, and any release built before the repository was
renamed), keep the old names in the command:

```zsh
gh attestation verify m3l-claude-mentor-X.Y.Z.tar.gz \
  --bundle m3l-claude-mentor-X.Y.Z.tar.gz.sigstore.json \
  -R monte3l/m3l-claude-mentor \
  --signer-workflow monte3l/m3l-claude-mentor/.github/workflows/release.yml
```

If the new form fails for a release, try this one before concluding the file is
not authentic.

Installing through the catalog does not use the tarball. It clones this
repository over HTTPS at a pinned tag and commit, so the commit it resolves to
is the one the tag points at. The tarball is a signed copy of that same commit,
for anyone who wants to check a release independently.

## Accepted OpenSSF Scorecard findings

Background, not policy: this explains the Scorecard results for anyone who
looks them up. `scorecard.yml` runs weekly and surfaces its findings as Code
Scanning alerts. The ones below are dismissed as deliberate or time-based, not
defects. Do not "fix" the first one into a standing bypass.

| Check             | Score | Why it stays                                                                                                                                                                                                                                                                                                                                                           |
| ----------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch-Protection | 8     | The top tier asks for two approvals. The organization has two members, so a PR has one reviewer who is not its author, and requiring two would block every merge unless a standing bypass existed. The `main` ruleset has no bypass actor on purpose                                                                                                                   |
| Maintained        | 0     | Scorecard scores any repository under 90 days old as 0. This one was created on 2026-11-04, so it resolves itself in early February 2027                                                                                                                                                                                                                               |
| Fuzzing           | 0     | Not applicable. The inputs are JSON that Claude Code passes to the hooks on stdin, command-line arguments, the plugin's own local state files, and an export bundle the learner chooses to import. None comes from a network or an untrusted binary, and the parsers validate their input and reject or ignore what does not fit. Nothing is exposed to a remote party |
| Vulnerabilities   | 9     | GHSA-fc5q-39xc-vjpf, a ReDoS in `picomatch` 4.0.7 and earlier with no patched release yet. It reaches the repository only as a development dependency of ESLint and Vitest globbing, never in the shipped plugin, and nothing runs it on input from outside. Dependabot raises the update once a fix is published                                                      |
