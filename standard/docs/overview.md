# Cloverleaf Interoperability Standard — Overview

This is the machine-readable specification of the Cloverleaf methodology. It exists so that any third-party tool — trackers, dashboards, agents, schedulers — can interoperate with any other Cloverleaf-conformant tool.

## What's specified

- **Work Item schemas** — RFC, Spike, Plan, Task, plus the abstract WorkItem parent.
- **Format schemas** — Dependency DAG, Risk Classifier rules, Path-rules, Extensions namespace.
- **Event schemas** — Status transitions and Gate decisions.
- **Agent contracts** — OpenAPI 3.1 specs for the seven Cloverleaf agents (Researcher, Plan, Implementer, Documenter, Reviewer, UI Reviewer, QA).

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

See `conformance.md` for how to validate.
