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

## Conformance levels and SemVer

Conformance levels (L1 Producer, L2 Exchange, L3 Host — see `conformance.md`) interact with SemVer as follows. Within a major version:

- **Adding** a new schema, validator, agent contract, or state machine to an existing level is a **MINOR** bump. New artifacts are additive; existing implementers are unaffected.
- **Moving** a requirement from a higher level to a lower level (tightening) is a **MAJOR** bump. It breaks implementers who previously passed the lower level without implementing the moved requirement.
- **Moving** a requirement from a lower level to a higher level (relaxing) is a **MINOR** bump. It relaxes the entry barrier for the lower level without removing capability from higher levels.
- **Removing** an artifact from the standard is a **MAJOR** bump regardless of level.

Pre-1.0 (`0.x.y`) releases may include breaking changes at any tier, per the overall pre-1.0 policy stated above.
