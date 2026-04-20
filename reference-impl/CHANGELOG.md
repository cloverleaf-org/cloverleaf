# Changelog

All notable changes to the Cloverleaf Reference Implementation are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
