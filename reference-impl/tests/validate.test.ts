import { describe, it, expect } from 'vitest';
import { validateOrThrow } from '../lib/validate.js';

const TASK_SCHEMA = 'https://cloverleaf.example/schemas/task.schema.json';
const FEEDBACK_SCHEMA = 'https://cloverleaf.example/schemas/feedback.schema.json';
const STATUS_EVENT_SCHEMA = 'https://cloverleaf.example/schemas/status-transition-event.schema.json';
const GATE_EVENT_SCHEMA = 'https://cloverleaf.example/schemas/gate-decision-event.schema.json';

function validTask() {
  return {
    id: 'T-001', type: 'task', status: 'pending',
    owner: { kind: 'agent', id: 'u' }, project: 'T', title: 't',
    context: { rfc: { project: 'T', id: 'T-RFC-001' } },
    acceptance_criteria: ['a'], definition_of_done: ['b'], risk_class: 'low',
  };
}

describe('validateOrThrow', () => {
  it('passes a valid task', () => {
    expect(() => validateOrThrow(TASK_SCHEMA, validTask())).not.toThrow();
  });

  it('throws on an invalid task (missing required field)', () => {
    const bad = validTask();
    delete (bad as Record<string, unknown>).title;
    expect(() => validateOrThrow(TASK_SCHEMA, bad)).toThrow(/schema/i);
  });

  it('throws on invalid feedback (wrong severity)', () => {
    const bad = { verdict: 'bounce', summary: 's', findings: [{ severity: 'major', message: 'm' }] };
    expect(() => validateOrThrow(FEEDBACK_SCHEMA, bad)).toThrow();
  });

  it('throws on invalid status event (missing from_status)', () => {
    const bad = {
      event_id: 'x', event_type: 'status_transition', occurred_at: '2026-04-20T00:00:00Z',
      work_item_id: { project: 'T', id: 'T-001' }, work_item_type: 'task',
      to_status: 'tactical-plan', actor: { kind: 'agent', id: 'u' },
    };
    expect(() => validateOrThrow(STATUS_EVENT_SCHEMA, bad)).toThrow();
  });

  it('throws on invalid gate event (wrong decision)', () => {
    const bad = {
      event_id: 'x', event_type: 'gate_decision', occurred_at: '2026-04-20T00:00:00Z',
      gate: 'human_merge', work_item_id: { project: 'T', id: 'T-001' },
      decision: 'approved', approver: { kind: 'human', id: 'u' },
    };
    expect(() => validateOrThrow(GATE_EVENT_SCHEMA, bad)).toThrow();
  });
});
