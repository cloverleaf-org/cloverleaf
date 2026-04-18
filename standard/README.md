# Cloverleaf Interoperability Standard

Machine-readable specification of the Cloverleaf methodology: JSON Schemas for Work Items, OpenAPI contracts for the seven agents, canonical state machines, reference validators, and a conformance test pack.

## Install

```bash
npm install @cloverleaf/standard
```

## Layout

- `schemas/` — JSON Schemas for Work Items, events, rule formats, problem, feedback, status-transitions.
- `agent-contracts/` — OpenAPI 3.1 specs for the seven Cloverleaf agents.
- `state-machines/` — Canonical status transition graphs for each Work Item type.
- `validators/` — TypeScript reference implementations for runtime invariants.
- `examples/{valid,invalid}/` — Per-schema positive and negative example documents with `.meta.json` sidecars declaring conformance level.
- `examples/scenarios/` — End-to-end scenarios exercising all schemas together.
- `conformance/` — Conformance runner, per-level test suites, and level map.
- `docs/` — Overview, versioning, conformance levels, extensions, validators.

## Quick start

```bash
npm install
npm test                                  # unit-level schema + validator tests
npm run validate:examples                 # full conformance runner (L3, default)
npm run validate:examples -- --level=1    # L1 (Producer) suite
npm run validate:examples -- --level=2    # L2 (Exchange) suite
npm run validate:examples -- --level=3    # L3 (Host) suite
```

## Conformance

The Standard defines three levels:

| Level | Role | Description |
|---|---|---|
| **L1 Producer** | Emits valid Cloverleaf documents | Core Work Item schemas + `id-pattern` validator. |
| **L2 Exchange** | L1 + workflow events, DAGs, feedback roundtrip | Adds event/feedback schemas, state machines, and 6 more validators. |
| **L3 Host** | L2 + full methodology orchestration | Adds agent contracts, gate decisions, path/risk rules. |

See [`docs/conformance.md`](./docs/conformance.md) for the full level partition, how to declare a level, and how to add new artifacts.

## Version

Current: see [`VERSION`](./VERSION). See [`docs/versioning.md`](./docs/versioning.md) for the stability policy. Pre-1.0 MINOR releases may include breaking changes.
