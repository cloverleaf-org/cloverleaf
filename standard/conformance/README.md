# Conformance pack

Validates that every artifact in this repo (schemas, examples, agent contracts) conforms to the Cloverleaf Interoperability Standard.

## How tests are organized
- `tests/` — one `.test.ts` per schema or per agent contract; each is a one-line invocation of a helper.
- `helpers/` — shared validators (Ajv, OpenAPI).
- `runner.ts` — CLI script for CI: validates every example in one shot (added in Task 21).

## Adding a new schema
1. Add `schemas/<name>.schema.json` with `"$id": "https://cloverleaf.example/schemas/<name>.schema.json"`.
2. Add positive examples under `examples/valid/<name>/<descriptor>.json` (e.g., `basic.json`). At least one required.
3. Add negative examples under `examples/invalid/<name>/<reason>.json` (e.g., `missing-id.json`). At least one required.
4. Add `tests/<name>.test.ts` containing `import { testSchema } from '../helpers/test-schema.js'; testSchema('<name>');`.
5. Run `npm test` — your new tests should be picked up automatically.

The per-schema subdirectory layout (rather than filename prefixes) prevents cross-schema fixture collisions.

## Adding a new agent contract
1. Add `agent-contracts/<agent>.openapi.yaml` (OpenAPI 3.1).
2. Add `tests/<agent>-contract.test.ts` containing `import { testOpenApi } from '../helpers/test-openapi.js'; testOpenApi('<agent>');`.

## .meta.json sidecar files

Every example fixture (`.json` file under `examples/valid/` or `examples/invalid/`) must have a companion `.meta.json` sidecar with the same base name. The sidecar tells the conformance runner which conformance level the fixture exercises and which schema it belongs to.

**Format:**

```json
{
  "levels": ["L1"],
  "fixture_of": "project.schema.json"
}
```

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `levels` | `string[]` | yes | One or more conformance levels this fixture exercises. Valid values: `"L1"`, `"L2"`, `"L3"`. Must include the level of the schema named in `fixture_of` (see `level-map.ts`). |
| `fixture_of` | `string` | yes | The schema file name (e.g. `"project.schema.json"`) this fixture is an example of. Must match the subdirectory name under `examples/valid/<name>/` or `examples/invalid/<name>/`. |

**Producer expectations (L1):** sidecars for L1 schemas (e.g. `project`, `rfc`, `task`, `plan`, `spike`, `work-item`) must set `"levels": ["L1"]` and `"fixture_of": "<schema-name>.schema.json"`.

**Exchange expectations (L2):** sidecars for L2 schemas (e.g. `feedback`, `status-transition-event`, `dependency-dag`) must include `"L2"` in `levels`.

**Host expectations (L3):** sidecars for L3 schemas (e.g. `gate-decision-event`, `extensions`, `path-rules`, `risk-classifier-rules`) must include `"L3"` in `levels`.

The by-level tests (`tests/by-level/l1.test.ts`, `l2.test.ts`, `l3.test.ts`) enforce these sidecar requirements — a missing or incorrect sidecar will fail the test suite.

## Runner `--level` flag

`runner.ts` is a standalone CLI script for CI that validates all examples, contracts, and scenarios in one shot. By default it runs the full suite. The `--level` flag restricts execution to a specific conformance tier.

**Usage:**

```bash
# Run the full conformance suite (all levels)
npx ts-node runner.ts

# Run only Level 1 (Producer) checks
npx ts-node runner.ts --level=1

# Run only Level 2 (Exchange) checks — includes all L1 and L2 artifacts
npx ts-node runner.ts --level=2

# Run only Level 3 (Host) checks — includes all L1, L2, and L3 artifacts
npx ts-node runner.ts --level=3
```

**Level semantics:**

| Flag | Tier | What is validated |
|------|------|-------------------|
| `--level=1` | Producer | L1 schemas (`project`, `rfc`, `task`, `plan`, `spike`, `work-item`) and the `id-pattern` validator |
| `--level=2` | Exchange | Everything in L1, plus L2 schemas (`feedback`, `status-transition-event`, `dependency-dag`, etc.) and L2 validators (`dag-acyclic`, `plan-tasks-match-dag`, `relationship-mirror`, `status-by-type`, `status-transition-legality`, `cross-project-ref`) |
| `--level=3` | Host | Everything in L1 and L2, plus L3 schemas (`gate-decision-event`, `extensions`, `path-rules`, `risk-classifier-rules`), all agent contracts, and the `gate-decision-validity` validator |
| `--level=all` (default) | All | Identical to `--level=3` — validates the full suite |

Levels are strict supersets: L2 includes all L1 checks, and L3 includes all L1 and L2 checks. The mapping of each schema, validator, contract, and scenario to its level is the single source of truth in `level-map.ts`.
