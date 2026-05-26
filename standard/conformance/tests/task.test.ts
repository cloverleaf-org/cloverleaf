import { describe, it, expect } from 'vitest';
import { testSchema } from '../helpers/test-schema.js';
import { makeAjv } from '../helpers/ajv-instance.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

testSchema('task');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const VALID_DIR = resolve(__dirname, '..', '..', 'examples', 'valid', 'task');
const SCHEMA_ID = 'https://cloverleaf.example/schemas/task.schema.json';

describe('task schema — security_review_verdict field', () => {
  const ajv = makeAjv();
  const validate = ajv.getSchema(SCHEMA_ID)!;

  // Base fixture to use for field-level tests
  const base = JSON.parse(readFileSync(resolve(VALID_DIR, 'basic.json'), 'utf-8'));

  it('accepts security_review_verdict="pass"', () => {
    const doc = { ...base, security_review_verdict: 'pass' };
    expect(validate(doc)).toBe(true);
    expect(validate.errors ?? null).toBeNull();
  });

  it('accepts security_review_verdict="bounce"', () => {
    const doc = { ...base, security_review_verdict: 'bounce' };
    expect(validate(doc)).toBe(true);
    expect(validate.errors ?? null).toBeNull();
  });

  it('accepts security_review_verdict="escalate"', () => {
    const doc = { ...base, security_review_verdict: 'escalate' };
    expect(validate(doc)).toBe(true);
    expect(validate.errors ?? null).toBeNull();
  });

  it('accepts security_review_verdict=null', () => {
    const doc = { ...base, security_review_verdict: null };
    expect(validate(doc)).toBe(true);
    expect(validate.errors ?? null).toBeNull();
  });

  it('accepts task with security_review_verdict absent (field is optional)', () => {
    // base has no security_review_verdict — must be valid
    const doc = { ...base };
    delete doc.security_review_verdict;
    expect(validate(doc)).toBe(true);
    expect(validate.errors ?? null).toBeNull();
  });

  it('rejects security_review_verdict="approved" (not in enum)', () => {
    const doc = { ...base, security_review_verdict: 'approved' };
    expect(validate(doc)).toBe(false);
  });
});
