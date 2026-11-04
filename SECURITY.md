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
The project is pre-release: only the latest commit on `main` is supported.

## Secrets

| Secret             | Scope        | Reaches                                         | Expiry               |
| ------------------ | ------------ | ----------------------------------------------- | -------------------- |
| `GITLEAKS_LICENSE` | Organization | Lets the Gitleaks action run on this repository | Per the org rotation |

If a secret is exposed, revoke it first, then clean up the history.

## Accepted OpenSSF Scorecard findings

None yet. The repository has not been published, so no Scorecard results exist.
