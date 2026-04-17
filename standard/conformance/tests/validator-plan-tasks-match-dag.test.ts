import { describe, it, expect } from 'vitest';
import { validatePlanTasksMatchDag } from '../../validators/plan-tasks-match-dag.js';
import type { Plan, Task } from '../../validators/types.js';

function task(id: string): Task {
  return {
    id, type: 'task', status: 'pending',
    project: 'ACME',
    owner: { kind: 'agent', id: 'implementer' },
    context: { rfc: { project: 'ACME', id: 'ACME-100' } },
    definition_of_done: ['x'],
    acceptance_criteria: ['y'],
    risk_class: 'low'
  } as Task;
}

function ref(id: string) { return { project: 'ACME', id }; }

describe('validator: plan-tasks-match-dag', () => {
  it('accepts when tasks[] ids match task_dag.nodes exactly', () => {
    const plan: Plan = {
      id: 'ACME-102', type: 'plan', status: 'approved',
      project: 'ACME',
      owner: { kind: 'agent', id: 'plan' },
      parent_rfc: ref('ACME-100'),
      task_dag: { nodes: [ref('ACME-200'), ref('ACME-201')], edges: [] },
      tasks: [task('ACME-200'), task('ACME-201')]
    };
    expect(validatePlanTasksMatchDag(plan)).toEqual({ ok: true });
  });

  it('rejects when tasks has an id not in DAG nodes', () => {
    const plan: Plan = {
      id: 'ACME-102', type: 'plan', status: 'approved',
      project: 'ACME',
      owner: { kind: 'agent', id: 'plan' },
      parent_rfc: ref('ACME-100'),
      task_dag: { nodes: [ref('ACME-200')], edges: [] },
      tasks: [task('ACME-200'), task('ACME-201')]
    };
    const result = validatePlanTasksMatchDag(plan);
    expect(result.ok).toBe(false);
  });

  it('rejects when DAG has a node not in tasks[]', () => {
    const plan: Plan = {
      id: 'ACME-102', type: 'plan', status: 'approved',
      project: 'ACME',
      owner: { kind: 'agent', id: 'plan' },
      parent_rfc: ref('ACME-100'),
      task_dag: { nodes: [ref('ACME-200'), ref('ACME-201')], edges: [] },
      tasks: [task('ACME-200')]
    };
    const result = validatePlanTasksMatchDag(plan);
    expect(result.ok).toBe(false);
  });
});
