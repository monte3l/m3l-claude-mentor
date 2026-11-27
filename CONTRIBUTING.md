# Contributing

`m3l-mentor` is a Claude Code plugin that mentors one learner on Claude
and Claude Code. Open an **issue** first for anything beyond a small fix, so the
direction is agreed before you spend time on it. If you cannot open a pull
request, the issue is the contribution, and a collaborator will pick it up.

## Reporting a bug

Open an issue at
[`monte3l/m3l-mentor`](https://github.com/monte3l/m3l-mentor/issues/new/choose)
and say:

- the plugin version, and your Claude Code and Node versions,
- what you did, what you expected and what happened,
- for a wrong tip or level, the topic and what you had just been doing. Do not
  paste conversation text or your stored state files.

Report a suspected security vulnerability privately. See
[`SECURITY.md`](SECURITY.md), and never open a public issue for it.

## Commits

| Rule                                                        | Why                                                  |
| ----------------------------------------------------------- | ---------------------------------------------------- |
| [Conventional Commits](https://www.conventionalcommits.org) | The changelog and the version come from the message  |
| `Signed-off-by:` trailer (`git commit -s`)                  | Developer Certificate of Origin: you may submit this |
| GPG- or SSH-signed                                          | The `main` ruleset rejects unsigned commits          |

## Coding standards

| Standard                                                                                | How it is enforced                                                                                                    |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `.editorconfig`: UTF-8, LF, two-space indent, final newline, no trailing whitespace     | Prettier reads it, and the format check in `pnpm verify` and CI fails on a difference                                 |
| TypeScript with `strict: true` and ESM only: no `require`, no `module.exports`          | `tsc` in the typecheck step, and `.claude/hooks/guard-no-commonjs.mjs`                                                |
| ESLint with the typed recommended rules, named exports and exhaustive `switch`          | The lint step of `pnpm verify` and CI                                                                                 |
| TSDoc on exports and tests for every module, with coverage of at least 80% of each file | The test step runs Vitest with a per-file coverage gate                                                               |
| No source file over 25,000 bytes and no test file over 60,000                           | The file-budget step                                                                                                  |
| Relative imports end in `.ts`, and no build output is committed                         | `.claude/hooks/guard-ts-extension.mjs`, and the `no-dist` step, because the hooks and the CLI run `src/*.ts` directly |

## Building and testing

Install pnpm and Node 24 or newer (`.node-version` is the authority), then run
the commands in the [README](README.md#working-on-this-repo).

| When                                           | What runs                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Before you push                                | `pnpm verify`, which runs every gate below in one command                                                                                                                                                                                                                                                                                        |
| On every pull request and every push to `main` | The `CI` workflow runs the format, lint, typecheck, build and test lanes with the coverage gate, and a `Plugin` lane that checks `plugin.json` against the GitHub repository (change the description or the topics on GitHub first). CodeQL, Dependency Review, Gitleaks, REUSE, ScanCode, actionlint, zizmor, DCO and commit lint run beside it |
| Weekly and on demand, never on a pull request  | `claude plugin eval` (`evals.yml`), because it calls a real model and costs money. It runs with pinned models and `--max-cost-usd 10`. Run it by hand with `--max-cost-usd` too                                                                                                                                                                  |

## Dependencies

The hooks and the CLI use no runtime package. The development packages are
pinned by `pnpm-lock.yaml`, and the docs deploy tool in `tools/deploy/` by its
own lockfile, installed with `npm ci --ignore-scripts`. Every GitHub Action is
pinned by commit SHA, and a repository setting allows only a short list of them.
Dependabot proposes Action pin bumps weekly, and bumps for the `tools/ci/` and
`tools/deploy/` lockfiles after a cooldown, and Dependency Review fails a
pull request that adds a high-severity vulnerability or a license outside the
allow list (see [`SECURITY.md`](SECURITY.md)). Adding a runtime dependency needs
a reason in the pull request and the maintainer's agreement, because having none
is part of why the plugin is safe to install.

## Pull requests

1. Branch off `main` as `feat/<slug>` or `fix/<slug>`.
2. Run `pnpm verify` before pushing.
3. Add or update tests for every major change, and a regression test for a fix.
   The coverage gate fails below 80% per file. A change to a skill, an option or
   the export format also updates the README tables, which the docs check
   compares with the code.
4. Resolve every review thread. A pull request merges when its required checks
   pass and a code owner other than its author approves it.

Markdown here follows m3l-design: bold, never italics, and tables for tabular
data. The documentation site is built from the Markdown in this repository, and
the docs check fails with the name of what drifted. Fix the page, never the kit.

## Versioning

Releases follow Semantic Versioning, and the contract is defined under
"Versioning policy" in the [README](README.md#versioning-policy).

## Releasing

Releases are automatic. Only a collaborator merges, and a tag cannot be moved or
deleted once it exists (the org tags ruleset), so review the release pull
request before you merge it.

1. Write Conventional Commits. `fix:` is a patch, `feat:` a minor, and `!` or a
   `BREAKING CHANGE:` footer a major. The `Commit lint` check fails a pull
   request whose title or commits do not parse. Merge with a merge commit, never
   a squash, so every commit reaches the release notes.
2. On every merge to `main`, the `Release` workflow opens or updates one release
   pull request. It bumps `version` in `.claude-plugin/plugin.json` and
   `package.json` and writes the new section of `CHANGELOG.md`. Review both,
   then merge it with a merge commit.
3. Merging it tags `m3l-mentor--vX.Y.Z` and creates the GitHub release as
   a draft with that changelog section as its notes. The workflow then
   publishes it. Nothing is tagged by hand. Releases up to 1.2.0 carry the
   earlier name, `m3l-claude-mentor--vX.Y.Z`.
4. The workflow sends `release-published` to `monte3l/m3l-plugins`, which opens
   a pull request that moves the catalog pin.

The shared workflows are `release-prepare.yml` and `release-publish.yml` in
`monte3l/.github`, and `.github/workflows/release.yml` here calls them.

## Conduct

Everyone taking part is bound by the
[Code of Conduct](https://github.com/monte3l/.github/blob/main/CODE_OF_CONDUCT.md).
