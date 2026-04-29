import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, readdirSync, readFileSync, existsSync } from 'node:fs';
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

  it('savePlan auto-creates the plans directory on first write (v0.5.1)', () => {
    const fresh = mkdtempSync(join(tmpdir(), 'cl-plan-fresh-'));
    try {
      expect(existsSync(join(fresh, '.cloverleaf', 'plans'))).toBe(false);
      savePlan(fresh, validPlan());
      expect(existsSync(join(fresh, '.cloverleaf', 'plans', 'CLV-012.json'))).toBe(true);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
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

    // Build corrupted plan in-memory: remove required definition_of_done from SECOND task.
    // Corrupting tasks[1] means tasks[0] passes validation cleanly; a buggy interleaved-loop
    // implementation would write tasks[0] to disk before hitting the failure, surfacing as
    // readdirSync returning 1 file instead of 0.
    const corruptedPlan = validPlan();
    const tasks = corruptedPlan.tasks as Array<Record<string, unknown>>;
    delete tasks[1]['definition_of_done'];  // corrupt SECOND task so atomicity test catches interleaved-loop bugs

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

describe('plan lib — savePlan overlap edge integration (CLV-81)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cl-plan-overlap-'));
    mkdirSync(join(tmp, '.cloverleaf', 'plans'), { recursive: true });
    mkdirSync(join(tmp, '.cloverleaf', 'tasks'), { recursive: true });
    mkdirSync(join(tmp, '.cloverleaf', 'events'), { recursive: true });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  // Helper: build a task record with scope.files_touched
  function taskWithFiles(id: string, files: string[]): Record<string, unknown> {
    return {
      ...validTask(id),
      scope: { files_touched: files },
    };
  }

  // 1. Logical-only edges plus file-overlap tasks → merged output
  it('merges file-overlap inferred edges into task_dag.edges alongside logical edges', () => {
    const plan: PlanDoc = {
      type: 'plan',
      project: 'CLV',
      id: 'CLV-020',
      status: 'drafting',
      owner: { kind: 'agent', id: 'plan' },
      parent_rfc: { project: 'CLV', id: 'CLV-009' },
      task_dag: {
        nodes: [
          { project: 'CLV', id: 'CLV-021' },
          { project: 'CLV', id: 'CLV-022' },
          { project: 'CLV', id: 'CLV-023' },
        ],
        // Logical edge: CLV-021 → CLV-023
        edges: [
          { from: { project: 'CLV', id: 'CLV-021' }, to: { project: 'CLV', id: 'CLV-023' } },
        ],
      },
      tasks: [
        taskWithFiles('CLV-021', ['lib/shared.ts']),
        taskWithFiles('CLV-022', ['lib/shared.ts']),  // overlaps with CLV-021
        validTask('CLV-023', { title: 'No overlap task' }),
      ],
    } as unknown as PlanDoc;

    savePlan(tmp, plan);
    const saved = loadPlan(tmp, 'CLV-020');

    // Should now have 2 edges: original logical + inferred overlap CLV-021 → CLV-022
    expect(saved.task_dag.edges).toHaveLength(2);
    const edgeKeys = saved.task_dag.edges.map(e => `${e.from.id}→${e.to.id}`);
    expect(edgeKeys).toContain('CLV-021→CLV-023');  // original logical edge
    expect(edgeKeys).toContain('CLV-021→CLV-022');  // inferred overlap edge
  });

  // 2. Idempotent re-save: re-saving a plan with already-merged overlap edges
  //    produces identical JSON output (overlap edges not duplicated)
  it('is idempotent: re-saving a plan with already-merged overlap edges produces identical output', () => {
    const plan: PlanDoc = {
      type: 'plan',
      project: 'CLV',
      id: 'CLV-020',
      status: 'drafting',
      owner: { kind: 'agent', id: 'plan' },
      parent_rfc: { project: 'CLV', id: 'CLV-009' },
      task_dag: {
        nodes: [
          { project: 'CLV', id: 'CLV-021' },
          { project: 'CLV', id: 'CLV-022' },
        ],
        edges: [],
      },
      tasks: [
        taskWithFiles('CLV-021', ['lib/overlap.ts']),
        taskWithFiles('CLV-022', ['lib/overlap.ts']),
      ],
    } as unknown as PlanDoc;

    // First save: infers and merges the overlap edge
    savePlan(tmp, plan);
    const planPath = join(tmp, '.cloverleaf', 'plans', 'CLV-020.json');
    const afterFirstSave = readFileSync(planPath, 'utf-8');

    // Second save (re-load and re-save): should produce identical content
    const reloaded = loadPlan(tmp, 'CLV-020');
    savePlan(tmp, reloaded);
    const afterSecondSave = readFileSync(planPath, 'utf-8');

    expect(afterSecondSave).toBe(afterFirstSave);
    // Exactly one overlap edge
    expect(reloaded.task_dag.edges).toHaveLength(1);
  });

  // 3. Cycle-introducing overlap throws with the documented message
  it('throws "file overlap creates cycle: X ↔ Y via file" when inferred edges introduce a cycle', () => {
    // CLV-021 → CLV-022 (logical edge) + CLV-021 & CLV-022 share a file
    // The overlap inference would also want CLV-021 → CLV-022 (same direction, harmless)
    // but if we add a logical CLV-022 → CLV-021 edge, the overlap CLV-021 → CLV-022
    // combined with CLV-022 → CLV-021 forms a cycle.
    //
    // Setup: logical edges: CLV-022 → CLV-021 (reverse order)
    //        overlap: CLV-021 and CLV-022 share a file → inferred edge CLV-021 → CLV-022
    //        Combined DAG: CLV-021 → CLV-022 (inferred) + CLV-022 → CLV-021 (logical) = cycle
    const plan: PlanDoc = {
      type: 'plan',
      project: 'CLV',
      id: 'CLV-030',
      status: 'drafting',
      owner: { kind: 'agent', id: 'plan' },
      parent_rfc: { project: 'CLV', id: 'CLV-009' },
      task_dag: {
        nodes: [
          { project: 'CLV', id: 'CLV-031' },
          { project: 'CLV', id: 'CLV-032' },
        ],
        // Logical edge: CLV-032 → CLV-031 (higher id → lower id)
        edges: [
          { from: { project: 'CLV', id: 'CLV-032' }, to: { project: 'CLV', id: 'CLV-031' } },
        ],
      },
      tasks: [
        // Both tasks touch the same file → overlap inference adds CLV-031 → CLV-032
        taskWithFiles('CLV-031', ['lib/cycle.ts']),
        taskWithFiles('CLV-032', ['lib/cycle.ts']),
      ],
    } as unknown as PlanDoc;

    // The augmented DAG has: CLV-031 → CLV-032 (inferred) + CLV-032 → CLV-031 (logical) = cycle
    expect(() => savePlan(tmp, plan)).toThrow(
      /file overlap creates cycle: CLV-031 ↔ CLV-032 via lib\/cycle\.ts/
    );
  });

  // 4. Pre-existing overlap edges are not duplicated on re-save
  it('does not duplicate pre-existing overlap edges when the plan is re-saved', () => {
    const plan: PlanDoc = {
      type: 'plan',
      project: 'CLV',
      id: 'CLV-040',
      status: 'drafting',
      owner: { kind: 'agent', id: 'plan' },
      parent_rfc: { project: 'CLV', id: 'CLV-009' },
      task_dag: {
        nodes: [
          { project: 'CLV', id: 'CLV-041' },
          { project: 'CLV', id: 'CLV-042' },
        ],
        // The overlap edge is already present in the initial plan
        edges: [
          { from: { project: 'CLV', id: 'CLV-041' }, to: { project: 'CLV', id: 'CLV-042' } },
        ],
      },
      tasks: [
        taskWithFiles('CLV-041', ['lib/dup.ts']),
        taskWithFiles('CLV-042', ['lib/dup.ts']),
      ],
    } as unknown as PlanDoc;

    savePlan(tmp, plan);
    const saved = loadPlan(tmp, 'CLV-040');

    // The overlap inference would produce CLV-041 → CLV-042, but it's already present
    // → set-union means still exactly 1 edge
    expect(saved.task_dag.edges).toHaveLength(1);
    expect(saved.task_dag.edges[0]).toEqual({
      from: { project: 'CLV', id: 'CLV-041' },
      to: { project: 'CLV', id: 'CLV-042' },
    });
  });
});
