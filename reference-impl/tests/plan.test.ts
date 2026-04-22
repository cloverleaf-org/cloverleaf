import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPlan, savePlan, advancePlanStatus, materialiseTasksFromPlan, type PlanDoc } from '../lib/plan.js';
import { loadTask } from '../lib/task.js';

function validTask(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  // Shape matches task.schema.json — status must be a valid task status enum value.
  return {
    type: 'task',
    project: 'CLV',
    id,
    title: `Task ${id}`,
    status: 'pending',
    risk_class: 'high',
    owner: { kind: 'agent', id: 'implementer' },
    acceptance_criteria: ['ac-1'],
    definition_of_done: ['dod-1'],
    context: { rfc: { project: 'CLV', id: 'CLV-009' } },
    ...overrides,
  };
}

function validPlan(overrides: Partial<PlanDoc> = {}): PlanDoc {
  return {
    type: 'plan',
    project: 'CLV',
    id: 'CLV-012',
    status: 'drafting',
    owner: { kind: 'agent', id: 'plan' },
    parent_rfc: { project: 'CLV', id: 'CLV-009' },
    task_dag: {
      nodes: [
        { project: 'CLV', id: 'CLV-013' },
        { project: 'CLV', id: 'CLV-014' },
      ],
      edges: [
        { from: { project: 'CLV', id: 'CLV-013' }, to: { project: 'CLV', id: 'CLV-014' } },
      ],
    },
    tasks: [
      validTask('CLV-013', { title: 'Install webkit' }),
      validTask('CLV-014', { title: 'Extend ui-review.json' }),
    ],
    ...overrides,
  } as unknown as PlanDoc;
}

describe('plan lib — load/save/advance', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cl-plan-'));
    mkdirSync(join(tmp, '.cloverleaf', 'plans'), { recursive: true });
    mkdirSync(join(tmp, '.cloverleaf', 'tasks'), { recursive: true });
    mkdirSync(join(tmp, '.cloverleaf', 'events'), { recursive: true });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('round-trips', () => {
    const plan = validPlan();
    savePlan(tmp, plan);
    expect(loadPlan(tmp, 'CLV-012')).toEqual(plan);
  });

  it('savePlan rejects missing task_dag', () => {
    const broken = validPlan();
    // @ts-expect-error
    delete broken.task_dag;
    expect(() => savePlan(tmp, broken)).toThrow();
  });

  it('advancePlanStatus drafting → gate-pending is agent-only', () => {
    savePlan(tmp, validPlan());
    advancePlanStatus(tmp, 'CLV-012', 'gate-pending', 'agent', { gate: 'task_batch_gate' });
    expect(loadPlan(tmp, 'CLV-012').status).toBe('gate-pending');
  });

  it('advancePlanStatus gate-pending → approved requires human', () => {
    savePlan(tmp, validPlan({ status: 'gate-pending' }));
    expect(() => advancePlanStatus(tmp, 'CLV-012', 'approved', 'agent', { gate: 'task_batch_gate' })).toThrow();
    advancePlanStatus(tmp, 'CLV-012', 'approved', 'human', { gate: 'task_batch_gate' });
    expect(loadPlan(tmp, 'CLV-012').status).toBe('approved');
  });
});

describe('plan lib — materialiseTasksFromPlan', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cl-plan-mat-'));
    mkdirSync(join(tmp, '.cloverleaf', 'plans'), { recursive: true });
    mkdirSync(join(tmp, '.cloverleaf', 'tasks'), { recursive: true });
    mkdirSync(join(tmp, '.cloverleaf', 'events'), { recursive: true });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('writes one task file per plan.tasks entry', () => {
    const plan = validPlan();
    savePlan(tmp, plan);
    const ids = materialiseTasksFromPlan(tmp, plan);
    expect(ids).toEqual(['CLV-013', 'CLV-014']);
    const t = loadTask(tmp, 'CLV-013');
    expect(t.title).toBe('Install webkit');
  });

  it('aborts atomically if any task fails AJV validation', () => {
    // Save a valid plan so the plans/ dir has something, but construct a
    // corrupted in-memory plan for the materialisation call only —
    // savePlan also validates tasks[] via $ref, so we cannot save the bad one.
    const plan = validPlan();
    savePlan(tmp, plan);

    // Build corrupted plan in-memory: remove required definition_of_done from first task.
    const corruptedPlan = validPlan();
    const tasks = corruptedPlan.tasks as Array<Record<string, unknown>>;
    delete tasks[0]['definition_of_done'];

    expect(() => materialiseTasksFromPlan(tmp, corruptedPlan as unknown as PlanDoc)).toThrow();
    expect(readdirSync(join(tmp, '.cloverleaf', 'tasks'))).toHaveLength(0);
  });

  it('rejects cycles in task_dag edges', () => {
    const plan = validPlan();
    // Add a cycle: 013 → 014 (existing) plus 014 → 013 (new, forming a 2-cycle).
    plan.task_dag.edges = [
      { from: { project: 'CLV', id: 'CLV-013' }, to: { project: 'CLV', id: 'CLV-014' } },
      { from: { project: 'CLV', id: 'CLV-014' }, to: { project: 'CLV', id: 'CLV-013' } },
    ];
    savePlan(tmp, plan);
    expect(() => materialiseTasksFromPlan(tmp, plan)).toThrow(/cycle/i);
  });
});
