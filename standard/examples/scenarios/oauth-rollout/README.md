# Scenario: OAuth Rollout

End-to-end narrative exercising every schema and all 8 validators together.

**Story:** Project ACME proposes adding OAuth login. The RFC raises an account-merging question, which spawns a Spike. The Spike completes with a recommendation; the Plan & Task Breakdown emits two Tasks with a `blocks` relationship. Gate decisions and status transitions are captured as events. One reviewer bounce is shown with structured findings.

## Files

- `projects/ACME.json` — project config (default ID pattern)
- `rfcs/ACME-100.json` — the OAuth RFC
- `spikes/ACME-101.json` — completed Spike on account merging
- `plans/ACME-102.json` — the approved Plan with 2 Tasks and a DAG
- `tasks/ACME-200.json`, `tasks/ACME-201.json` — the Tasks (ACME-201 blocks ACME-200 inverse)
- `rules/risk-classifier.json` — ACME-specific classifier thresholds
- `rules/path-rules.json` — ACME-specific reviewer routing
- `events/evt-001-status.json` — ACME-200 pending → tactical-plan
- `events/evt-002-gate.json` — RFC+Strategy Gate approves ACME-100
- `events/evt-003-gate.json` — Task Batch Gate approves ACME-102
- `events/evt-004-status.json` — ACME-201 review → automated-gates
- `feedback/reviewer-bounce-ACME-200.json` — example reviewer bounce

## Invariants

- Every reference is a qualified `workItemRef`
- Every Work Item id matches `^ACME-\d+$`
- `ACME-102.task_dag` matches the `blocks`/`is_blocked_by` relationships on ACME-200/ACME-201
- Every status transition in `events/` is legal per the task state machine
- All 8 validators pass
