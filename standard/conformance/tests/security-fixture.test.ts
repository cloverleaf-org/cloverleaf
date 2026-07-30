import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeAjv } from '../helpers/ajv-instance.js';

const FIX = (name: string) => JSON.parse(readFileSync(resolve(__dirname, '..', 'fixtures', name), 'utf-8'));

// This file is the dedicated schema-validation home for single-task security fixtures.
// scope-fixtures.test.ts only validates fixtures that contain a `tasks` array and
// explicitly skips single-task fixtures like these.
describe('security fixtures (0.8.0 collapsed FSM)', () => {
  it('task-security-high.json is a high-security task in the council phase', () => {
    const doc = FIX('task-security-high.json');
    const validate = makeAjv().getSchema('https://cloverleaf.example/schemas/task.schema.json');
    if (!validate) throw new Error('task.schema.json not found in AJV instance');
    expect(validate(doc)).toBe(true);
    expect(doc.type).toBe('task');
    expect(doc.status).toBe('council');
    expect(doc.security_class).toBe('high');
  });

  it('task-security-high-verdict-pass.json is a high task at final-gate with verdict pass', () => {
    const doc = FIX('task-security-high-verdict-pass.json');
    const validate = makeAjv().getSchema('https://cloverleaf.example/schemas/task.schema.json');
    if (!validate) throw new Error('task.schema.json not found in AJV instance');
    expect(validate(doc)).toBe(true);
    expect(doc.status).toBe('final-gate');
    expect(doc.security_class).toBe('high');
    expect(doc.security_review_verdict).toBe('pass');
  });
});
