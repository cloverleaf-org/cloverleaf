import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeAjv } from '../../helpers/ajv-instance.js';
import { SCHEMA_LEVEL } from '../../level-map.js';
import { walkExamples } from './_helpers.js';

const STANDARD_ROOT = resolve(__dirname, '..', '..', '..');
const SCHEMA_BASE = 'https://cloverleaf.example/schemas/';

const ajv = makeAjv();

describe('L1 Producer conformance', () => {
  const validExamples = walkExamples(resolve(STANDARD_ROOT, 'examples', 'valid'));
  const invalidExamples = walkExamples(resolve(STANDARD_ROOT, 'examples', 'invalid'));

  it('every L1 valid example validates against its schema', () => {
    const l1Examples = validExamples.filter(
      (e) => SCHEMA_LEVEL[e.schemaName] === 'L1'
    );
    expect(l1Examples.length).toBeGreaterThan(0);
    for (const e of l1Examples) {
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

  it('every L1 invalid example is rejected by its schema', () => {
    const l1Examples = invalidExamples.filter(
      (e) => SCHEMA_LEVEL[e.schemaName] === 'L1'
    );
    expect(l1Examples.length).toBeGreaterThan(0);
    for (const e of l1Examples) {
      const validate = ajv.getSchema(`${SCHEMA_BASE}${e.schemaName}.schema.json`);
      expect(validate, `schema for ${e.schemaName} not registered`).toBeDefined();
      const doc = JSON.parse(readFileSync(e.jsonPath, 'utf-8'));
      expect(validate!(doc), `${e.jsonPath}: expected invalid, but validated`).toBe(false);
    }
  });

  it('every L1 sidecar declares L1 in its levels array', () => {
    for (const e of [...validExamples, ...invalidExamples]) {
      if (SCHEMA_LEVEL[e.schemaName] !== 'L1') continue;
      expect(e.sidecar, `missing sidecar for ${e.jsonPath}`).not.toBeNull();
      expect(e.sidecar!.levels).toContain('L1');
      expect(e.sidecar!.fixture_of).toBe(`${e.schemaName}.schema.json`);
    }
  });
});
