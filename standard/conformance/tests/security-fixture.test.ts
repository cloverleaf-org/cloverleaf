import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIX = (name: string) => JSON.parse(readFileSync(resolve(__dirname, '..', 'fixtures', name), 'utf-8'));

describe('security fixtures (0.8.0 collapsed FSM)', () => {
  it('task-security-high.json is a high-security task in the council phase', () => {
    const doc = FIX('task-security-high.json');
    expect(doc.type).toBe('task');
    expect(doc.status).toBe('council');
    expect(doc.security_class).toBe('high');
  });

  it('task-security-high-verdict-pass.json is a high task at final-gate with verdict pass', () => {
    const doc = FIX('task-security-high-verdict-pass.json');
    expect(doc.status).toBe('final-gate');
    expect(doc.security_class).toBe('high');
    expect(doc.security_review_verdict).toBe('pass');
  });
});
