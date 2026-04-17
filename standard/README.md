# Cloverleaf Interoperability Standard

Machine-readable specification of the Cloverleaf methodology (see `../docs/superpowers/specs/2026-04-16-cloverleaf-design.md`).

## Layout
- `schemas/` — JSON Schemas for Work Items, events, and rule formats
- `agent-contracts/` — OpenAPI 3.1 specs for the seven Cloverleaf agents
- `examples/{valid,invalid}/` — Positive and negative example documents
- `conformance/` — Test pack to validate any tool's adherence to the standard
- `docs/` — Overview, versioning policy, extension guide, conformance guide

## Quick start

```bash
npm install
npm test
```

## Versioning

Standard follows semver. Current: see `VERSION`. See `docs/versioning.md` for stability policy.
