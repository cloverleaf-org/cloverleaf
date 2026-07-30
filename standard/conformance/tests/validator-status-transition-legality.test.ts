import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateStatusTransitionLegality } from '../../validators/status-transition-legality.js';
import type { StatusTransitions, Task, StatusTransitionEvent } from '../../validators/types.js';

const taskMachine = JSON.parse(
  readFileSync(resolve(__dirname, '..', '..', 'state-machines', 'task.json'), 'utf-8'),
) as StatusTransitions;

function evt(from: string, to: string, actor: 'agent' | 'human' = 'agent'): StatusTransitionEvent {
  return {
    event_id: 'e', event_type: 'status_transition', occurred_at: '2026-07-20T00:00:00Z',
    work_item_id: { project: 'CLV', id: 'CLV-1' }, work_item_type: 'task',
    from_status: from, to_status: to, actor: { kind: actor, id: actor },
  };
}
function task(risk: 'low' | 'high'): Task {
  return {
    id: 'CLV-1', type: 'task', status: 'council', project: 'CLV', title: 't',
    owner: { kind: 'agent', id: 'unassigned' },
    context: { rfc: { project: 'CLV', id: 'CLV-1' } },
    definition_of_done: ['x'], acceptance_criteria: ['y'], risk_class: risk,
  } as unknown as Task;
}

describe('validator: status-transition-legality (collapsed FSM)', () => {
  it('accepts pending → tactical-plan for both risk classes', () => {
    expect(validateStatusTransitionLegality(evt('pending', 'tactical-plan'), taskMachine, task('high')).ok).toBe(true);
    expect(validateStatusTransitionLegality(evt('pending', 'tactical-plan'), taskMachine, task('low')).ok).toBe(true);
  });

  it('accepts documenting → council and the three council exits', () => {
    expect(validateStatusTransitionLegality(evt('documenting', 'council'), taskMachine, task('low')).ok).toBe(true);
    expect(validateStatusTransitionLegality(evt('council', 'final-gate'), taskMachine, task('low')).ok).toBe(true);
    expect(validateStatusTransitionLegality(evt('council', 'implementing'), taskMachine, task('high')).ok).toBe(true);
    expect(validateStatusTransitionLegality(evt('council', 'escalated'), taskMachine, task('high')).ok).toBe(true);
  });

  it('accepts a decisive (agent) plan_review bounce as well as a human one', () => {
    expect(validateStatusTransitionLegality(evt('tactical-plan', 'pending', 'agent'), taskMachine, task('low')).ok).toBe(true);
    expect(validateStatusTransitionLegality(evt('tactical-plan', 'pending', 'human'), taskMachine, task('low')).ok).toBe(true);
  });

  it('requires a human for final-gate → merged', () => {
    expect(validateStatusTransitionLegality(evt('final-gate', 'merged', 'human'), taskMachine, task('high')).ok).toBe(true);
    expect(validateStatusTransitionLegality(evt('final-gate', 'merged', 'agent'), taskMachine, task('high')).ok).toBe(false);
  });

  it('rejects a transition through a collapsed-away state', () => {
    expect(validateStatusTransitionLegality(evt('documenting', 'review'), taskMachine, task('high')).ok).toBe(false);
    expect(validateStatusTransitionLegality(evt('automated-gates', 'qa'), taskMachine, task('high')).ok).toBe(false);
  });

  it('rejects an illegal transition', () => {
    expect(validateStatusTransitionLegality(evt('merged', 'implementing'), taskMachine, task('high')).ok).toBe(false);
  });
});
