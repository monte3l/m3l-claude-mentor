# Changelog

## [1.2.0](https://github.com/monte3l/m3l-claude-mentor/compare/m3l-claude-mentor--v1.1.0...m3l-claude-mentor--v1.2.0) (2026-11-21)


### Features

* **agents:** widen docs-researcher to API, MCP and engineering docs ([60443eb](https://github.com/monte3l/m3l-claude-mentor/commit/60443eb3359ffb7d2b8edcfae6040b56e66d52bb))
* **catalog:** add the Professional exam topics ([94a97e7](https://github.com/monte3l/m3l-claude-mentor/commit/94a97e75be24e839208fa4db93a650198b73227e))
* **catalog:** add the shared Foundations exam topics ([10a4b8d](https://github.com/monte3l/m3l-claude-mentor/commit/10a4b8d6cac254d98d5db1f4057f9269452a1767))
* **catalog:** keep ambient-off topics out of unprompted surfaces ([3b90d90](https://github.com/monte3l/m3l-claude-mentor/commit/3b90d9027fd674041ef4a85488cf0b96264ce027))
* **exam:** add the exam commands ([9f7645b](https://github.com/monte3l/m3l-claude-mentor/commit/9f7645bb2c06132cc64c8a46573e42cbb8c168d6))
* **exam:** add the exam item log, pending exam and active track ([4959ace](https://github.com/monte3l/m3l-claude-mentor/commit/4959aceccaa74df38619d2c48ded538ddbfd23a0))
* **exam:** add the exam skill ([7d8adac](https://github.com/monte3l/m3l-claude-mentor/commit/7d8adac7ffd0040493029851e3abcd2ca17ffdb4))
* **exam:** cap how many items per objective count each day ([4ddccbe](https://github.com/monte3l/m3l-claude-mentor/commit/4ddccbe2dcbc1e319bb7f9307572a4fd43340aa7))
* **exam:** compute per-domain exam readiness ([97740fb](https://github.com/monte3l/m3l-claude-mentor/commit/97740fb3013cc0d975bff63685ca725648a7eeba))
* **exam:** let a disputed exam submission be voided ([ee6e99c](https://github.com/monte3l/m3l-claude-mentor/commit/ee6e99c5cad5116a3137103128db575195417c5e))
* **exam:** let tracks describe one exam's objectives ([ce6907b](https://github.com/monte3l/m3l-claude-mentor/commit/ce6907bc2a7e4926bc037b1814d081199dfaf8ce))
* **exam:** rank the active exam track first at session start, teach and quiz ([bb01d7e](https://github.com/monte3l/m3l-claude-mentor/commit/bb01d7e522594c8f91131998516b340d4d7fd683))
* **tracks:** bundle the CCAR-P and CCDV-P exam tracks ([32d6551](https://github.com/monte3l/m3l-claude-mentor/commit/32d65516ee63e749f23c3b8454e66a9d791cd58f))
* **tracks:** bundle the CCDV-F and CCAR-F exam tracks ([bb36b64](https://github.com/monte3l/m3l-claude-mentor/commit/bb36b64439486957d4051d0af4958a6fb67b1f18))


### Bug Fixes

* **exam:** load the exam skill for real-exam-question requests ([5f3c36d](https://github.com/monte3l/m3l-claude-mentor/commit/5f3c36d2c7253529d7ee5f3bbc49708a0dacd3f3))

## [1.1.0](https://github.com/monte3l/m3l-claude-mentor/compare/m3l-claude-mentor--v1.0.0...m3l-claude-mentor--v1.1.0) (2026-11-20)


### Features

* **catalog:** let bundled topics shadow colliding custom ids ([e07b8d1](https://github.com/monte3l/m3l-claude-mentor/commit/e07b8d19690dad89d54e9fd03c1ea2d7401834c2))
* **tracks:** add the exam track model and loader ([4fc19e3](https://github.com/monte3l/m3l-claude-mentor/commit/4fc19e3e4f08e4390e04f8723b9cdafa4ffb56df))


### Bug Fixes

* **catalog:** resolve ambient-off topics in explicit requests ([a50a74b](https://github.com/monte3l/m3l-claude-mentor/commit/a50a74b2a633cea0abc472a19b67a693bbbeabaa))

## [1.0.0](https://github.com/monte3l/m3l-claude-mentor/compare/m3l-claude-mentor--v0.3.0...m3l-claude-mentor--v1.0.0) (2026-11-18)


### Documentation

* record the live verification on Claude Code 2.1.327 ([34553a2](https://github.com/monte3l/m3l-claude-mentor/commit/34553a2ab2ed4eff202383559a15fcd3a6546f47))

## [0.3.0](https://github.com/monte3l/m3l-claude-mentor/compare/m3l-claude-mentor--v0.2.2...m3l-claude-mentor--v0.3.0) (2026-11-18)


### Features

* add a data-directory lock for the state writers ([308af1c](https://github.com/monte3l/m3l-claude-mentor/commit/308af1c415e81fa9f8988fb4b4558d4030ec1c72))
* lock the hook handlers, and degrade instead of blocking on a timeout ([4fc4d25](https://github.com/monte3l/m3l-claude-mentor/commit/4fc4d2553ed0aa4fdb4a9973a2df903c05876031))
* serialize all state writes with a data-directory lock ([de2821b](https://github.com/monte3l/m3l-claude-mentor/commit/de2821b917a0dc5d9f901e21712e5e9854e77333))
* serialize the CLI writers, import and purge with the state lock ([ea9913c](https://github.com/monte3l/m3l-claude-mentor/commit/ea9913ccb677cfbb18289e7974fb8672bae899ad))


### Bug Fixes

* keep an excluded project excluded through symlinks and case ([5700961](https://github.com/monte3l/m3l-claude-mentor/commit/570096115333b96fd1cb5db989c4da518d9ce012))
* keep an excluded project excluded through symlinks and case ([022b218](https://github.com/monte3l/m3l-claude-mentor/commit/022b218ec527a343357459c38c44413352a59e1f))

## [0.2.2](https://github.com/monte3l/m3l-claude-mentor/compare/m3l-claude-mentor--v0.2.1...m3l-claude-mentor--v0.2.2) (2026-11-17)


### Bug Fixes

* **build:** run the TypeScript directly and commit no build output ([7c35fe4](https://github.com/monte3l/m3l-claude-mentor/commit/7c35fe41b147c87b78cf01b99882719f2b89b2e7))
* **build:** run the TypeScript directly and commit no build output ([014557d](https://github.com/monte3l/m3l-claude-mentor/commit/014557d1beb5b479005000e6d20e6a62848eb838))
* keep hooks exiting 0 on a broken install or a closed pipe ([8c4d123](https://github.com/monte3l/m3l-claude-mentor/commit/8c4d12366e2931b90ece60636181c9ee63938103))
* keep hooks exiting 0 on a broken install or a closed pipe ([3fe6b25](https://github.com/monte3l/m3l-claude-mentor/commit/3fe6b25452bf0fb6210f881aff31e7b62c478768))

## [0.2.1](https://github.com/monte3l/m3l-claude-mentor/compare/m3l-claude-mentor--v0.2.0...m3l-claude-mentor--v0.2.1) (2026-11-17)


### Continuous Integration

* correct the release tarball wording to match how the catalog installs ([48583d3](https://github.com/monte3l/m3l-claude-mentor/commit/48583d3b47a925224af3541d0e849dbb582123d5))

## [0.2.0](https://github.com/monte3l/m3l-claude-mentor/compare/m3l-claude-mentor--v0.1.0...m3l-claude-mentor--v0.2.0) (2026-11-14)


### Features

* add the docs site at claude-mentor.monte3l.com ([b052818](https://github.com/monte3l/m3l-claude-mentor/commit/b052818891dfeeb3a26a7e3a055288fded0e0a73))


### Bug Fixes

* move deploy-tools to tools/deploy so Dependabot can update it ([96507b5](https://github.com/monte3l/m3l-claude-mentor/commit/96507b51f0f147902310f21898c6c2774977a7d9))

## 0.1.0 (2026-11-12)


### Features

* add plugin eval cases for triggers, over-claim and agent dispatch ([a86a4ce](https://github.com/monte3l/m3l-claude-mentor/commit/a86a4ced43f71440d16cbf86059fb96f511c7b1b))
* add plugin eval cases for triggers, over-claim and agent dispatch ([2734674](https://github.com/monte3l/m3l-claude-mentor/commit/2734674056906d49d487a748112c0bd8a9f4f989))
* add pure catalog, mastery and segment logic for the mentor ([5505d39](https://github.com/monte3l/m3l-claude-mentor/commit/5505d39a753ee009d6f4b5e96813330ff8158f64))
* add pure catalog, mastery and segment logic for the mentor ([dc1382f](https://github.com/monte3l/m3l-claude-mentor/commit/dc1382f1f77372dab7e36c8a6f0010a8c1f428aa))
* add record-batch and cut permission prompts in the mentor skills ([f4c72f9](https://github.com/monte3l/m3l-claude-mentor/commit/f4c72f9a4f421e785609c3ef5911e019c8eb2c6c))
* add record-batch and cut permission prompts in the mentor skills ([4c6fd2a](https://github.com/monte3l/m3l-claude-mentor/commit/4c6fd2ae2b629b3568214ba1c59f0f9e98082b8d))
* add signal detectors and the mentor-state CLI core ([ed97b14](https://github.com/monte3l/m3l-claude-mentor/commit/ed97b14bb683145ffb93116093635a7282ab7340))
* add the mentor agents, output style and goals template ([1a4859f](https://github.com/monte3l/m3l-claude-mentor/commit/1a4859f5d7723a6a40268c13e35ad87bd5afb848))
* add the mentor agents, output style and goals template ([4c65e70](https://github.com/monte3l/m3l-claude-mentor/commit/4c65e70fbeaf47db62c738504dd9d70c6c90c694))
* add the mentor hooks, entry points and CLI entry ([c94ad2e](https://github.com/monte3l/m3l-claude-mentor/commit/c94ad2ea5170cdfd550edd4767656f8867327222))
* add the mentor hooks, entry points and CLI entry ([93beeda](https://github.com/monte3l/m3l-claude-mentor/commit/93beeda13e264a268724062b824739c5e8e90f32))
* add the mentor skills ([0b43b2f](https://github.com/monte3l/m3l-claude-mentor/commit/0b43b2f7e767f92195c5e4f688ff9d4aa97b69dc))
* add the mentor skills and fix three smoke-test issues ([b3c542b](https://github.com/monte3l/m3l-claude-mentor/commit/b3c542b4869ce97d2dfbe01375123abda8d72701))
* add the mentor state store, export/import and purge ([e43c3f8](https://github.com/monte3l/m3l-claude-mentor/commit/e43c3f8e341cd5b753c5282aaa7d2a7e720d4caa))
* add the mentor state store, export/import and purge ([0d8f6a3](https://github.com/monte3l/m3l-claude-mentor/commit/0d8f6a3786ab575e6ac80f6e8c3e0a885e8030e2))
* add the mentor-state CLI command core ([a674a04](https://github.com/monte3l/m3l-claude-mentor/commit/a674a04bd2e07123ffd42cdd7e4336179c6c8a03))
* add topic, override and changelog CLI commands and fix tip heuristics ([98c6b22](https://github.com/monte3l/m3l-claude-mentor/commit/98c6b224be53c5aad53494eff4e26c19e51d6f9d))
* add usage-signal extractor and prompt-signal detector ([4f1faa5](https://github.com/monte3l/m3l-claude-mentor/commit/4f1faa592f96e3fdf5d16c4b3d57d1946fe181bb))
* recompute mastery levels at session start ([d0b52ec](https://github.com/monte3l/m3l-claude-mentor/commit/d0b52ecbf69cc4d6be3ac9658f22a3a5ff558c3e))


### Bug Fixes

* make the release PR pass CI and start at 0.1.0 ([f82e163](https://github.com/monte3l/m3l-claude-mentor/commit/f82e163903aad2fbf66c92502014b0bfc82ebe76))
* make the release PR pass CI and start at 0.1.0 ([e885b6b](https://github.com/monte3l/m3l-claude-mentor/commit/e885b6bddd99206c3cc449922efa1941fd55a1a9))
