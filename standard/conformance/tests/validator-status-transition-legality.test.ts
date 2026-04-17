import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateStatusTransitionLegality } from '../../validators/status-transition-legality.js';
import type { StatusTransitionEvent, StatusTransitions, Task } from '../../validators/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const taskMachine = JSON.parse(readFileSync(resolve(__dirname, '..', '..', 'state-machines', 'task.json'), 'utf-8')) as StatusTransitions;

function evt(from: string, to: string, actor: 'human' | 'agent' | 'system' = 'agent'): StatusTransitionEvent {
  return {
    event_id: 'e1', event_type: 'status_transition', occurred_at: '2026-04-17T12:00:00Z',
    work_item_id: { project: 'ACME', id: 'ACME-1' }, work_item_type: 'task',
    from_status: from, to_status: to,
    actor: { kind: actor, id: 'x' }
  };
}

function task(riskClass: 'low' | 'high'): Task {
  return {
    id: 'ACME-1', type: 'task', status: 'pending',
    project: 'ACME',
    owner: { kind: 'agent', id: 'a' },
    context: { rfc: { project: 'ACME', id: 'ACME-100' } },
    definition_of_done: ['x'], acceptance_criteria: ['y'],
    risk_class: riskClass
  } as Task;
}

describe('validator: status-transition-legality', () => {
  it('accepts pending → tactical-plan (both paths)', () => {
    expect(validateStatusTransitionLegality(evt('pending', 'tactical-plan'), taskMachine, task('high')).ok).toBe(true);
    expect(validateStatusTransitionLegality(evt('pending', 'tactical-plan'), taskMachine, task('low')).ok).toBe(true);
  });

  it('accepts automated-gates → ui-review only on full_pipeline (risk=high)', () => {
    expect(validateStatusTransitionLegality(evt('automated-gates', 'ui-review'), taskMachine, task('high')).ok).toBe(true);
    expect(validateStatusTransitionLegality(evt('automated-gates', 'ui-review'), taskMachine, task('low')).ok).toBe(false);
  });

  it('accepts automated-gates → merged only on fast_lane (risk=low)', () => {
    expect(validateStatusTransitionLegality(evt('automated-gates', 'merged', 'human'), taskMachine, task('low')).ok).toBe(true);
    expect(validateStatusTransitionLegality(evt('automated-gates', 'merged', 'human'), taskMachine, task('high')).ok).toBe(false);
  });

  it('rejects illegal transition', () => {
    expect(validateStatusTransitionLegality(evt('merged', 'implementing'), taskMachine, task('high')).ok).toBe(false);
  });

  it('rejects wrong actor kind', () => {
    // final-gate → merged requires human
    expect(validateStatusTransitionLegality(evt('final-gate', 'merged', 'agent'), taskMachine, task('high')).ok).toBe(false);
  });
});
