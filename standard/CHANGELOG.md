# Changelog

All notable changes to the Cloverleaf Interoperability Standard are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/spec/v2.0.0.html), with the pre-1.0 policy that MINOR releases may include breaking changes.

## 0.8.0 — 2026-07-20

**Breaking: the task delivery states collapse into one generic `council` phase.** The `review`, `automated-gates`, `security-review`, `ui-review`, and `qa` states — and the fast-lane/full-pipeline split — are replaced by a single parameterized `council` phase driven by a configurable review council. This is the largest single change to the Standard; it breaks conformance for hosts built against the 0.7.x task FSM.

### Changed
- `state-machines/task.json` — collapse `review`/`automated-gates`/`security-review`/`ui-review`/`qa` into one `council` phase (exits: `final-gate` on pass, `implementing` on bounce, `escalated` on escalate; enter from `documenting`). Removed the `path` (`fast_lane`/`full_pipeline`), `security_gate`, and `resets_security_verdict` annotations. The fast lane now merges through `final-gate` under `final_approval_gate`; the `human_merge` gate is retired. `tactical-plan → pending` gains `agent` to its actors, enabling a decisive plan-review council bounce.
- `schemas/status-transitions.schema.json` — the `path` transition tag (`fast_lane` / `full_pipeline`) is removed. It encoded the lane split this release retires, and no shipped state machine carried one, so `validators/status-transition-legality.ts` could never reject on it — while the `path` it derived from `risk_class` still appeared in every illegal-transition message a task consumer saw. The transition object already sets `additionalProperties: false`, so a stale `path` tag is now rejected rather than accepted and ignored. `validators/types.ts` drops the matching field from the transition type; the unrelated `Violation.path` (a violation location) is untouched. The validator still accepts its optional `Task` argument, now purely for signature symmetry with `validators/security-gate.ts`.
- `schemas/task.schema.json` — the `status` enum is the nine collapsed states.
- `validators/types.ts`, `validators/gate-decision-validity.ts` — `GateDecisionEvent.gate` drops `human_merge`.
- `validators/security-gate.ts` — retained as a general primitive (a consumer FSM may still annotate `security_gate`); the default task FSM no longer uses it.
- `schemas/status-transitions.schema.json`, `validators/types.ts` — the transition object now declares the optional `security_gate` annotation. `validators/security-gate.ts` has enforced it since 0.7.1 and this release retains it as a consumer primitive, but the transition object sets `additionalProperties: false`, so a consumer state machine taking the documented affordance was rejected by schema validation. `examples/valid/status-transitions/security-gate.json` exercises it. `resets_security_verdict` is deliberately not declared and is dropped from the transition type: no validator reads it, and this document already records that the reset is not enforced, so declaring it would publish spec surface nothing implements.
- `package.json` — the `test` script now runs `tsc --noEmit` before `vitest run`, so type errors in conformance fixtures cannot ship undetected. `conformance/tests/validator-council-config.test.ts` gate-descriptor fixture annotated to the `Record<string, { kind?: Kind }>` contract the validator requires.
- `docs/validators.md` — removed the stale `human_merge` row from the gate-decision matrix; the gate was retired in this release.
- `README.md` — corrected for this release: eight agent contracts rather than seven (`chair.openapi.yaml` is new here), the `schemas/` bullet names the two council schemas, and the `state-machines/` bullet describes the collapsed task graph instead of the retired `security_gate` / `resets_security_verdict` edge annotations. The bullet also records that `validators/security-gate.ts` survives as a general primitive even though the default task FSM no longer uses it.
- `package.json`, `conformance/runner.ts` — the published package now carries the `examples/` fixture corpus. It shipped `conformance/runner.ts` and all three by-level suites without the fixtures they read, so the runner reported `8 checks, 0 failures` and exited 0 from the tarball where it reports 91 in-repo, and `docs/conformance.md` names that run as the evidence for a level claim. The runner additionally fails when a corpus root is missing or holds no usable fixtures, rather than reporting a vacuous pass — a behaviour change for any environment running it without fixtures, which previously received exit 0. Emptiness is measured per root by the same walk its own consumer uses: a fixture count for `valid/` and `invalid/`, and a scenario-directory count for `scenarios/`, whose fixtures live one level deeper.

### Added
- `schemas/council-config.schema.json` — validates a project's `.cloverleaf/config/council.json` (profiles + per-gate bindings; members carry an optional `kind` of `code`/`rfc`/`plan`).
- `schemas/council-result.schema.json` — validates the per-gate council audit artifact.
- `validators/council-config.ts` — kind-homogeneity (a profile's members share one kind; a bound profile's kind matches the gate's kind) + closed aggregation/when enums.
- `agent-contracts/chair.openapi.yaml` — the deliberative chair (judge) contract.
- `examples/invalid/status-transitions/retired-annotation.json` — a negative fixture pinning that the transition schema rejects `resets_security_verdict`, which this release removes from the transition type. The rejection was previously asserted only in this repository's own test suite.

### Migration
Upgrading from 0.7.1 to 0.8.0 is a clean break (no compat shim):
- Task documents with a `review` / `automated-gates` / `security-review` / `ui-review` / `qa` status map to `council`.
- The `human_merge` gate is gone; fast-lane merges use `final_approval_gate` at `final-gate`.
- A consumer state machine that tagged transitions with `path` must drop the tag: it is no longer declared, and the transition object rejects undeclared keys. The tag was only ever matched against a value derived from `risk_class` and fixed to the two lane names, so it could not express a consumer's own lanes; encode those as distinct states or `gate` values instead.
- `resets_security_verdict` is retired outright — it is declared by neither the transition schema nor the transition type, and no validator ever enforced the reset. The transition schema never declared it either, so no schema-valid state machine could carry it. TypeScript consumers that set or read `resets_security_verdict` will see a compile error on upgrade and should delete the field. `security_gate` is retired from the default task FSM, which annotates no transition with it, but remains an optional transition annotation that a consumer state machine may set and `validators/security-gate.ts` enforces. A high-security task's "no merge without a passing security review" guarantee is now enforced by a blocking `security` council member (any-veto) plus a recorded `security_review_verdict='pass'` on `council → final-gate`.
- Discovery gates (`rfc.strategy_gate`, `plan.task_batch`) may bind advisory councils built from kind-homogeneous custom roles; the `plan.json` / `rfc.json` state machines are unchanged.
- An environment that runs the conformance runner (`conformance/runner.ts`, `npm run validate:examples`) without the `examples/` fixture corpus present now exits 1 instead of 0: a missing or empty `valid/`, `invalid/`, or `scenarios/` root fails the run rather than passing vacuously. The published package now ships the corpus, so the fix is to restore `examples/` in that environment, or to stop running the runner there.

## 0.7.1 — 2026-05-26

**Stricter conformance.** Tasks valid under 0.7.0 with `security_class=high` advanced past `automated-gates` without a security review are invalid under 0.7.1. This plugs a gap in v0.7.0 where the security-review state was modeled but the prose-driven orchestration didn't always honor the bookkeeping; the rule is now mechanical (see reference-impl 0.8.1's advance-status guard).

### Added
- `task.security_review_verdict` — optional field, enum `"pass" | "bounce" | "escalate" | null`, default `null`. Records the outcome of the most recent security-review run. Reuses the existing verdict enum. (from CLV-101)
- `security_gate: true` annotation on three state-machine transitions out of `automated-gates`: → `ui-review` (full_pipeline), → `qa` (full_pipeline), → `merged` (fast_lane). (from CLV-101)
- `resets_security_verdict: true` annotation on `review → automated-gates`. (from CLV-101)
- TypeScript `Task` interface extended with optional `security_class` and `security_review_verdict`; `StatusTransitions` transitions item type extended with optional `security_gate` and `resets_security_verdict`. (from CLV-101)
- `validators/security-gate.ts` — new validator. When a transition with `security_gate: true` is taken and the task's `security_class === "high"`, requires `security_review_verdict === "pass"`. Otherwise illegal.
- New conformance tests for the validator (2×4 matrix on flagged transitions + control on non-flagged) and a new fixture `task-security-high-verdict-pass.json`.
- Verdict-reset post-condition test on `review → automated-gates`.

### Migration
Consumers upgrading from 0.7.0 to 0.7.1 must ensure that any in-flight task with `security_class=high` has been through the `security-review` state with `security_review_verdict='pass'` before attempting to advance past `automated-gates` (to `ui-review`, `qa`, or `merged`). Tasks with `security_class=low` or `security_class` absent are unaffected. The `security_review_verdict` field is optional and defaults to `null`; legacy task documents without it continue to validate but will be refused on guarded transitions when `security_class=high`. To migrate: run the security-review skill on any blocked high-security task and write back `security_review_verdict='pass'` before retrying the advance.

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
