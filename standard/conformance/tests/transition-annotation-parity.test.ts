import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { makeAjv } from '../helpers/ajv-instance.js';

const ROOT = resolve(__dirname, '..', '..');
const SCHEMA_ID = 'https://cloverleaf.example/schemas/status-transitions.schema.json';

/** A minimal, otherwise-valid consumer machine carrying one annotation. */
function machineWith(annotation: Record<string, unknown>): unknown {
  return {
    type: 'task',
    states: { initial: ['council'], terminal: ['merged'], all: ['council', 'merged'] },
    transitions: [{ from: 'council', to: 'merged', allowed_actors: ['human'], ...annotation }],
  };
}

describe('the security_gate transition annotation is reachable through the schema', () => {
  const validate = makeAjv().getSchema(SCHEMA_ID);

  it('registers the status-transitions schema', () => {
    // A missing schema would make every assertion below vacuously skip.
    expect(validate).toBeDefined();
  });

  it('accepts a consumer machine that annotates security_gate', () => {
    // CHANGELOG.md:14, README.md:15 and docs/validators.md:187 all promise a consumer FSM
    // may annotate its own transitions with security_gate, and validators/security-gate.ts
    // enforces it. The transition object sets additionalProperties:false, so until the
    // property is declared the promise is unreachable.
    expect(validate!(machineWith({ security_gate: true }))).toBe(true);
  });

  it('rejects a consumer machine that annotates resets_security_verdict', () => {
    // Deliberately NOT declared: nothing in either package reads it, and
    // docs/validators.md records that the validator does not enforce the reset.
    // Declaring it would publish spec surface nothing implements.
    expect(validate!(machineWith({ resets_security_verdict: true }))).toBe(false);
  });

  it('still rejects an undeclared annotation', () => {
    // Proves the two results above are caused by what is declared, not by a
    // weakened additionalProperties.
    expect(validate!(machineWith({ not_a_real_annotation: true }))).toBe(false);
  });
});
