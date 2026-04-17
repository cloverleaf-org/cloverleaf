# Cloverleaf Interoperability Standard

Machine-readable specification of the Cloverleaf methodology (see `../docs/superpowers/specs/2026-04-16-cloverleaf-design.md` for v0.1 methodology and `../docs/superpowers/specs/2026-04-17-cloverleaf-standard-v0.2-design.md` for the v0.2 standard).

## Layout
- `schemas/` — JSON Schemas for Work Items, events, rule formats, problem, feedback, status-transitions
- `agent-contracts/` — OpenAPI 3.1 specs for the seven Cloverleaf agents
- `state-machines/` — Canonical status transition graphs for each Work Item type
- `validators/` — TypeScript reference implementations for runtime invariants
- `examples/{valid,invalid}/` — Per-schema positive and negative example documents
- `examples/scenarios/` — End-to-end scenarios exercising all schemas together
- `conformance/` — Test pack + CI runner
- `docs/` — Overview, versioning, extensions, conformance, validators

## Quick start

```bash
npm install
npm test                       # unit-level schema + validator tests
npm run validate:examples      # CI-style runner: schemas + contracts + scenarios + validators
```

## Version

Current: see `VERSION`. See `docs/versioning.md` for stability policy. Pre-1.0 MINOR releases may include breaking changes.
