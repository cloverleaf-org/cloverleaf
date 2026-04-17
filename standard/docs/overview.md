# Cloverleaf Interoperability Standard — Overview

Machine-readable specification of the Cloverleaf methodology. Exists so any third-party tool — trackers, dashboards, agents, schedulers — can interoperate with any other Cloverleaf-conformant tool.

## What's specified

- **Project configuration** — `project.schema.json` declares project key, name, and ID pattern.
- **Work Item schemas** — RFC, Spike, Plan, Task, plus the abstract WorkItem parent. Every Work Item carries a required `project` key.
- **Format schemas** — Dependency DAG, Risk Classifier rules, Path-rules, Extensions namespace.
- **Event schemas** — Status transitions and Gate decisions.
- **Error envelope** — RFC 7807 Problem Details with Cloverleaf extensions (`problem.schema.json`).
- **Feedback envelope** — shared verdict + finding + feedback primitives (`feedback.schema.json`).
- **Status machines** — canonical state machines for each Work Item type (`state-machines/`).
- **Agent contracts** — OpenAPI 3.1 specs for the seven Cloverleaf agents.
- **Reference validators** — eight runtime invariant validators (`validators/`) with language-agnostic algorithm docs (`docs/validators.md`).

## What's NOT specified

- Storage / persistence — implementations choose their own.
- Wire transport for events — implementations may use HTTP webhooks, message queues, etc.
- Authentication / authorization — implementations choose.
- The methodology itself — see `../../docs/superpowers/specs/2026-04-16-cloverleaf-design.md`.

## Conformance

A tool is **Cloverleaf-conformant** if it:
1. Produces and accepts Work Items, events, and rule documents that validate against the schemas.
2. Implements the agent contracts it claims to implement (request/response shape matches).
3. Honors the extensions namespace convention (forward-compatible: ignore unknown keys).
4. Produces documents and emits events that satisfy all reference invariants for its scope.

See `conformance.md` for how to validate.
