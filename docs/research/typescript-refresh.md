# TypeScript refresh tracker

<!-- typescript-refresh: last-verified=2026-11-04 typescript-version=7.0 -->

Living record of `typescript-guidance` (refresh mode) sweeps — the
per-facet, per-source state a run diffs against, so each sweep reports what
**changed** since the last one instead of rediscovering the whole toolchain
from scratch. Updated **in place** on every run, never as a new dated file.

`typescript-version` in the header records the newest **upstream**
TypeScript release the last sweep verified against — deliberately distinct
from `package.json`'s own `typescript` devDependency pin, which this
tracker exists to check against, not restate. The two numbers disagreeing
is not a bug in the tracker; it's the finding.

First sweep run 2026-11-04 (`/customize`, plugin kind, Node). Newest upstream verified: TypeScript 7.0 (announced 2026-07-08; 7.1 Beta 2026-10-20). The hub-supplied "7.0.2, Aug 2026" is unconfirmed: a microsoft/TypeScript issue reports 7.0.2 on 2026-07-16.

## Outstanding drift

| Item                                                                                  | Status                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript 7.x upgrade                                                                | **Blocked, hold at `^6.0.3`.** 7.0 ships no compiler API; typescript-eslint supports `>=4.8.4 <6.1.0` (inferred blocker, re-check `npm view typescript-eslint peerDependencies`). 7.1 Beta adds a new API. If Dependabot npm is enabled, ignore typescript major 7. |
| `.ts` vs `.js` import specifiers                                                      | Node type stripping (stable v24.12.0) needs `.ts`; TS `nodenext` needs `.js`; `eslint.config.js` import-x rule has `ts: "never"`. No effect while hooks are `.mjs`; decide the convention before moving any hook to `.ts`.                                          |
| `vitest.config.ts` and `.claude/skills/customize/*.ts` outside every tsconfig project | Deferred (user chose no change).                                                                                                                                                                                                                                    |
| Hook contract tests                                                                   | Coverage gate measures `src/` only; hook scripts are untested. Follow-up for the TDD pipeline: `tests/hooks/*.test.ts` using `spawnSync`.                                                                                                                           |
| `package.json` `main`/`types`/`files` inert (private, not npm-resolved)               | Deferred (user chose no change).                                                                                                                                                                                                                                    |
| Plugin manifest (`.claude-plugin/plugin.json`, marketplace entry) absent              | Coverage gap for this skill (owned by Anthropic docs).                                                                                                                                                                                                              |
| `guard-no-commonjs.mjs` claim `import.meta.dirname` stable on Node 24+                | Unverified (no allowed source).                                                                                                                                                                                                                                     |

## Facet state

| Facet                        | Last verified | Notes                                                                                                                                                                                                                                     |
| ---------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compiler-config-flags`      | 2026-11-04    | Repo sets every option whose default changed in 6.0 and uses none removed in 7.0. `tsc <files>` with a tsconfig is error TS5112 in 7.0; scripts use `tsc -b` only. Sources: devblogs 6.0/7.0/7.1-beta posts, typescriptlang.org/tsconfig. |
| `modules-esm-node-interop`   | 2026-11-04    | `nodenext` + `.js` specifiers, `erasableSyntaxOnly`, `verbatimModuleSyntax` all current. Node type stripping stable v24.12.0. eslint-plugin-import-x not covered (off allowlist).                                                         |
| `packaging-declaration-emit` | 2026-11-04    | No upstream guidance to disable declaration emit for a private package. `exports` map and publint/attw gate removed in Round 1.                                                                                                           |
| `lint-typing-rules`          | 2026-11-04    | `recommendedTypeChecked` + `projectService` current. `.mjs` files get no type-aware rules (`disableTypeChecked`). ESLint 10 flat config unverified at T1 (eslint.org off allowlist).                                                      |
| `testing-language-features`  | 2026-11-04    | Vitest 5.1 config uses no removed option; `pool: "forks"` is the default (redundant). `expectTypeOf` is a runtime no-op outside `*.test-d.ts`. Vitest kept over `node:test`.                                                              |
