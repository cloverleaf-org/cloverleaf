import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeAjv } from '../helpers/ajv-instance.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE = resolve(__dirname, '..', 'fixtures', 'task-security-high.json');
const SCHEMA_ID = 'https://cloverleaf.example/schemas/task.schema.json';

describe('conformance/fixtures — task-security-high.json', () => {
  const ajv = makeAjv();
  const validate = ajv.getSchema(SCHEMA_ID);
  const doc = JSON.parse(readFileSync(FIXTURE, 'utf-8'));

  it('validates against task.schema.json', () => {
    expect(validate).toBeDefined();
    const ok = validate!(doc);
    expect(
      validate!.errors ?? null,
      `AJV errors: ${JSON.stringify(validate!.errors)}`
    ).toBeNull();
    expect(ok).toBe(true);
  });

  it('has security_class === "high"', () => {
    expect(doc.security_class).toBe('high');
  });

  it('has status === "security-review"', () => {
    expect(doc.status).toBe('security-review');
  });
});
