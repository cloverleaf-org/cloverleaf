# Versioning Policy

The Standard follows [semver](https://semver.org/).

- **MAJOR** — breaking changes to mandatory schema fields, removal of contracts, or incompatible event-shape changes.
- **MINOR** — additive changes: new optional fields, new agent contracts, new event types, new schemas.
- **PATCH** — clarifications, doc-only changes, fixes to examples.

The current version lives in `VERSION` at the repo root.

## Stability tiers

| Tier | Examples | Stability guarantee |
|---|---|---|
| Mandatory fields | `id`, `type`, `status`, `owner`, `definition_of_done`, `acceptance_criteria` | No breaking changes within a MAJOR version. |
| Optional fields | `extensions`, `dependencies`, `parent` | May add fields; will not remove or repurpose within a MAJOR. |
| Contracts | OpenAPI specs | New endpoints may be added in MINOR; existing endpoint shapes stable within MAJOR. |
| Examples | Documents under `examples/` | May change in PATCH; not part of the contract. |

## Pre-1.0

While the Standard is under `0.x.y`, breaking changes may occur in MINOR releases. From `1.0.0` onward, full semver guarantees apply.
