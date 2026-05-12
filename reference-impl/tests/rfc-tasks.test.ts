import { describe, it, expect } from 'vitest';
import { isStandaloneTask, computeRfcTasksView } from '../lib/rfc-tasks.js';
import type { TaskDoc } from '../lib/task.js';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach } from 'vitest';

function makeTask(overrides: Partial<TaskDoc> = {}): TaskDoc {
  return {
    type: 'task',
    project: 'CC',
    id: 'CC-100',
    title: 't',
    status: 'pending',
    risk_class: 'low',
    owner: { kind: 'agent', id: 'implementer' },
    acceptance_criteria: ['ac'],
    definition_of_done: ['dod'],
    context: {},
    ...overrides,
  };
}

describe('isStandaloneTask', () => {
  it('returns true for task with no parent and context.rfc set', () => {
    const task = makeTask({ context: { rfc: { project: 'CC', id: 'CC-21' } } });
    expect(isStandaloneTask(task)).toBe(true);
  });

  it('returns false for task with parent (Plan-task)', () => {
    const task = makeTask({
      parent: { project: 'CC', id: 'CC-27' },
      context: { rfc: { project: 'CC', id: 'CC-21' } },
    });
    expect(isStandaloneTask(task)).toBe(false);
  });

  it('returns false for orphan task (no parent, no context.rfc)', () => {
    expect(isStandaloneTask(makeTask())).toBe(false);
  });

  it('returns false when parent is explicitly null but context.rfc absent', () => {
    const task = makeTask({ parent: null });
    expect(isStandaloneTask(task)).toBe(false);
  });

  it('returns true when parent is explicitly null and context.rfc set', () => {
    const task = makeTask({
      parent: null,
      context: { rfc: { project: 'CC', id: 'CC-21' } },
    });
    expect(isStandaloneTask(task)).toBe(true);
  });

  it('returns false when context.rfc has empty id string', () => {
    const task = makeTask({ context: { rfc: { project: 'CC', id: '' } } });
    expect(isStandaloneTask(task)).toBe(false);
  });
});

function writeJson(path: string, doc: unknown): void {
  writeFileSync(path, JSON.stringify(doc) + '\n');
}

function setupRepo(): string {
  const tmp = mkdtempSync(join(tmpdir(), 'cl-rfc-tasks-'));
  mkdirSync(join(tmp, '.cloverleaf', 'rfcs'), { recursive: true });
  mkdirSync(join(tmp, '.cloverleaf', 'plans'), { recursive: true });
  mkdirSync(join(tmp, '.cloverleaf', 'tasks'), { recursive: true });
  return tmp;
}

describe('computeRfcTasksView', () => {
  let tmp: string;
  beforeEach(() => { tmp = setupRepo(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('happy path: 1 completed Plan + 2 merged standalone tasks → can_auto_advance', () => {
    writeJson(join(tmp, '.cloverleaf/rfcs/CC-21.json'), {
      type: 'rfc', project: 'CC', id: 'CC-21', status: 'approved',
      title: 't', problem: 'p', solution: 's', unknowns: [],
      acceptance_criteria: [], out_of_scope: [],
      owner: { kind: 'agent', id: 'researcher' },
    });
    writeJson(join(tmp, '.cloverleaf/plans/CC-27.json'), {
      type: 'plan', project: 'CC', id: 'CC-27', status: 'completed',
      parent_rfc: { project: 'CC', id: 'CC-21' },
      owner: { kind: 'agent', id: 'plan' },
      task_dag: { nodes: [{ project: 'CC', id: 'CC-28' }], edges: [] },
      tasks: [],
    });
    writeJson(join(tmp, '.cloverleaf/tasks/CC-28.json'), {
      type: 'task', project: 'CC', id: 'CC-28', status: 'merged',
      parent: { project: 'CC', id: 'CC-27' },
      context: { rfc: { project: 'CC', id: 'CC-21' } },
      title: 't', risk_class: 'low',
      owner: { kind: 'agent', id: 'implementer' },
      acceptance_criteria: ['ac'], definition_of_done: ['dod'],
    });
    writeJson(join(tmp, '.cloverleaf/tasks/CC-045.json'), {
      type: 'task', project: 'CC', id: 'CC-045', status: 'merged',
      context: { rfc: { project: 'CC', id: 'CC-21' } },
      title: 't', risk_class: 'low',
      owner: { kind: 'agent', id: 'implementer' },
      acceptance_criteria: ['ac'], definition_of_done: ['dod'],
    });
    writeJson(join(tmp, '.cloverleaf/tasks/CC-052.json'), {
      type: 'task', project: 'CC', id: 'CC-052', status: 'merged',
      context: { rfc: { project: 'CC', id: 'CC-21' } },
      title: 't', risk_class: 'low',
      owner: { kind: 'agent', id: 'implementer' },
      acceptance_criteria: ['ac'], definition_of_done: ['dod'],
    });

    const view = computeRfcTasksView(tmp, 'CC-21');

    expect(view.rfc).toEqual({ project: 'CC', id: 'CC-21', status: 'approved' });
    expect(view.plans).toHaveLength(1);
    expect(view.plans[0].id).toBe('CC-27');
    expect(view.plans[0].tasks).toHaveLength(1);
    expect(view.standalone_tasks.map(t => t.id).sort()).toEqual(['CC-045', 'CC-052']);
    expect(view.summary).toEqual({
      inflight_plans: 0,
      inflight_standalone: 0,
      delivered_plans: 1,
      delivered_standalone: 2,
      can_auto_advance_rfc: true,
    });
  });

  it('in-flight Plan blocks advance', () => {
    writeJson(join(tmp, '.cloverleaf/rfcs/CC-21.json'), {
      type: 'rfc', project: 'CC', id: 'CC-21', status: 'approved',
      title: 't', problem: 'p', solution: 's', unknowns: [],
      acceptance_criteria: [], out_of_scope: [],
      owner: { kind: 'agent', id: 'researcher' },
    });
    writeJson(join(tmp, '.cloverleaf/plans/CC-27.json'), {
      type: 'plan', project: 'CC', id: 'CC-27', status: 'approved',
      parent_rfc: { project: 'CC', id: 'CC-21' },
      owner: { kind: 'agent', id: 'plan' },
      task_dag: { nodes: [], edges: [] }, tasks: [],
    });
    const view = computeRfcTasksView(tmp, 'CC-21');
    expect(view.summary.inflight_plans).toBe(1);
    expect(view.summary.can_auto_advance_rfc).toBe(false);
  });

  it('in-flight standalone task blocks advance', () => {
    writeJson(join(tmp, '.cloverleaf/rfcs/CC-21.json'), {
      type: 'rfc', project: 'CC', id: 'CC-21', status: 'approved',
      title: 't', problem: 'p', solution: 's', unknowns: [],
      acceptance_criteria: [], out_of_scope: [],
      owner: { kind: 'agent', id: 'researcher' },
    });
    writeJson(join(tmp, '.cloverleaf/tasks/CC-052.json'), {
      type: 'task', project: 'CC', id: 'CC-052', status: 'implementing',
      context: { rfc: { project: 'CC', id: 'CC-21' } },
      title: 't', risk_class: 'low',
      owner: { kind: 'agent', id: 'implementer' },
      acceptance_criteria: ['ac'], definition_of_done: ['dod'],
    });
    const view = computeRfcTasksView(tmp, 'CC-21');
    expect(view.summary.inflight_standalone).toBe(1);
    expect(view.summary.can_auto_advance_rfc).toBe(false);
  });

  it('all-rejected: cannot advance (no delivered)', () => {
    writeJson(join(tmp, '.cloverleaf/rfcs/CC-21.json'), {
      type: 'rfc', project: 'CC', id: 'CC-21', status: 'approved',
      title: 't', problem: 'p', solution: 's', unknowns: [],
      acceptance_criteria: [], out_of_scope: [],
      owner: { kind: 'agent', id: 'researcher' },
    });
    writeJson(join(tmp, '.cloverleaf/plans/CC-27.json'), {
      type: 'plan', project: 'CC', id: 'CC-27', status: 'rejected',
      parent_rfc: { project: 'CC', id: 'CC-21' },
      owner: { kind: 'agent', id: 'plan' },
      task_dag: { nodes: [], edges: [] }, tasks: [],
    });
    const view = computeRfcTasksView(tmp, 'CC-21');
    expect(view.summary.delivered_plans).toBe(0);
    expect(view.summary.delivered_standalone).toBe(0);
    expect(view.summary.can_auto_advance_rfc).toBe(false);
  });

  it('standalone-only RFC: 3 merged standalone tasks, no Plans → can advance', () => {
    writeJson(join(tmp, '.cloverleaf/rfcs/CC-21.json'), {
      type: 'rfc', project: 'CC', id: 'CC-21', status: 'approved',
      title: 't', problem: 'p', solution: 's', unknowns: [],
      acceptance_criteria: [], out_of_scope: [],
      owner: { kind: 'agent', id: 'researcher' },
    });
    for (const id of ['CC-100', 'CC-101', 'CC-102']) {
      writeJson(join(tmp, `.cloverleaf/tasks/${id}.json`), {
        type: 'task', project: 'CC', id, status: 'merged',
        context: { rfc: { project: 'CC', id: 'CC-21' } },
        title: 't', risk_class: 'low',
        owner: { kind: 'agent', id: 'implementer' },
        acceptance_criteria: ['ac'], definition_of_done: ['dod'],
      });
    }
    const view = computeRfcTasksView(tmp, 'CC-21');
    expect(view.plans).toEqual([]);
    expect(view.standalone_tasks).toHaveLength(3);
    expect(view.summary.delivered_standalone).toBe(3);
    expect(view.summary.can_auto_advance_rfc).toBe(true);
  });

  it('RFC not at approved (already completed) → cannot advance', () => {
    writeJson(join(tmp, '.cloverleaf/rfcs/CC-21.json'), {
      type: 'rfc', project: 'CC', id: 'CC-21', status: 'completed',
      title: 't', problem: 'p', solution: 's', unknowns: [],
      acceptance_criteria: [], out_of_scope: [],
      owner: { kind: 'agent', id: 'researcher' },
    });
    const view = computeRfcTasksView(tmp, 'CC-21');
    expect(view.summary.can_auto_advance_rfc).toBe(false);
  });

  it('missing RFC throws with actionable message', () => {
    expect(() => computeRfcTasksView(tmp, 'CC-999')).toThrow(/rfc.*not found.*CC-999/i);
  });

  it('cross-project: tasks in project FOO under RFC in project BAR', () => {
    writeJson(join(tmp, '.cloverleaf/rfcs/BAR-1.json'), {
      type: 'rfc', project: 'BAR', id: 'BAR-1', status: 'approved',
      title: 't', problem: 'p', solution: 's', unknowns: [],
      acceptance_criteria: [], out_of_scope: [],
      owner: { kind: 'agent', id: 'researcher' },
    });
    writeJson(join(tmp, '.cloverleaf/tasks/FOO-1.json'), {
      type: 'task', project: 'FOO', id: 'FOO-1', status: 'merged',
      context: { rfc: { project: 'BAR', id: 'BAR-1' } },
      title: 't', risk_class: 'low',
      owner: { kind: 'agent', id: 'implementer' },
      acceptance_criteria: ['ac'], definition_of_done: ['dod'],
    });
    const view = computeRfcTasksView(tmp, 'BAR-1');
    expect(view.standalone_tasks.map(t => t.id)).toEqual(['FOO-1']);
    expect(view.summary.can_auto_advance_rfc).toBe(true);
  });

  it('orphan tasks (no parent, no context.rfc) are NOT included as standalone', () => {
    writeJson(join(tmp, '.cloverleaf/rfcs/CC-21.json'), {
      type: 'rfc', project: 'CC', id: 'CC-21', status: 'approved',
      title: 't', problem: 'p', solution: 's', unknowns: [],
      acceptance_criteria: [], out_of_scope: [],
      owner: { kind: 'agent', id: 'researcher' },
    });
    writeJson(join(tmp, '.cloverleaf/tasks/CC-orphan.json'), {
      type: 'task', project: 'CC', id: 'CC-orphan', status: 'merged',
      title: 't', risk_class: 'low',
      owner: { kind: 'agent', id: 'implementer' },
      acceptance_criteria: ['ac'], definition_of_done: ['dod'],
      context: {},
    });
    const view = computeRfcTasksView(tmp, 'CC-21');
    expect(view.standalone_tasks).toEqual([]);
  });

  it('tolerates missing plans/ and tasks/ directories', () => {
    // Don't use setupRepo() — set up a minimal repo without plans/ or tasks/ dirs
    const bareRoot = mkdtempSync(join(tmpdir(), 'cl-rfc-tasks-bare-'));
    mkdirSync(join(bareRoot, '.cloverleaf', 'rfcs'), { recursive: true });
    try {
      writeJson(join(bareRoot, '.cloverleaf/rfcs/CC-21.json'), {
        type: 'rfc', project: 'CC', id: 'CC-21', status: 'approved',
        title: 't', problem: 'p', solution: 's', unknowns: [],
        acceptance_criteria: [], out_of_scope: [],
        owner: { kind: 'agent', id: 'researcher' },
      });
      const view = computeRfcTasksView(bareRoot, 'CC-21');
      expect(view.plans).toEqual([]);
      expect(view.standalone_tasks).toEqual([]);
      expect(view.summary).toEqual({
        inflight_plans: 0,
        inflight_standalone: 0,
        delivered_plans: 0,
        delivered_standalone: 0,
        can_auto_advance_rfc: false,
      });
    } finally {
      rmSync(bareRoot, { recursive: true, force: true });
    }
  });

  it('all-rejected mixed: rejected Plan + escalated standalone + rejected standalone → no delivered, cannot advance', () => {
    writeJson(join(tmp, '.cloverleaf/rfcs/CC-21.json'), {
      type: 'rfc', project: 'CC', id: 'CC-21', status: 'approved',
      title: 't', problem: 'p', solution: 's', unknowns: [],
      acceptance_criteria: [], out_of_scope: [],
      owner: { kind: 'agent', id: 'researcher' },
    });
    writeJson(join(tmp, '.cloverleaf/plans/CC-27.json'), {
      type: 'plan', project: 'CC', id: 'CC-27', status: 'rejected',
      parent_rfc: { project: 'CC', id: 'CC-21' },
      owner: { kind: 'agent', id: 'plan' },
      task_dag: { nodes: [], edges: [] }, tasks: [],
    });
    writeJson(join(tmp, '.cloverleaf/tasks/CC-100.json'), {
      type: 'task', project: 'CC', id: 'CC-100', status: 'escalated',
      context: { rfc: { project: 'CC', id: 'CC-21' } },
      title: 't', risk_class: 'low',
      owner: { kind: 'agent', id: 'implementer' },
      acceptance_criteria: ['ac'], definition_of_done: ['dod'],
    });
    writeJson(join(tmp, '.cloverleaf/tasks/CC-101.json'), {
      type: 'task', project: 'CC', id: 'CC-101', status: 'rejected',
      context: { rfc: { project: 'CC', id: 'CC-21' } },
      title: 't', risk_class: 'low',
      owner: { kind: 'agent', id: 'implementer' },
      acceptance_criteria: ['ac'], definition_of_done: ['dod'],
    });
    const view = computeRfcTasksView(tmp, 'CC-21');
    expect(view.summary.inflight_plans).toBe(0);
    expect(view.summary.inflight_standalone).toBe(0); // escalated + rejected are terminal
    expect(view.summary.delivered_plans).toBe(0);
    expect(view.summary.delivered_standalone).toBe(0);
    expect(view.summary.can_auto_advance_rfc).toBe(false);
  });

  it('empty workspace: RFC exists but zero plans, zero tasks → cannot advance (no delivered)', () => {
    writeJson(join(tmp, '.cloverleaf/rfcs/CC-21.json'), {
      type: 'rfc', project: 'CC', id: 'CC-21', status: 'approved',
      title: 't', problem: 'p', solution: 's', unknowns: [],
      acceptance_criteria: [], out_of_scope: [],
      owner: { kind: 'agent', id: 'researcher' },
    });
    const view = computeRfcTasksView(tmp, 'CC-21');
    expect(view.plans).toEqual([]);
    expect(view.standalone_tasks).toEqual([]);
    expect(view.summary.can_auto_advance_rfc).toBe(false);
  });
});
