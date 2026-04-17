# Conformance pack

Validates that every artifact in this repo (schemas, examples, agent contracts) conforms to the Cloverleaf Interoperability Standard.

## How tests are organized
- `tests/` — one `.test.ts` per schema or per agent contract; each is a one-line invocation of a helper.
- `helpers/` — shared validators (Ajv, OpenAPI).
- `runner.ts` — CLI script for CI: validates every example in one shot.

## Adding a new schema
1. Add `schemas/<name>.schema.json` with `"$id": "https://cloverleaf.dev/schemas/<name>.schema.json"`.
2. Add at least one positive example to `examples/valid/<name>.json` (or `<name>-*.json`).
3. Add at least one negative example to `examples/invalid/<name>-<reason>.json`.
4. Add `tests/<name>.test.ts` containing `import { testSchema } from '../helpers/test-schema.js'; testSchema('<name>');`.
5. Run `npm test` — your new tests should be picked up automatically.

## Adding a new agent contract
1. Add `agent-contracts/<agent>.openapi.yaml` (OpenAPI 3.1).
2. Add `tests/<agent>-contract.test.ts` containing `import { testOpenApi } from '../helpers/test-openapi.js'; testOpenApi('<agent>');`.
