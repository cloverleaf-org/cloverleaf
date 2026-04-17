import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeAjv } from './ajv-instance.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const VALID = resolve(__dirname, '..', '..', 'examples', 'valid');
const INVALID = resolve(__dirname, '..', '..', 'examples', 'invalid');
const SCHEMA_BASE = 'https://cloverleaf.example/schemas/';

/**
 * Run conformance tests for a given schema name.
 * - Loads `${name}.schema.json` by `$id` from the shared Ajv instance.
 * - Validates every `*.json` file under `examples/valid/${name}/`.
 * - Validates every `*.json` file under `examples/invalid/${name}/` (must reject).
 */
export function testSchema(name: string): void {
  describe(`${name} schema`, () => {
    const ajv = makeAjv();
    const validate = ajv.getSchema(`${SCHEMA_BASE}${name}.schema.json`);
    if (!validate) {
      throw new Error(`Schema not registered: ${SCHEMA_BASE}${name}.schema.json`);
    }

    const fixtureFiles = (root: string): string[] => {
      const dir = resolve(root, name);
      return existsSync(dir)
        ? readdirSync(dir).filter((f) => f.endsWith('.json'))
        : [];
    };

    for (const f of fixtureFiles(VALID)) {
      it(`accepts valid/${name}/${f}`, () => {
        const doc = JSON.parse(readFileSync(resolve(VALID, name, f), 'utf-8'));
        const ok = validate(doc);
        expect(validate.errors ?? null).toBeNull();
        expect(ok).toBe(true);
      });
    }

    for (const f of fixtureFiles(INVALID)) {
      it(`rejects invalid/${name}/${f}`, () => {
        const doc = JSON.parse(readFileSync(resolve(INVALID, name, f), 'utf-8'));
        const ok = validate(doc);
        expect(ok).toBe(false);
      });
    }
  });
}
