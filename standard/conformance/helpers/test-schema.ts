import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeAjv } from './ajv-instance.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const VALID = resolve(__dirname, '..', '..', 'examples', 'valid');
const INVALID = resolve(__dirname, '..', '..', 'examples', 'invalid');
const SCHEMA_BASE = 'https://cloverleaf.dev/schemas/';

/**
 * Run conformance tests for a given schema name.
 * - Loads `${name}.schema.json` by `$id` from the shared Ajv instance.
 * - Validates every file in `examples/valid/` whose basename starts with `${name}-` or equals `${name}.json`.
 * - Validates every file in `examples/invalid/` whose basename starts with `${name}-`.
 */
export function testSchema(name: string): void {
  describe(`${name} schema`, () => {
    const ajv = makeAjv();
    const validate = ajv.getSchema(`${SCHEMA_BASE}${name}.schema.json`);
    if (!validate) {
      throw new Error(`Schema not registered: ${SCHEMA_BASE}${name}.schema.json`);
    }

    const matches = (dir: string) =>
      existsSync(dir)
        ? readdirSync(dir).filter((f) => f === `${name}.json` || f.startsWith(`${name}-`))
        : [];

    for (const f of matches(VALID)) {
      it(`accepts valid/${f}`, () => {
        const doc = JSON.parse(readFileSync(resolve(VALID, f), 'utf-8'));
        const ok = validate(doc);
        expect(validate.errors ?? null).toBeNull();
        expect(ok).toBe(true);
      });
    }

    for (const f of matches(INVALID)) {
      it(`rejects invalid/${f}`, () => {
        const doc = JSON.parse(readFileSync(resolve(INVALID, f), 'utf-8'));
        const ok = validate(doc);
        expect(ok).toBe(false);
      });
    }
  });
}
