# Conformance pack

Validates that every artifact in this repo (schemas, examples, agent contracts) conforms to the Cloverleaf Interoperability Standard.

## How tests are organized
- `tests/` — one `.test.ts` per schema or per agent contract; each is a one-line invocation of a helper.
- `helpers/` — shared validators (Ajv, OpenAPI).
- `runner.ts` — CLI script for CI: validates every example in one shot (added in Task 21).

## Adding a new schema
1. Add `schemas/<name>.schema.json` with `"$id": "https://cloverleaf.dev/schemas/<name>.schema.json"`.
2. Add positive examples under `examples/valid/<name>/<descriptor>.json` (e.g., `basic.json`). At least one required.
3. Add negative examples under `examples/invalid/<name>/<reason>.json` (e.g., `missing-id.json`). At least one required.
4. Add `tests/<name>.test.ts` containing `import { testSchema } from '../helpers/test-schema.js'; testSchema('<name>');`.
5. Run `npm test` — your new tests should be picked up automatically.

The per-schema subdirectory layout (rather than filename prefixes) prevents cross-schema fixture collisions.

## Adding a new agent contract
1. Add `agent-contracts/<agent>.openapi.yaml` (OpenAPI 3.1).
2. Add `tests/<agent>-contract.test.ts` containing `import { testOpenApi } from '../helpers/test-openapi.js'; testOpenApi('<agent>');`.
