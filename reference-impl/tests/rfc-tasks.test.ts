import { describe, it, expect } from 'vitest';
import { isStandaloneTask } from '../lib/rfc-tasks.js';
import type { TaskDoc } from '../lib/task.js';

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
