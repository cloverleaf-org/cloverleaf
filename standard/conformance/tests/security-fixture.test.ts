import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeAjv } from '../helpers/ajv-instance.js';
import { validateSecurityGate } from '../../validators/security-gate.js';
import type { StatusTransitionEvent, StatusTransitions, Task } from '../../validators/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE = resolve(__dirname, '..', 'fixtures', 'task-security-high.json');
const FIXTURE_PASS = resolve(__dirname, '..', 'fixtures', 'task-security-high-verdict-pass.json');
const SCHEMA_ID = 'https://cloverleaf.example/schemas/task.schema.json';

const taskMachine = JSON.parse(
  readFileSync(resolve(__dirname, '..', '..', 'state-machines', 'task.json'), 'utf-8')
) as StatusTransitions;

// ────────────────────────────────────────────────────────────────────────────
// Original fixture: task-security-high.json

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

// ────────────────────────────────────────────────────────────────────────────
// New fixture: task-security-high-verdict-pass.json

describe('conformance/fixtures — task-security-high-verdict-pass.json', () => {
  const ajv = makeAjv();
  const validate = ajv.getSchema(SCHEMA_ID);
  const doc = JSON.parse(readFileSync(FIXTURE_PASS, 'utf-8'));

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

  it('has security_review_verdict === "pass"', () => {
    expect(doc.security_review_verdict).toBe('pass');
  });

  it('has a distinct id from task-security-high.json (CLV-901)', () => {
    const base = JSON.parse(readFileSync(FIXTURE, 'utf-8'));
    expect(doc.id).not.toBe(base.id);
    expect(doc.id).toBe('CLV-901');
  });

  it('allows security-gated transition (automated-gates → qa) when verdict is pass', () => {
    const task = doc as Task;
    const event: StatusTransitionEvent = {
      event_id: 'e-sf-1',
      event_type: 'status_transition',
      occurred_at: '2026-05-26T10:00:00Z',
      work_item_id: { project: doc.project, id: doc.id },
      work_item_type: 'task',
      from_status: 'automated-gates',
      to_status: 'qa',
      actor: { kind: 'agent', id: 'orchestrator' }
    };
    const result = validateSecurityGate(event, taskMachine, task);
    expect(result.ok).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Verdict-reset post-condition: review → automated-gates resets the verdict to null
//
// The state-machine annotates `review → automated-gates` with
// `resets_security_verdict: true`. This test verifies the post-condition:
// a task that has just been advanced via that edge must behave as if its
// security_review_verdict is null — i.e. the security gate refuses the next
// guarded advance.

describe('verdict-reset post-condition (review → automated-gates)', () => {
  it('resets_security_verdict annotation is present on review → automated-gates', () => {
    const resetTransition = taskMachine.transitions.find(
      (t) => t.from === 'review' && t.to === 'automated-gates'
    );
    expect(resetTransition).toBeDefined();
    expect(resetTransition!.resets_security_verdict).toBe(true);
  });

  it('a high-security task in automated-gates with verdict=null (post-reset) is blocked on guarded transitions', () => {
    // Simulates a task that previously had verdict="pass", advanced past the
    // gate, was bounced back through review, and the reset fired (verdict → null).
    const taskAfterReset: Task = {
      id: 'CLV-999',
      type: 'task',
      status: 'automated-gates',
      project: 'CLV',
      context: { rfc: { project: 'CLV', id: 'CLV-1' } },
      definition_of_done: ['x'],
      acceptance_criteria: ['y'],
      risk_class: 'low',
      security_class: 'high',
      security_review_verdict: null  // reset has fired
    };

    const event: StatusTransitionEvent = {
      event_id: 'e-sf-2',
      event_type: 'status_transition',
      occurred_at: '2026-05-26T10:00:00Z',
      work_item_id: { project: 'CLV', id: 'CLV-999' },
      work_item_type: 'task',
      from_status: 'automated-gates',
      to_status: 'qa',
      actor: { kind: 'agent', id: 'orchestrator' }
    };

    const result = validateSecurityGate(event, taskMachine, taskAfterReset);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations[0].rule).toBe('security-gate');
      expect(result.violations[0].message).toMatch(/Advance to security-review first/);
    }
  });

  it('a high-security task with verdict=pass (pre-reset) is allowed on guarded transitions', () => {
    // Simulates a task whose security_review_verdict is still "pass" (not yet reset).
    const taskPreReset: Task = {
      id: 'CLV-999',
      type: 'task',
      status: 'automated-gates',
      project: 'CLV',
      context: { rfc: { project: 'CLV', id: 'CLV-1' } },
      definition_of_done: ['x'],
      acceptance_criteria: ['y'],
      risk_class: 'low',
      security_class: 'high',
      security_review_verdict: 'pass'
    };

    const event: StatusTransitionEvent = {
      event_id: 'e-sf-3',
      event_type: 'status_transition',
      occurred_at: '2026-05-26T10:00:00Z',
      work_item_id: { project: 'CLV', id: 'CLV-999' },
      work_item_type: 'task',
      from_status: 'automated-gates',
      to_status: 'qa',
      actor: { kind: 'agent', id: 'orchestrator' }
    };

    const result = validateSecurityGate(event, taskMachine, taskPreReset);
    expect(result.ok).toBe(true);
  });
});
