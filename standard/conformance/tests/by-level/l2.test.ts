import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeAjv } from '../../helpers/ajv-instance.js';
import { SCHEMA_LEVEL, STATE_MACHINE_LEVEL } from '../../level-map.js';
import { walkExamples } from './_helpers.js';

const STANDARD_ROOT = resolve(__dirname, '..', '..', '..');
const SCHEMA_BASE = 'https://cloverleaf.example/schemas/';

const ajv = makeAjv();

describe('L2 Exchange conformance', () => {
  const validExamples = walkExamples(resolve(STANDARD_ROOT, 'examples', 'valid'));
  const invalidExamples = walkExamples(resolve(STANDARD_ROOT, 'examples', 'invalid'));

  it('every L2 valid example validates against its schema', () => {
    const l2Examples = validExamples.filter(
      (e) => SCHEMA_LEVEL[e.schemaName] === 'L2'
    );
    expect(l2Examples.length).toBeGreaterThan(0);
    for (const e of l2Examples) {
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

  it('every L2 invalid example is rejected by its schema', () => {
    const l2Examples = invalidExamples.filter(
      (e) => SCHEMA_LEVEL[e.schemaName] === 'L2'
    );
    expect(l2Examples.length).toBeGreaterThan(0);
    for (const e of l2Examples) {
      const validate = ajv.getSchema(`${SCHEMA_BASE}${e.schemaName}.schema.json`);
      expect(validate, `schema for ${e.schemaName} not registered`).toBeDefined();
      const doc = JSON.parse(readFileSync(e.jsonPath, 'utf-8'));
      expect(validate!(doc), `${e.jsonPath}: expected invalid, but validated`).toBe(false);
    }
  });

  it('every L2 sidecar declares L2 in its levels array', () => {
    for (const e of [...validExamples, ...invalidExamples]) {
      if (SCHEMA_LEVEL[e.schemaName] !== 'L2') continue;
      expect(e.sidecar, `missing sidecar for ${e.jsonPath}`).not.toBeNull();
      expect(e.sidecar!.levels).toContain('L2');
      expect(e.sidecar!.fixture_of).toBe(`${e.schemaName}.schema.json`);
    }
  });

  it('every state machine file parses as JSON and is mapped to L2', () => {
    const smDir = resolve(STANDARD_ROOT, 'state-machines');
    const smFiles = readdirSync(smDir).filter((f) => f.endsWith('.json'));
    expect(smFiles.length).toBeGreaterThan(0);
    for (const f of smFiles) {
      const name = f.replace(/\.json$/, '');
      expect(STATE_MACHINE_LEVEL[name]).toBe('L2');
      const parsed = JSON.parse(readFileSync(resolve(smDir, f), 'utf-8'));
      expect(parsed).toBeDefined();
    }
  });
});
