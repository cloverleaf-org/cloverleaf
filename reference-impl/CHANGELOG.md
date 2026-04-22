# Changelog

All notable changes to the Cloverleaf Reference Implementation are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.5.0 — 2026-04-22

### Added — Discovery track is now real

- **Researcher agent** (`prompts/researcher.md`) — operations `draftRfc` (reads brief + docs, emits RFC with `unknowns[]` for candidate spikes) and `runSpike` (executes a spike, emits `findings` + `recommendation`). Dual-operation prompt file.
- **Plan agent** (`prompts/plan.md`) — operation `breakdown` (approved RFC + completed spikes → Plan with edge-based `task_dag` + inline `tasks[]` + optional `path_reviewer_map`).
- **Discovery skills** (6 new):
  - `/cloverleaf-new-rfc <brief-file>` — scaffolds a new RFC in `.cloverleaf/rfcs/`.
  - `/cloverleaf-draft-rfc <RFC-ID>` — invokes Researcher draftRfc; emits one Spike per unknown; transitions RFC to spike-in-flight or planning.
  - `/cloverleaf-spike <SPIKE-ID>` — invokes Researcher runSpike; transitions pending → running → completed with findings + recommendation.
  - `/cloverleaf-breakdown <RFC-ID>` — invokes Plan breakdown on an approved RFC; emits a Plan at `task_batch_gate` gate-pending.
  - `/cloverleaf-gate <item-id> <approve|reject|revise> [reason]` — human gate action on RFC (`rfc_strategy_gate`, all 3 actions) or Plan (`task_batch_gate`, approve/reject only).
  - `/cloverleaf-discover <brief-file>` — full Discovery orchestrator mirroring `/cloverleaf-run`. Drives RFC → (Spikes) → Plan → gates → task materialisation, then prompts to kick off Delivery on the first DAG root via `/cloverleaf-run`.
- **Per-type library modules** — `lib/rfc.ts`, `lib/spike.ts`, `lib/plan.ts`. Each exports `loadX`, `saveX` (with AJV `validateOrThrow`), `advanceXStatus` (delegates to `advanceWorkItemStatus`). `lib/plan.ts` also exports `materialiseTasksFromPlan` — atomic batch task-file creation with DFS cycle detection + pre-validation of every task before any file write.
- **Generic work-item helper** — `lib/work-item.ts::advanceWorkItemStatus<T>` + `loadStateMachine(type)`. The per-type modules delegate emit-then-save atomicity through this helper, so each type inherits the "orphan event" guard established in v0.1.1.
- **Discovery config** — `config/discovery.json` package default (`{ "docContextUri": "", "projectId": "", "idStart": 1 }`; all generic values). Consumer override at `<repoRoot>/.cloverleaf/config/discovery.json` with full-replacement + per-field fallback normalisation. Loader: `loadDiscoveryConfig(repoRoot)`. CLI: `cloverleaf-cli discovery-config --repo-root <path>`.
- **Shared work-item ID helper** — `nextWorkItemId(repoRoot, project)` scans `.cloverleaf/{rfcs,spikes,plans,tasks}/` for the next sequential ID, matching the oauth-rollout scenario convention where IDs share a per-project namespace across types (directory determines type, not ID).
- **CLI subcommands** (12 new) — `load-rfc`, `save-rfc`, `advance-rfc [gate]`, `load-spike`, `save-spike`, `advance-spike`, `load-plan`, `save-plan`, `advance-plan [gate]`, `materialise-tasks <plan-id>`, `next-work-item-id <project>`, `discovery-config --repo-root <path>`. All `advance-*` commands enforce the v0.1.1 actor guardrail (`agent` or `human` only; `system` rejected).

### Changed

- `lib/state.ts` renamed to `lib/task.ts` (no behavioural change). Prepares the lib for parallel per-type modules.
- `lib/task.ts::advanceStatus` now delegates to `lib/work-item.ts::advanceWorkItemStatus`. Public signature unchanged; the orphan-event error format preserves byte-for-byte compatibility with v0.4.1 regex matches.

### Compatibility

- Standard stays at 0.4.1. No schema, contract, or state-machine changes. RFC/Spike/Plan schemas + contracts have shipped in Standard since 0.2.0.
- Existing Delivery-track skills (`/cloverleaf-implement`, `-document`, `-review`, `-ui-review`, `-qa`, `-merge`, `-run`) are unchanged.
- Existing `nextTaskId` export still works (back-compat).

### Tests

~375 tests passing (up from 273 at v0.4.1).

## [0.4.1] — 2026-04-21

### Added
- `cloverleaf-cli plugin-root` subcommand — prints the CLI's plugin root, used by skills to locate prompts/config regardless of install mode.
- `axe.ignored` field in `config/ui-review.json` — array of `{ruleId, target}` tuples to drop matching findings before verdict computation. Unblocks tasks on surfaces with pre-existing a11y debt.

### Fixed
- `cloverleaf-merge` skill now performs a real `git merge --no-ff` (was only committing state transitions, leaving feature-branch code/baselines stranded).
- `latestFeedback` now finds the most recent feedback across `r`/`u`/`q` prefixes (was `r`-only).
- Reviewer skills (`-review`, `-ui-review`, `-qa`) reliably persist feedback under `.cloverleaf/feedback/` with an explicit `git add` + `git commit` after `write-feedback`.
- UI Reviewer's `compareVisual` paths explicitly rooted at `{{repo_root}}` (not the worktree) — prevents stray baselines in main repo during pipeline runs.
- Reviewer skills clean up `/tmp/cloverleaf-fb-*.json` at step 0 — prevents stale feedback from prior tasks bleeding into new runs.
- Skills no longer hardcode `~/.claude/plugins/cloverleaf/` paths. They use `$(cloverleaf-cli plugin-root)/...` — works under any install mode (npm install, `claude plugin install`, `--plugin-dir`, legacy symlinks).

### Changed
- Cloverleaf's own `.cloverleaf/config/ui-review.json` adds `axe.ignored` entries for pre-existing /guide/ `.step-meta` color-contrast violations (unblocks CLV-008-class tasks on /guide/).

## [0.4.0] — 2026-04-21

### Added
- Visual regression diffs via pixelmatch; baselines at `.cloverleaf/baselines/{route-slug}-{viewport}.png`, committed to git and updated on merge.
- Multi-viewport screenshot pass (mobile/tablet/desktop defaults, consumer-overridable).
- `config/ui-review.json` — new consumer-overridable config shipped as package default.
- `loadUiReviewConfig(repoRoot)` loader + `cloverleaf-cli ui-review-config` subcommand for prompt substitution.
- Configurable axe viewport coverage with `(ruleId, target)` dedupe; findings aggregate viewports into `metadata.viewports`.
- QA HTML report at `.cloverleaf/runs/{taskId}/qa/report.html`; report path surfaced via `finding.attachments`.
- `Finding.attachments` and `Finding.metadata` typed fields (requires `@cloverleaf/standard@^0.4.0`).

### Changed
- Package config defaults in `reference-impl/config/*.json` are now framework-generic. Cloverleaf's own site continues to work via `.cloverleaf/config/` consumer overrides (populated in v0.3.1).
- `@cloverleaf/standard` peer dep bumped from `^0.3.0` to `^0.4.0`.

### Breaking
- Removed deprecated loaders (already superseded in v0.3.1 by `loadXConfig(repoRoot)` equivalents):
  - `loadDefaultPatterns` → use `loadUiPathsConfig(repoRoot).patterns`
  - `loadDefaultRules` → use `loadQaRulesConfig(repoRoot)`
  - `loadDefaultConfig` → use `loadAffectedRoutesConfig(repoRoot)`

## [0.3.1] — 2026-04-20

### Added

- Consumer-override mechanism for all shipped configs. Place `<repoRoot>/.cloverleaf/config/<name>.json` to replace the package default (full replacement, no merge).
- New APIs with `repoRoot` parameter: `loadUiPathsConfig(repoRoot)`, `loadQaRulesConfig(repoRoot)`, `loadAffectedRoutesConfig(repoRoot)`.
- `contentRoutes` field in `affected-routes.json` — maps content-file globs to specific routes (e.g., `{"site/src/content/guide/**": "/guide/"}`). Evaluated after `pageRoots` and before the `routeScope` conservative fallback.
- UI Reviewer prompt checks `<repoRoot>/.cloverleaf/config/astro-base.json` before parsing `astro.config.*`.
- `/cloverleaf-qa` skill reads consumer `qa-rules.json` override if present.
- README: new "Customizing for your repo" section documenting the override mechanism.

### Changed

- CLI commands `detect-ui-paths` and `affected-routes` now pass `repoRoot` through to the new loaders — overrides take effect at the skill level.
- Package default `affected-routes.json` gains `contentRoutes: {}` field (empty; cloverleaf's own override populates it).

### Deprecated

- `loadDefaultPatterns()`, `loadDefaultRules()`, `loadDefaultConfig()` remain exported for one release as thin wrappers around the package defaults (bypass consumer overrides). Prefer the new `loadXConfig(repoRoot)` APIs. Deprecated wrappers will be removed in v0.4.

### Fixed

- **Architectural drift:** cloverleaf-specific defaults no longer dictate behavior for external consumers. The package remains usable as a reference implementation for other codebases.
- **Astro base path hardcoding:** no cloverleaf-specific base path ships in any package artifact. Consumers supply their own via `astro-base.json` or via parseable `astro.config.*`.

### Dependencies

- Unchanged: `@cloverleaf/standard@^0.3.0` (accepts Standard 0.3.1 automatically).

## [0.3.0] — 2026-04-20

### Added

- `affected-routes` CLI command — computes which site routes a task's diff affects. Outputs a JSON array, the string `"all"` (global change detected), or `[]` (no renderable routes).
- `lib/affected-routes.ts` — pure `computeAffectedRoutes` helper + `loadDefaultConfig`.
- `config/affected-routes.json` — default rules: page-root / global-pattern / route-scope. Consumer-overridable.
- UI Reviewer prompt placeholder `{{affected_routes}}`.
- Install script warns when Playwright chromium is not cached.
- CLI-level integration test for ui-review skip path.

### Changed

- UI Reviewer runs axe ONLY on pages in the task's affected-routes set. If the set is `[]`, the skill skips axe entirely and advances `ui-review → qa`. If `"all"`, the v0.2 crawl behavior applies (up to 20 pages reachable from `/`).
- `/cloverleaf-ui-review` skill sets `PLAYWRIGHT_BROWSERS_PATH=~/.cache/ms-playwright` before subagent dispatch. Playwright resolves chromium from the shared user-level cache; ~300 MB download is one-time, not per run.
- Known-limitations section updated: diff-scoping + Playwright caching issues from v0.2 are closed; visual diff / multi-viewport deferred to v0.4.

### Fixed

- Pre-existing a11y violations on unrelated pages no longer bounce PRs that don't touch them (v0.2 known limitation; surfaced by CLV-003 dogfood).
- Playwright's ~300 MB chromium install is no longer repeated per `/cloverleaf-ui-review` invocation (v0.2 known limitation).

### Dependencies

- Unchanged: `@cloverleaf/standard@^0.3.0`, `playwright@^1.47.0`, `axe-core@^4.10.0`.

## [0.2.0] — 2026-04-20

### Added

- Documenter agent (`/cloverleaf-document`) — doc-only commits per file-path rules
- UI Reviewer agent (`/cloverleaf-ui-review`) — Playwright + axe-core accessibility review, single viewport
- QA agent (`/cloverleaf-qa`) — per-package test runner via `git worktree`
- `config/ui-paths.json` — configurable UI path glob patterns (default: `site/**`)
- `config/qa-rules.json` — configurable per-package test commands
- `lib/ui-paths.ts`, `lib/qa-rules.ts`, `lib/ports.ts` — supporting helpers
- `detect-ui-paths` CLI command
- `--prefix=<r|u|q>` flag on `write-feedback` CLI to disambiguate reviewer feedback files
- CLI-level integration test for full pipeline (`tests/e2e.full-pipeline.test.ts`)

### Changed

- `/cloverleaf-run` orchestrator is path-aware: reads `task.risk_class` to dispatch fast lane (`low`) or full pipeline (`high`)
- `/cloverleaf-implement` stops at `implementing` state for `risk_class: "high"` (Documenter runs next)
- `/cloverleaf-merge` branches on state: `automated-gates` → fast-lane `human_merge`; `final-gate` → `final_approval_gate` with richer summary
- `/cloverleaf-new-task` formalizes `risk_class` inference with explicit keyword list and `--risk=high|low` override
- Per-agent bounce budgets (3 each: Reviewer, UI Reviewer, QA) instead of single global counter
- CLI bin compiled to `.mjs` (was `.ts` via `tsx` shim)
- `npm test` now runs `tsc --noEmit` before vitest to enforce `@ts-expect-error` directives

### Fixed

- `ProjectDoc.name` is now required in TypeScript type (matches schema)
- Toy-repo `DEMO-RFC-001` is now a real file (was a phantom reference)

### Dependencies

- Added: `playwright@^1.47.0`, `axe-core@^4.10.0`
- Unchanged: `@cloverleaf/standard@^0.3.0`

### Known limitations (surfaced by dogfood run)

- UI Reviewer runs axe-core against the full rendered site, not the PR diff. Pre-existing accessibility violations on unrelated pages will bounce PRs that don't touch them. Workaround: the orchestrator operator can override the bounce when the findings are outside the diff (the feedback is still written to `.cloverleaf/feedback/<TASK-ID>-u<N>.json` for traceability). A diff-scoped UI Reviewer is planned for v0.3.
- Playwright's ~300MB browser install runs once per machine but is not cached across `git worktree`s — each UI Reviewer invocation runs `npm ci` inside the worktree which picks up the globally-installed browsers from `~/.cache/ms-playwright/`. Cache-aware install deferred to v0.3.

## [0.1.1] — 2026-04-20

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

## [0.1.0] — 2026-04-20

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
