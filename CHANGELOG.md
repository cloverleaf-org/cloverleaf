# Changelog

All notable changes to the Cloverleaf Interoperability Standard are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/spec/v2.0.0.html), with the pre-1.0 policy that MINOR releases may include breaking changes.

## [Unreleased]

### Added

- `.gitattributes` created at repo root with `reference-impl/CHANGELOG.md merge=union` — prevents merge conflicts when concurrent branches each append entries to `## [Unreleased]` in `reference-impl/CHANGELOG.md`.
- `.cloverleaf/policy-check.mjs` + `.cloverleaf/policy-probes.tsv` — a guard for `.cloverleaf/claw-drive-policy.json`, which nothing covered before. The policy ships in neither npm package, so no vitest suite sees it, and the `> /dev/null` false positive below sat there through an entire council dogfood unnoticed. The check runs 54 (tool, command → expected decision) pairs through the real `claw-drive policy-test` CLI and exits non-zero on any mismatch. It refuses to pass on a table that parses to fewer than 40 rows, or one that has lost `Bash`, `Edit` or `Write` coverage — a probe file that silently matched nothing would otherwise read exactly like a pass. Proved with 10 mutations, each shown to have landed on disk before the guard was run.

### Fixed

- `.cloverleaf/claw-drive-policy.json` — realigned on claw-drive's shipped starter (`templates/claw-drive-policy.json`), which it had diverged from by hand. The reported defect was the `auto_reject` alternative `> /dev/`, intended to catch device writes but matching the ubiquitous `> /dev/null`, so routine commands escalated at `severity: high, default_action: reject` — twice in the 2026-08-05/06 dogfood. Converging fixes that and four more holes the divergence had left open: `node -e '<anything>'` was auto-approved by a blanket `^(npm|npx|node) ` rule with no `auto_defer` list to catch it; there was no protection for claw-drive's own policy file or `.claw-drive/` runtime state; `curl … | bash` and disk-destructive ops (`dd if=`, `mkfs`, `shred`, `fdisk`) went unlisted; and `git -C <path> …` plus compound `cd … && npm …` escalated needlessly — 418 of the dogfood's 752 commands escalated, which is what made it noisy. Measured against those same 752 commands the rewrite escalates 164.
- `.cloverleaf/baselines/` — regenerated toolbar-free and reduced to the twelve images this repo's resolved UI-review config and route slugs actually reference. The tracked set had accumulated three capture regimes and was stale on every axis, not just the Astro dev toolbar the 2026-08-06 dogfood reported. Eighteen of the twenty-four images had dimensions the current config never produces: the `guide-*` images were full-page captures up to `1280×12954`, and the chromium `*-mobile` images were 500px wide against a configured 375. The three `home-*` images were named for a slug the code cannot emit — `computeAffectedRoutes` yields `/` for the home page and `slugifyRoute('/')` returns `index`, for which no baseline existed at all. The twelve `firefox/` and `webkit/` images were unreachable because the resolved config is chromium-only (`.cloverleaf/config/ui-review.json` omits `browsers`, so `applyDefaults` supplies `["chromium"]`). Only four images were both live and dimensionally current, and each diffed 5.2–8.4% against a fresh capture — five to eight times the `maxDiffRatio: 0.01` gate — dominated by a whole-page horizontal text shift from a scrollbar the old captures included, with the toolbar a small part of it. The set is now `{index,faq,guide,start} × {mobile,tablet,desktop}` for chromium, captured at the configured viewports with the toolbar disabled and verified pixel-identical across two independent capture passes; the fifteen unreachable images are deleted. These files ship in neither npm package.
- Four deliberate divergences from the upstream starter are kept, each recorded in the policy's own `_comment` and pinned by a probe. **(1)** `bash_composition: per_segment` is omitted: measured over the 752 real commands it `deny_silent`s 178 of them (175 "opaque", 3 "malformed") — refused *without* escalating to a human, ordinary heredoc `git commit` invocations among them. **(2)** Because there is no `per_segment`, the `sudo`/`su` rules are un-anchored; upstream's `^`-anchored forms rely on per-segment evaluation, so without it `cd /tmp && sudo …` fell through to the `^(set -e|cd |…)` auto-approve prefix. **(3)** and **(4)** are upstream gaps rather than cloverleaf preferences, and should flow back: the device-write branch is `>\s*/dev/(…)` rather than `> /dev/(…)`, because no shell requires a space after `>` and `cat img >/dev/sda` was therefore *auto-approved*; and the `.claw-drive/` runtime-state guards match `(?:^|(?<=[\s/'"=]))\.claw-drive/` rather than `(?:^|/)\.claw-drive/`, because upstream requires the path to start the command or follow a slash while the natural relative form follows a space — so `echo x > .claw-drive/sessions/y` was *auto-approved* too.
- `site/src/content/guide/` and `site/src/components/` — the methodology guide still described the delivery topology Slice 4 retired: a branch between a fast lane and a full pipeline, an `automated-gates` hub, `security_gate` on the three edges leaving it, and `resets_security_verdict` on the `review → automated-gates` edge that returned to it. The hub and those edges are gone; `resets_security_verdict` is gone outright; `security_gate` survives only as an optional annotation a consumer state machine may set on its own transitions. Forty-three references across seven files were corrected to the shipped model — one delivery path whose council profile is selected by `risk_class` (`delivery-fast` / `delivery-full`), with the security guarantee resting on a blocking council member and a recorded `security_review_verdict` on `council → final-gate`. Chapter 11 gains a Retired vocabulary block mapping the old terms onto the new ones. The §PATH lane sweep covered `standard/` and `reference-impl/lib` but not `site/`, which is why this survived; `reference-impl/tests/lane-vocabulary-retired.test.ts` now sweeps `site/src` too. These files ship in neither npm package.
- `site/src/` — the public site stated things the artifacts did not support, and `.github/workflows/site.yml` deploys on any push to `main` touching `site/**`, so the release push is also the moment those claims go live. The agent roster is now **nine**, matching `reference-impl/README.md`: `AgentMatrix.astro` rendered seven and named neither the Security Reviewer nor the Chair, chapter 7 said eight, and the glossary, FAQ, start page and hero all said seven — two independent "eight"s naming different sets, while "Chair" appeared nowhere on the site at all. Both missing roles now render with the conditionality the matrix already expressed for others, and each gained a chapter-7 paragraph and a glossary headword. Every Standard version string moved `0.3.0` → `0.8.0` — the footer renders on every page, so it was the most-seen false claim on the site, wrong against both the repo and the published registry by five minor versions — and its `2026-04-20` date was removed rather than refreshed, the honest value being a release date not knowable at the time. The FAQ's reference-implementation answer described a Discovery track that was "still stubbed" and promised "a v0.4 release" nine minor versions behind, listed the delivery agents in their pre-council shape, and misattributed the UI Reviewer's gate to classification when `config/council.json` gates it on `ui_changes` inside `delivery-full` alone. A new `reference-impl/tests/site-accuracy.test.ts` carries twenty-one assertions across three guards: every link resolves against the chapter ids `guide.astro` actually emits, every Standard version string matches `standard/package.json`, and every prose agent count matches both the rendered matrix and `reference-impl/README.md`'s agent table — the last anchored externally because internal parity alone would have stayed green through the whole drift it exists to catch. The link guard is preventive: a prior branch shipped five dead links that survived `astro check`, four commits and three reviews, because nothing in the repo watched links. These files ship in neither npm package.

## [reference-impl 0.1.1] — 2026-04-20

Bug-fix release addressing issues surfaced by the v0.1.0 end-to-end demo and final code review.

### Fixed

- Auto-create `.cloverleaf/events/` and `.cloverleaf/feedback/` on first write (previously crashed with ENOENT in fresh consumer repos).
- `advanceStatus` is now atomic: the status event is emitted before the task file is saved, so a failed emit leaves the task unchanged. A failed save after a successful emit produces a clear "orphan event" error.
- Every write path now validates against the corresponding `@cloverleaf/standard` schema via the new `lib/validate.ts` (AJV). `saveTask`, `writeFeedback`, `emitStatusTransition`, and `emitGateDecision` throw on invalid input.
- Shared `formatReason` helper eliminates drift between the validator-input `reason` and the persisted `reason` on status-transition events.
- CLI `advance-status` now rejects `actor=system` with exit code 2 (previously silently cast to `agent`). `system` is not a valid actor for task transitions in the Standard's state machine.
- `tests/cli.test.ts` fixtures aligned with the real task + project schemas so they double as teaching examples.

### Changed

- **Branch topology:** state commits now land on `main`; feature branches (`cloverleaf/<task-id>`) carry only code. Skills handle the `git checkout main` transitions. The Reviewer never `git checkout`s — uses `git show` and `git worktree add` instead. See README "Branch topology".

### Added

- `reference-impl/lib/validate.ts` — shared AJV `validateOrThrow` helper loading all `@cloverleaf/standard` schemas once.
- `reference-impl/README.md` gains a "Branch topology" section.

## [reference-impl 0.1.0] — 2026-04-20

First release of the Cloverleaf reference implementation package.

### Added

- `@cloverleaf/reference-impl@0.1.0` — Tight-Loop reference implementation (Implementer + Reviewer) as Claude Code skills.
- Five skills: `/cloverleaf-new-task`, `/cloverleaf-implement`, `/cloverleaf-review`, `/cloverleaf-merge`, `/cloverleaf-run`.
- `lib/` TypeScript library for state + events + feedback + ID allocation.
- `install.sh` with user-level and project-local modes.
- `examples/toy-repo/` end-to-end demo.
- Targets L2 Exchange conformance of `@cloverleaf/standard@0.3.0`.

### Known gaps

- Documenter, UI Reviewer, QA, Researcher, Plan agents are stubbed (state transitions emitted, no work performed).
- No HTTP endpoints; L3 conformance deferred.

## [0.3.0] — 2026-04-20

### Added

- Conformance levels: L1 Producer, L2 Exchange, L3 Host. Every schema, validator, agent contract, state machine, and scenario is assigned to a level via `conformance/level-map.ts`.
- `--level=<1|2|3|all>` flag on the conformance runner (`npm run validate:examples -- --level=2`).
- Per-example `.meta.json` sidecars declaring which level(s) each fixture targets.
- Per-level Vitest suites: `conformance/tests/by-level/l1.test.ts`, `l2.test.ts`, `l3.test.ts`.
- `standard/docs/conformance.md` rewritten around the three-level model.
- `standard/docs/versioning.md` section on levels and SemVer.
- GitHub Actions workflow `.github/workflows/standard.yml` running tests + filtered conformance on Node 20 and 22.
- npm package metadata: `publishConfig`, `files`, `prepublishOnly`, `repository`, `homepage`, `bugs`, `license`, `keywords`.
- Repo-root `README.md`, `CHANGELOG.md`, `LICENSE` (MIT).

### Changed

- `@cloverleaf/standard` bumped to `0.3.0`.
- `standard/README.md` adds Conformance and Publish sections.

## [0.2.0] — 2026-04-17

- First tracked release in this changelog. See `docs/superpowers/specs/2026-04-17-cloverleaf-standard-v0.2-design.md` for content.
