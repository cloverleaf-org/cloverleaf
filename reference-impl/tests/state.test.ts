import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTask, saveTask, advanceStatus, loadProject } from '../lib/state.js';

function scaffold(repoRoot: string): void {
  mkdirSync(join(repoRoot, '.cloverleaf', 'projects'), { recursive: true });
  mkdirSync(join(repoRoot, '.cloverleaf', 'tasks'), { recursive: true });
  mkdirSync(join(repoRoot, '.cloverleaf', 'events'), { recursive: true });
  writeFileSync(
    join(repoRoot, '.cloverleaf', 'projects', 'DEMO.json'),
    JSON.stringify({ project: 'DEMO', id_pattern: '^DEMO-\\d+$' })
  );
  writeFileSync(
    join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-001.json'),
    JSON.stringify({
      type: 'task',
      project: 'DEMO',
      id: 'DEMO-001',
      title: 'Add multiply function',
      status: 'pending',
      path: 'fast_lane',
      acceptance_criteria: ['function multiplies two numbers', 'unit test covers zero, positive, negative'],
      definition_of_done: 'Branch pushed with code + tests passing.',
      context: {},
    })
  );
}

describe('state', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'cloverleaf-state-'));
    scaffold(repoRoot);
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('loads a task by ID', () => {
    const task = loadTask(repoRoot, 'DEMO-001');
    expect(task.id).toBe('DEMO-001');
    expect(task.status).toBe('pending');
  });

  it('throws when task missing', () => {
    expect(() => loadTask(repoRoot, 'DEMO-999')).toThrow(/not found/i);
  });

  it('saves a task and reloads it', () => {
    const task = loadTask(repoRoot, 'DEMO-001');
    task.title = 'Updated title';
    saveTask(repoRoot, task);
    expect(loadTask(repoRoot, 'DEMO-001').title).toBe('Updated title');
  });

  it('loads a project by ID', () => {
    const project = loadProject(repoRoot, 'DEMO');
    expect(project.project).toBe('DEMO');
  });

  describe('advanceStatus', () => {
    it('advances through a legal transition', () => {
      const updated = advanceStatus(repoRoot, 'DEMO-001', 'tactical-plan', 'agent');
      expect(updated.status).toBe('tactical-plan');
      expect(loadTask(repoRoot, 'DEMO-001').status).toBe('tactical-plan');
    });

    it('rejects an illegal transition', () => {
      expect(() => advanceStatus(repoRoot, 'DEMO-001', 'merged', 'agent')).toThrow(/illegal|not allowed/i);
    });

    it('accepts the full fast-lane path to merged', () => {
      advanceStatus(repoRoot, 'DEMO-001', 'tactical-plan', 'agent');
      advanceStatus(repoRoot, 'DEMO-001', 'implementing', 'agent');
      advanceStatus(repoRoot, 'DEMO-001', 'documenting', 'agent');
      advanceStatus(repoRoot, 'DEMO-001', 'review', 'agent');
      advanceStatus(repoRoot, 'DEMO-001', 'automated-gates', 'agent');
      expect(() =>
        advanceStatus(repoRoot, 'DEMO-001', 'merged', 'human', { gate: 'human_merge', path: 'fast_lane' })
      ).not.toThrow();
    });
  });
});
