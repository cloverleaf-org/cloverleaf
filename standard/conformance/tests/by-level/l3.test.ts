import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import SwaggerParser from '@apidevtools/swagger-parser';
import { makeAjv } from '../../helpers/ajv-instance.js';
import { SCHEMA_LEVEL, CONTRACT_LEVEL } from '../../level-map.js';
import { walkExamples } from './_helpers.js';

const STANDARD_ROOT = resolve(__dirname, '..', '..', '..');
const SCHEMA_BASE = 'https://cloverleaf.example/schemas/';

const ajv = makeAjv();

describe('L3 Host conformance', () => {
  const validExamples = walkExamples(resolve(STANDARD_ROOT, 'examples', 'valid'));
  const invalidExamples = walkExamples(resolve(STANDARD_ROOT, 'examples', 'invalid'));

  it('every L3 valid example validates against its schema', () => {
    const l3Examples = validExamples.filter(
      (e) => SCHEMA_LEVEL[e.schemaName] === 'L3'
    );
    expect(l3Examples.length).toBeGreaterThan(0);
    for (const e of l3Examples) {
      const validate = ajv.getSchema(`${SCHEMA_BASE}${e.schemaName}.schema.json`);
      expect(validate, `schema for ${e.schemaName} not registered`).toBeDefined();
      const doc = JSON.parse(readFileSync(e.jsonPath, 'utf-8'));
      const passed = validate!(doc);
      expect(
        passed,
        `${e.jsonPath}: expected valid, errors: ${JSON.stringify(validate!.errors)}`
      ).toBe(true);
    }
  });

  it('every L3 invalid example is rejected by its schema', () => {
    const l3Examples = invalidExamples.filter(
      (e) => SCHEMA_LEVEL[e.schemaName] === 'L3'
    );
    expect(l3Examples.length).toBeGreaterThan(0);
    for (const e of l3Examples) {
      const validate = ajv.getSchema(`${SCHEMA_BASE}${e.schemaName}.schema.json`);
      expect(validate, `schema for ${e.schemaName} not registered`).toBeDefined();
      const doc = JSON.parse(readFileSync(e.jsonPath, 'utf-8'));
      expect(validate!(doc), `${e.jsonPath}: expected invalid, but validated`).toBe(false);
    }
  });

  it('every L3 sidecar declares L3 in its levels array', () => {
    for (const e of [...validExamples, ...invalidExamples]) {
      if (SCHEMA_LEVEL[e.schemaName] !== 'L3') continue;
      expect(e.sidecar, `missing sidecar for ${e.jsonPath}`).not.toBeNull();
      expect(e.sidecar!.levels).toContain('L3');
      expect(e.sidecar!.fixture_of).toBe(`${e.schemaName}.schema.json`);
    }
  });

  it('every agent contract dereferences as valid OpenAPI 3.1', async () => {
    const contractsDir = resolve(STANDARD_ROOT, 'agent-contracts');
    const files = readdirSync(contractsDir).filter((f) => f.endsWith('.openapi.yaml'));
    expect(files.length).toBe(7);
    for (const f of files) {
      const name = f.replace(/\.openapi\.yaml$/, '');
      expect(CONTRACT_LEVEL[name]).toBe('L3');
      const api = (await SwaggerParser.validate(resolve(contractsDir, f), {
        resolve: { external: false },
      })) as { openapi?: string };
      expect(api.openapi).toBeDefined();
      expect(api.openapi!.startsWith('3.1.')).toBe(true);
    }
  });
});
