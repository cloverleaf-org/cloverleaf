# Changelog

All notable changes to the Cloverleaf Interoperability Standard are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/spec/v2.0.0.html), with the pre-1.0 policy that MINOR releases may include breaking changes.

## [Unreleased]

### Added
- `task.security_review_verdict` optional field (`"pass" | "bounce" | "escalate" | null`, default `null`) — records the outcome of a Security Reviewer cycle. Null until a review completes; reset to `null` on any transition that carries `resets_security_verdict: true`.
- State-machine transition annotations: `security_gate: true` on the three `automated-gates →` outbound transitions (to `ui-review`, `qa`, and `merged`) — signals that an L3 Host must gate on `security_review_verdict` before allowing passage; `resets_security_verdict: true` on the `review → automated-gates` transition — signals that the field is cleared on re-entry.
- TypeScript type additions: `security_class` and `security_review_verdict` optional properties on the `Task` interface; `security_gate` and `resets_security_verdict` optional boolean properties on `StatusTransitions` transition items.
- Conformance tests: 4 new `status-transitions.test.ts` cases covering `security_gate` / `resets_security_verdict` annotation identity; 6 new `task.test.ts` cases covering `security_review_verdict` field acceptance and rejection.

## 0.7.0 — 2026-05-13

### Added
- `task.security_class` enum (`low`/`high`, optional, default `low`) — independent of `risk_class`; gates the Security Reviewer.
- `security-review` task state + transitions: `automated-gates → security-review`, `security-review → {automated-gates, implementing, escalated}`. Security review is an automated check off the `automated-gates` hub.
- `conformance/fixtures/task-security-high.json` + `conformance/tests/security-fixture.test.ts`.

### Compatibility
- Additive only. All 0.6.x task documents validate unchanged (`security_class` optional; new state/transitions are new).

## 0.6.0 — 2026-05-11

### Added
- **Plan state machine: new `completed` terminal state.** New transition `approved → completed` (`allowed_actors: ["agent"]`). Walker advances a Plan to `completed` after the final child task's merge commit. Previously, `approved` was the only post-gate terminal state — Plans whose tasks were all merged stayed at `approved` indefinitely, making it impossible to distinguish "decomposition approved, work in flight" from "decomposition approved, work fully delivered" by status alone. Surfaced by claw-crypto dogfood (Plans CC-10/CC-27/CC-37 all stuck at `approved` after every child task merged). `terminal` updated to `["completed", "rejected"]`; `all` gains `"completed"`.
- **RFC state machine: new `completed` terminal state.** New transition `approved → completed` (`allowed_actors: ["agent", "human"]`). Walker auto-advances an RFC after every Plan completion when (a) no sibling Plan of the same `parent_rfc` is still in-flight (`drafting`, `gate-pending`, or `approved`) AND (b) at least one sibling Plan reached `completed`. The "at-least-one-completed" guard avoids advancing an RFC whose Plans were all `rejected` — those leave the RFC at `approved` for the operator to abandon or re-decompose. Humans may also advance manually for backfill (e.g. claw-crypto Plans CC-10/CC-27/CC-37 backfilled to `completed` would auto-advance their parent RFCs CC-1/CC-21/CC-35 to `completed`). `terminal` updated to include `"completed"`; `all` gains `"completed"`.
- Schemas (`plan.schema.json`, `rfc.schema.json`) status enums extended with `"completed"`.

### Compatibility
- Additive only. Plan/RFC documents valid under 0.5.x remain valid under 0.6.0 — no existing field shape changed. Documents that previously sat at `status: "approved"` after all work merged continue to validate; they can be manually advanced to `completed` via `cloverleaf-cli advance-plan <repo> <plan-id> completed agent` (and similarly `advance-rfc`) if backfilling is desired.

## 0.5.0 — 2026-04-29

### Added
- `task.scope` — new optional top-level object property on the Task schema. Contains a `files_touched` string-array sub-field (uniqueItems, minLength 1 per item). Declared with `additionalProperties: false` to prevent unrecognised fields.
- `conformance/fixtures/scope-files-touched-overlap.json` — fixture demonstrating two tasks that share a path in `scope.files_touched`.
- `conformance/tests/scope-fixtures.test.ts` — Vitest suite validating all fixture files under `conformance/fixtures/`.

### Compatibility
- Additive only. The `scope` field is optional; all documents valid under 0.4.x remain valid under 0.5.0.

## [0.4.1] — 2026-04-21

### Added
- Compiled output at `dist/` — `dist/validators/index.js` + `.d.ts`. Package now ships runtime JS so downstream consumers don't need `tsx` to `import '@cloverleaf/standard/validators/index.js'`.
- `exports` map in package.json pointing at compiled output for `.`, `./validators`, `./validators/*.js`. Raw JSON/YAML paths (schemas, agent-contracts, state-machines) still exposed for direct reads.

### Changed
- `prepublishOnly` now runs `npm run build` in addition to tests + validate:examples.

### Compatibility
- Additive. Consumers don't need to change import paths; node's exports resolution redirects `@cloverleaf/standard/validators/index.js` to `./dist/validators/index.js` transparently.

## [0.4.0] — 2026-04-21

### Added
- `finding.attachments`: optional array of `{ label, path }` objects for artifact paths accompanying a finding (screenshots, reports). Paths are repoRoot-relative.
- `finding.metadata`: optional free-form object for source-specific structured data (e.g., axe rule metadata, viewport aggregations, diff ratios).

### Compatibility
- Additive only. Feedback documents valid under 0.3.1 remain valid under 0.4.0.

## [0.3.1] — 2026-04-20

### Added

- `isSpecificLevel(arg): arg is Level` type guard in `conformance/level-map.ts`.
- `conformance/tests/by-level/_helpers.ts` with shared sidecar-reading and fixture-walking helpers.
- `conformance/tests/by-level/_helpers.test.ts` covers the new helpers directly.

### Changed

- `conformance/runner.ts` replaces `as Level` casts with `isSpecificLevel(arg)` narrowing. No behavioral change.
- `conformance/tests/by-level/l{1,2,3}.test.ts` import helpers from `_helpers.ts` instead of duplicating logic locally. No behavioral change to test outcomes.

### Dependencies

- Unchanged.

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
