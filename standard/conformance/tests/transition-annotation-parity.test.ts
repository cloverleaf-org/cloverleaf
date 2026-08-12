import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
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

/**
 * The transition annotation surface is declared in TWO places that must agree:
 * `validators/types.ts` (the TS type consumers program against) and
 * `schemas/status-transitions.schema.json` (what validation actually enforces).
 * They drifted: `security_gate` was declared in the type, enforced by a shipped
 * validator, promised in three docs — and absent from the schema, whose
 * transition object sets `additionalProperties: false`. Nothing caught it because
 * nothing schema-validates the shipped machines and no fixture exercised the
 * annotation. These assertions make the next divergence fail in either direction.
 */
const TS_ANCHOR = 'transitions: Array<{';

function tsTransitionFields(): string[] {
  const src = readFileSync(join(ROOT, 'validators', 'types.ts'), 'utf-8');
  const start = src.indexOf(TS_ANCHOR);
  if (start === -1) return [];
  const block = src.slice(start + TS_ANCHOR.length, src.indexOf('}>;', start));
  return [...block.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]);
}

function schemaTransitionItem(): { properties: Record<string, unknown>; additionalProperties: unknown } {
  const schema = JSON.parse(
    readFileSync(join(ROOT, 'schemas', 'status-transitions.schema.json'), 'utf-8'),
  );
  return schema.properties.transitions.items;
}

describe('the transition type and the transition schema declare the same fields', () => {
  const tsFields = tsTransitionFields();

  it('extracts a non-empty field list from the TypeScript type', () => {
    // The extraction is textual because TS types have no runtime representation.
    // A regex that silently matched nothing would read exactly like a pass.
    expect(tsFields.length).toBeGreaterThanOrEqual(5);
  });

  it('declares the same field names on both sides', () => {
    const schemaProps = Object.keys(schemaTransitionItem().properties);
    expect([...tsFields].sort()).toEqual([...schemaProps].sort());
  });

  it('keeps additionalProperties:false on the transition object', () => {
    // This is what turns "not declared" into "not accepted". Without it a
    // divergence is silently tolerated instead of rejected, and the whole
    // bug class becomes invisible again.
    expect(schemaTransitionItem().additionalProperties).toBe(false);
  });

  it('validates every shipped state machine against the schema', () => {
    // Nothing else in the repo does this: l2.test.ts only parses the machines and
    // checks their level mapping, and the runner loads them only to feed the
    // legality validator. That gap is how a schema/type divergence went unnoticed.
    const validate = makeAjv().getSchema(SCHEMA_ID);
    const dir = join(ROOT, 'state-machines');
    const machines = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(machines.length).toBeGreaterThanOrEqual(4);
    for (const f of machines) {
      const doc = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
      expect(validate!(doc), `${f}: ${JSON.stringify(validate!.errors)}`).toBe(true);
    }
  });
});
