# Changelog

All notable changes to the Cloverleaf Reference Implementation are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.6.0 — 2026-04-24

First feature release after the CLV-15 / cross-browser-UI-review line of
patches. Introduces an autonomous DAG walker that drives a Plan's task_dag
through Delivery concurrently.

### Added

- **`/cloverleaf-run-plan <PLAN-ID>`** skill — autonomous DAG walker.
  Reads an approved Plan, computes ready tasks, spawns one claw-drive
  Session B per ready task (default `max_concurrent: 3`, configurable via
  `--max-concurrent=N`), monitors them, surfaces only escalations and
  per-task final-gate approvals to the human. Resumable across
  invocations. `--reset` flag to wipe walk-state and start over.
- `lib/dag-walker.ts` — `computeReadyTasks(plan, walkState, maxConcurrent)`
  pure function for DAG scheduling; `detectCycle(plan)` Tarjan-style cycle
  guard.
- `lib/walk-state.ts` — atomic read/write of
  `.cloverleaf/runs/plan/<PLAN-ID>/walk-state.json`.
- Four new `cloverleaf-cli` subcommands: `dag-ready-tasks`,
  `dag-detect-cycle`, `walk-state-read`, `walk-state-write`. The walker
  skill body invokes these to bridge bash to the TypeScript library.
- `scripts/acceptance-walker.sh` (run via `npm run acceptance:walker`) —
  release-gate harness for the walker's data plane. Synthesises a tmp
  Cloverleaf consumer repo with a 3-peer Plan and exercises the seven
  CLI/walk-state behaviours that compose the walker's tick loop: cycle
  detection on clean Plan, dag-ready-tasks at full and capped concurrency,
  walk-state write+read round-trip, slot-accounting against a running
  task, all-merged exit set, and cycle detection on a 2-cycle Plan. No
  Claude tokens consumed; complements the manual dogfood for full
  Session-orchestration validation.

### Changed

- `/cloverleaf-merge` skill gains a Q&A affordance at the final-gate
  prompt. Users can ask clarifying questions (which get answered from
  pipeline context and re-prompted) before giving the `y/N` verdict.
  Only `y/Y/yes/YES` proceeds to merge; `n/N/no/NO` declines. Any other
  response is treated as a question. The walker depends on this
  behaviour, but manual merges get the same affordance as a side-effect.

### Tests

547 tests passing, up from 506 in v0.5.5. New suites:

- `tests/dag-walker.test.ts` — 13 tests (9 for `computeReadyTasks`, 4 for
  `detectCycle`).
- `tests/walk-state.test.ts` — 7 tests (path construction, round-trip,
  atomic write, tmp-file cleanup, malformed JSON).
- `tests/cli.test.ts` — +4 tests for the new walker subcommands.
- `tests/skills.test.ts` — +13 tests asserting `/cloverleaf-run-plan`
  skill-body shape + 3 tests for the `/cloverleaf-merge` Q&A loop.

### Compatibility

- Standard stays at 0.4.1. No schema, contract, or state-machine changes.
- Existing `/cloverleaf-run <TASK-ID>` unchanged. The walker invokes it
  per-task inside each Session B.
- The `/cloverleaf-merge` change is additive — existing `y/Y/yes/YES`
  and `n/N/no/NO` responses continue to work exactly as before. Only
  arbitrary text was previously treated as decline; now it's a question.

## 0.5.5 — 2026-04-24

Bundles the merged CLV-20 end-to-end integration test (the Plan CLV-15 join
node) with a `prep-worktree` idempotence fix surfaced by CLV-20's own
Reviewer. Plan CLV-15 (cross-browser UI review, RFC CLV-9) is now fully
delivered on `main`.

### Fixed

- `cloverleaf-cli prep-worktree` no longer fails with `EEXIST` when invoked
  on a worktree that already has a partially-populated `node_modules` tree.
  CLV-20's Reviewer hit `Error: EEXIST, File exists '.../vite/node_modules/.bin'`
  on the second `prep-worktree` invocation. Root cause: Node's `cpSync`
  with `verbatimSymlinks: true` does not reliably overwrite an existing
  symlink at the destination, even with `force: true` (the default). The
  v0.5.2 synthetic unit-test fixtures didn't exercise nested `.bin`
  symlinks (as created by npm under `vite/node_modules/.bin → ../../.bin`),
  so the regression slipped through. Fix introduces an internal
  `primeCopy(src, dst)` helper that wipes `dst` before `cpSync`, making
  `prep-worktree` idempotent.

### Added

- End-to-end integration test
  (`reference-impl/tests/e2e.ui-review-cross-browser.test.ts`) — 638 lines,
  17 tests. Exercises the cross-browser UI review pipeline using synthetic
  PNG buffers (no real Playwright launch), wiring together `visual-diff`,
  `ui-browser`, `axe-dedupe`, `ui-review-state`, `ui-review-config`, and
  the task state machine. Covers: 3-browser matrix (chromium/webkit/firefox)
  × per-browser baseline paths (`.cloverleaf/baselines/{browser}/...`),
  per-engine escalation, axe-chromium-only rule, `maxCombinations` cap,
  `baselines_pending` gate blocking `ui-review → qa`, and
  `/cloverleaf-approve-baselines` clearing the flag. Completes CLV-20 (join
  node of Plan CLV-15).

### Tests

506 tests passing (+19 from v0.5.4: 17 new from CLV-20 + 2 prep-worktree
idempotence regression tests).

### Compatibility

- Standard stays at 0.4.1. No schema, contract, state-machine, or library-API
  changes.
- `prepWorktree()` internal helper `primeCopy` is not exported; callers of
  the library API or CLI observe only that repeat invocations now succeed.

## 0.5.4 — 2026-04-24

Bundles the merged CLV-19 baseline-approval sidecar with a follow-up typo
fix surfaced by CLV-19's own Reviewer.

### Fixed

- `cloverleaf-ui-review/SKILL.md` now uses the fully-qualified
  `/cloverleaf-approve-baselines <TASK-ID>` in its human-facing message when
  `baselines_pending` is true. The previous text said `/approve-baselines`,
  which would have produced a "skill not found" error if a human copied the
  message verbatim (the registered plugin-scoped skill name is
  `/cloverleaf-approve-baselines`, matching every other skill in the
  `cloverleaf-*` family). Regression guarded in `tests/skills.test.ts`.

### Added

- `lib/ui-review-state.ts` — new module with `UiReviewState` interface and three exports: `uiReviewStatePath(repoRoot, taskId)`, `readUiReviewState(repoRoot, taskId)`, `writeUiReviewState(repoRoot, taskId, state)`. Reads/writes the baseline-approval sidecar at `.cloverleaf/runs/{taskId}/ui-review/state.json`. Absent file is treated as `{ baselines_pending: false }`.
- `lib/paths.ts` gains two new exported helpers: `runsDir(repoRoot)` and `uiReviewRunDir(repoRoot, taskId)` — canonical path constructors for the runs directory and per-task ui-review run directory.
- `cloverleaf-cli read-ui-review-state <repoRoot> <taskId>` — reads and prints the ui-review state sidecar JSON to stdout.
- `cloverleaf-cli write-ui-review-state <repoRoot> <taskId> <baselines_pending>` — writes `{ baselines_pending: true|false }` to the ui-review state sidecar, creating intermediate directories as needed.
- `/cloverleaf-approve-baselines` skill (`skills/cloverleaf-approve-baselines/SKILL.md`) — human baseline-approval gate. Triggered when `cloverleaf-ui-review` reports `baselines_pending: true`. Presents new baseline images to the human for review, writes `baselines_pending: false` via `cloverleaf-cli write-ui-review-state`, then advances the task from `ui-review` → `qa`.

### Changed

- UI Reviewer prompt (`prompts/ui-reviewer.md`) now writes the `state.json` sidecar (step 12, before teardown). Sets `baselines_pending: true` if any `compareVisual` call returned `new-baseline` or `dimension-mismatch`; otherwise writes `baselines_pending: false`. Teardown is renumbered from step 12 to step 13.
- `/cloverleaf-ui-review` skill reads the `state.json` sidecar after the subagent completes. If `baselines_pending` is `true`, the task stays in `ui-review` status and the skill reports that `/cloverleaf-approve-baselines` must be run before the task can advance to `qa`. If `baselines_pending` is `false` (or state.json is absent), the task advances to `qa` normally.

## 0.5.3 — 2026-04-24

Bundles the merged CLV-18 cross-browser UI Reviewer work with a Documenter
pipeline bug fix that was reproduced three consecutive Delivery runs.

### Added

- `lib/ui-browser.ts` — two new exported helpers:
  - `buildBrowserEscalationFinding(engine, platform?)` — builds an `error`-severity Finding with `rule: "browser-missing"` naming the missing Playwright engine and its install command. On Linux, the message appends the `install-deps` hint.
  - `applyMaxCombinationsCap(routes, viewportCount, browserCount, maxCombinations)` — enforces the `maxCombinations` cap: sorts affected routes by diff size (most-changed first), keeps the first `floor(maxCombinations / (viewports × browsers))` routes, and returns one `warning`-severity Finding with `rule: "ui-review-cap"` per skipped route.

### Changed

- UI Reviewer prompt (`prompts/ui-reviewer.md`) refactored for v0.5 multi-browser behavior:
  - **Browser outer loop**: browser is now the outermost loop, wrapping the viewport × route loops. Engines are drawn from `config.browsers`.
  - **Per-engine escalation**: before launching any browser session, all required engine binaries are verified. If any are absent, `verdict: "escalate"` is returned immediately with `buildBrowserEscalationFinding` findings for every missing engine.
  - **axe-core chromium-only**: the axe pass runs exclusively on the engine named by `config.axe.browser` (default `"chromium"`). webkit and firefox passes produce no axe output and no axe findings, avoiding engine-specific false positives from Blink/WebKit/Gecko divergence (CLV-12).
  - **maxCombinations cap**: before starting browser sessions, the reviewer computes `routes × viewports × browsers`. If the product exceeds `config.maxCombinations` (default 90), it applies `applyMaxCombinationsCap` and emits `ui-review-cap` warnings for each skipped route. `ui-review-cap` warnings are never gating.
  - Baseline paths use the `{browser}` subdirectory (`.cloverleaf/baselines/{browser}/{slug}-{viewport}.png`), consistent with CLV-17.
  - Visual-diff finding messages and metadata now include the `browser` dimension.
  - Output schema extended: `rule` may now be `"ui-review-cap"` or `"browser-missing"` in addition to the existing `"a11y.<rule-id>"` and `"visual-diff"` values.
  - `cloverleaf-cli prep-worktree` is now called immediately after `git worktree add` in the runtime procedure.
- Documenter prompt (`prompts/documenter.md`) "Commit discipline" section rewritten. The prompt now instructs the Documenter subagent to run `git status --porcelain` in the worktree before committing, stage every modified doc file explicitly (or `git add -A` when only docs are modified), and self-check that `git status` is empty before returning. The previous phrasing ("One commit per file touched") allowed the subagent to commit only CHANGELOG.md while silently leaving README.md edits uncommitted.

### Fixed

- Documenter subagent no longer silently drops README edits when both
  CHANGELOG.md and README.md are modified in the same worktree. This bug
  was reproduced on three consecutive Delivery runs (CLV-16, CLV-17,
  CLV-18) — each time the driver had to reject the commit and instruct the
  subagent to include README.md explicitly. The v0.5.3 prompt rewrite
  (above) forces an explicit `git status` read and an empty-status
  self-check.

### Tests

443 tests passing (+2 from v0.5.2's 410; net includes CLV-18's additions and
the 2 new documenter prompt regression assertions).

### Compatibility

- Standard stays at 0.4.1. No schema, contract, state-machine, or library-API
  changes.
- The Documenter prompt body gained two new assertions in
  `tests/prompts.test.ts` (one positive, one negative around the
  CHANGELOG-only failure mode) — downstream forks that rewrote the
  Documenter prompt may need to reintroduce the `git status --porcelain`
  phrasing and the CHANGELOG-only warning.

## 0.5.2 — 2026-04-24

Bundles the CLV-16 + CLV-17 cross-browser groundwork with two dogfood-surfaced
pipeline bug fixes (both reproduced on CLV-16 2026-04-22 and CLV-17 2026-04-24
Delivery runs via claw-drive).

### Added

- `UiReviewConfig` gains three new backward-compatible fields: `browsers` (array
  of `BrowserEngine` strings, default `["chromium"]`), `axe.browser` (string,
  default `"chromium"`), and `maxCombinations` (integer, default `90`). Configs
  that omit these keys continue to work unchanged — `applyDefaults()` fills
  them in at load time.
- `BrowserEngine` type alias (`'chromium' | 'webkit' | 'firefox'`) exported
  from `lib/ui-review-config.ts`.
- `install.sh` now runs `npx playwright install chromium webkit firefox` (all
  three browsers) after the existing chromium step, and on Linux also runs
  `npx playwright install-deps webkit` for webkit system dependencies.
- `buildBaselinePath(repoRoot, browser, slug, viewport)` exported from
  `lib/visual-diff.ts` — constructs the canonical baseline path
  `.cloverleaf/baselines/{browser}/{slug}-{viewport}.png`. Callers should use
  this helper instead of constructing paths manually.
- `cloverleaf-cli prep-worktree <mainRoot> <worktreePath>` (new subcommand) —
  primes a freshly-created git worktree for the reference-impl test suites by
  copying main's `standard/node_modules` and `reference-impl/node_modules`
  into the worktree (preserving the `@cloverleaf/standard → ../../../standard`
  relative symlink so it resolves to the worktree's own `standard/`), then
  running `npm run build` inside the worktree's `standard/` so `dist/` comes
  from the branch's own sources. Exposed via a new `prepWorktree()` export
  from `lib/prep-worktree.ts`.

### Changed

- Baseline storage layout migrated from flat
  (`.cloverleaf/baselines/{slug}-{viewport}.png`) to browser-subdirectory
  layout (`.cloverleaf/baselines/{browser}/{slug}-{viewport}.png`) via `git
  mv` (CLV-17). The flat layout is **deprecated**; all new baselines must be
  placed under `baselines/{browser}/`. Existing chromium baselines have been
  moved to `baselines/chromium/`.
- UI Reviewer prompt and `compareVisual` call-sites updated to construct
  `baselinePath` with the `{browser}` segment. Attachment label paths in
  reviewer output reference the new subdir form.
- QA prompt (`prompts/qa.md`) now invokes `cloverleaf-cli prep-worktree`
  immediately after `git worktree add`.
- Reviewer prompt (`prompts/reviewer.md`) now invokes `cloverleaf-cli
  prep-worktree` in its worktree recipe and runs `npm test` from
  `reference-impl/` (rather than `npm install && npm test` at the worktree
  root, which never resolved `@cloverleaf/standard`'s deps).
- Vitest `testTimeout` bumped from the 5 s default to 15 s. CLI-level tests
  chain three or more `npx tsx cli.ts` spawns (~1.8 s each); the default was
  reliably exceeded by `advance-rfc`, `advance-spike`, and `advance-plan`
  flows on a loaded machine.

### Fixed

- `/cloverleaf-merge` skill no longer calls `advance-status ... merged agent`
  for the `final-gate → merged` transition. That transition is
  `allowed_actors: [human]` per the task state machine, so the CLI correctly
  rejected it with `Illegal transition final-gate → merged ... by agent`. The
  skill now passes `human final_approval_gate full_pipeline` as positional
  args. Driven sessions on CLV-16 and CLV-17 had to self-recover by reading
  the CLI signature and retrying.
- Reviewer and QA subagents running tests in a fresh git worktree no longer
  fail with `Cannot find module '@cloverleaf/standard/validators/index.js'`.
  Git worktrees don't inherit `node_modules`, and `npm install` in the
  worktree's `reference-impl/` followed the `file:../standard` dep into a
  `standard/` that had no built `dist/` and no runtime deps (`ajv-formats`
  etc.). The new `prep-worktree` helper wires up both. QA subagents in the
  CLV-16 and CLV-17 Delivery runs had to hand-apply two `cp -r` workarounds.

### Tests

410 tests passing (+30 from v0.5.1):

- 6 unit tests for `prepWorktree` (node_modules copy, standard/dist build,
  relative-symlink preservation, error paths).
- 2 CLI tests for `prep-worktree` (usage + error wiring).
- 2 skill-body regression tests for the merge-skill actor bug.
- 2 prompt regression tests asserting QA/Reviewer prompts invoke
  `prep-worktree`.
- Plus CLV-17 regression tests (browser subdirectory baselines) carried over
  from the v0.5 cross-browser work.

### Compatibility

- Standard stays at 0.4.1. No schema, contract, or state-machine changes.
- `prepWorktree()` is a new library export; no existing APIs changed.
- Skill body tests now forbid `advance-status ... merged agent` in
  `cloverleaf-merge`. Downstream forks that patched the skill to retry with
  `agent` will need to drop that patch.

## 0.5.1 — 2026-04-22

Bug-fix release closing issues surfaced by the v0.5 Discovery-track dogfood
(cross-browser UI review, `/cloverleaf-discover docs/briefs/cross-browser-ui-review.md`).

### Fixed

- `saveRfc`, `saveSpike`, `savePlan`, `saveTask` now auto-create their parent
  directories (`.cloverleaf/rfcs/`, `spikes/`, `plans/`, `tasks/`) on first
  write. Prior to this fix a fresh consumer repo hit `ENOENT` on the first
  `/cloverleaf-discover` run, which cascaded into an inconsistent
  `spike-in-flight` RFC with zero spikes on disk. Mirrors the v0.1.1 fix for
  `events/` and `feedback/`.
- `/cloverleaf-new-rfc` title scaffold no longer carries a trailing newline.
  `echo "$FIRST_LINE" | jq -Rs .` captured `\n` into the JSON string; switched
  to `printf '%s' "$FIRST_LINE" | jq -Rs .`, same fix for the `problem` field.
- `/cloverleaf-discover` prose rewritten from "inline `/cloverleaf-X` steps" to
  "invoke `/cloverleaf-X`" across all 10 sub-skill references. Matches the
  observed runtime behaviour (driven Claude spawns sub-skills via the Skill
  tool) and removes the mental-model mismatch for humans reading the skill.

### Compatibility

- Standard stays at 0.4.1. No schema, contract, or state-machine changes.
- No library API changes — `saveX` signatures unchanged; existing callers
  benefit from auto-dir-creation transparently.

### Tests

380 tests passing (+6 regression tests: 4 auto-create tests across
rfc/spike/plan/task, 1 for the printf guard in new-rfc, 1 for the
invoke-not-inline guard in discover).

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
