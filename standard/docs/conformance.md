# Conformance Guide

How to validate that your tool conforms to the Cloverleaf Interoperability Standard.

## Validating documents (schemas)

Use any JSON Schema 2020-12 validator. The reference harness uses `ajv`:

```typescript
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from '@cloverleaf/standard/schemas/rfc.schema.json';

const ajv = new Ajv({ strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

if (!validate(myRfcDocument)) {
  console.error(validate.errors);
}
```

## Validating agent contracts

Agent contracts are OpenAPI 3.1. Use any compliant tool (e.g., `@apidevtools/swagger-parser`).

## Validating runtime invariants (validators)

Eight invariants cannot be expressed in JSON Schema alone. Use the reference TypeScript validators or implement equivalents per `docs/validators.md`:

```typescript
import { validateDagAcyclic, validatePlanTasksMatchDag } from '@cloverleaf/standard/validators';

const result = validateDagAcyclic(plan.task_dag);
if (!result.ok) {
  console.error(result.violations);
}
```

## Running the full conformance pack

```bash
git clone <this repo>
cd cloverleaf/standard
npm install
npm test                          # vitest test suite (schemas + contracts + validators)
npm run validate:examples         # CLI runner: all examples + all contracts + all scenarios + all validators
```

## What "conformant" means

A tool is conformant if:
1. Every Work Item document it produces validates against the corresponding schema.
2. Every event document it emits validates against the corresponding event schema.
3. Every agent contract it implements matches the request/response shapes in the OpenAPI file.
4. It honors the extensions namespace convention.
5. It satisfies the eight runtime invariants (see `docs/validators.md`).

There is no certification body. Conformance is self-attested and verifiable against this repo's conformance pack.
