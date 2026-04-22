import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync as realWriteFileSync, rmSync, readdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTask, saveTask, advanceStatus, loadProject } from '../lib/task.js';
import type { ProjectDoc } from '../lib/task.js';

function scaffold(repoRoot: string): void {
  mkdirSync(join(repoRoot, '.cloverleaf', 'projects'), { recursive: true });
  mkdirSync(join(repoRoot, '.cloverleaf', 'tasks'), { recursive: true });
  mkdirSync(join(repoRoot, '.cloverleaf', 'events'), { recursive: true });
  realWriteFileSync(
    join(repoRoot, '.cloverleaf', 'projects', 'DEMO.json'),
    JSON.stringify({ key: 'DEMO', name: 'Demo Project' })
  );
  realWriteFileSync(
    join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-001.json'),
    JSON.stringify({
      id: 'DEMO-001',
      type: 'task',
      status: 'pending',
      owner: { kind: 'agent', id: 'unassigned' },
      project: 'DEMO',
      title: 'Add multiply function',
      context: { rfc: { project: 'DEMO', id: 'DEMO-RFC-001' } },
      acceptance_criteria: ['function multiplies two numbers', 'unit test covers zero, positive, negative'],
      definition_of_done: ['Branch pushed with code + tests passing.'],
      risk_class: 'low',
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
    expect(project.key).toBe('DEMO');
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

  describe('advanceStatus atomicity', () => {
    it('does not persist task status if event emission fails', () => {
      // Replace the events dir with a FILE to force mkdir to fail with ENOTDIR
      const eventsDir = join(repoRoot, '.cloverleaf', 'events');
      rmSync(eventsDir, { recursive: true, force: true });
      realWriteFileSync(eventsDir, '');  // regular file where a dir should be

      expect(() => advanceStatus(repoRoot, 'DEMO-001', 'tactical-plan', 'agent')).toThrow();

      // Cleanup for afterEach's rmSync
      rmSync(eventsDir);

      // Task status must remain 'pending'
      const task = loadTask(repoRoot, 'DEMO-001');
      expect(task.status).toBe('pending');
    });

    it('throws with orphan-event prefix and preserves task when save fails after emit', () => {
      const tasksDir = join(repoRoot, '.cloverleaf', 'tasks');
      const taskPath = join(tasksDir, 'DEMO-001.json');
      const eventsDir = join(repoRoot, '.cloverleaf', 'events');
      // Pre-create events dir so emit succeeds (otherwise Fix #1 auto-mkdirs anyway).
      mkdirSync(eventsDir, { recursive: true });

      // Make task file read-only so saveTask's writeFileSync fails with EACCES.
      // On Linux/macOS, 0o444 = r--r--r-- prevents any writes.
      chmodSync(taskPath, 0o444);
      try {
        expect(() => advanceStatus(repoRoot, 'DEMO-001', 'tactical-plan', 'agent')).toThrow(
          /^orphan event written to .+ but task save failed:/
        );

        // Event file exists (proving emit succeeded before save was attempted).
        const evts = readdirSync(eventsDir);
        expect(evts.some((f) => f.endsWith('-status.json'))).toBe(true);
      } finally {
        // Restore perms so afterEach can cleanup
        chmodSync(taskPath, 0o644);
      }

      // Task file on disk unchanged — original status was 'pending' and save failed
      // so the file's content is whatever was written by the beforeEach scaffolding.
      expect(loadTask(repoRoot, 'DEMO-001').status).toBe('pending');
    });
  });
});

describe('full_pipeline transitions', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'cloverleaf-state-full-'));
    mkdirSync(join(repoRoot, '.cloverleaf', 'projects'), { recursive: true });
    mkdirSync(join(repoRoot, '.cloverleaf', 'tasks'), { recursive: true });
    mkdirSync(join(repoRoot, '.cloverleaf', 'events'), { recursive: true });
    realWriteFileSync(
      join(repoRoot, '.cloverleaf', 'projects', 'DEMO.json'),
      JSON.stringify({ key: 'DEMO', name: 'Demo' })
    );
    const task = {
      id: 'DEMO-001',
      type: 'task',
      status: 'implementing',
      risk_class: 'high',
      owner: { kind: 'agent', id: 'implementer' },
      project: 'DEMO',
      title: 'demo',
      context: { rfc: { project: 'DEMO', id: 'DEMO-RFC-001' } },
      acceptance_criteria: ['a'],
      definition_of_done: ['d'],
    };
    realWriteFileSync(
      join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-001.json'),
      JSON.stringify(task)
    );
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('implementing → documenting is legal', () => {
    expect(() => advanceStatus(repoRoot, 'DEMO-001', 'documenting', 'agent')).not.toThrow();
  });

  it('documenting → review is legal', () => {
    advanceStatus(repoRoot, 'DEMO-001', 'documenting', 'agent');
    expect(() => advanceStatus(repoRoot, 'DEMO-001', 'review', 'agent')).not.toThrow();
  });

  it('automated-gates → ui-review is legal with full_pipeline path', () => {
    advanceStatus(repoRoot, 'DEMO-001', 'documenting', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'review', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'automated-gates', 'agent');
    expect(() =>
      advanceStatus(repoRoot, 'DEMO-001', 'ui-review', 'agent', { path: 'full_pipeline' })
    ).not.toThrow();
  });

  it('automated-gates → qa is legal with full_pipeline path', () => {
    advanceStatus(repoRoot, 'DEMO-001', 'documenting', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'review', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'automated-gates', 'agent');
    expect(() =>
      advanceStatus(repoRoot, 'DEMO-001', 'qa', 'agent', { path: 'full_pipeline' })
    ).not.toThrow();
  });

  it('ui-review → qa is legal', () => {
    advanceStatus(repoRoot, 'DEMO-001', 'documenting', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'review', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'automated-gates', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'ui-review', 'agent', { path: 'full_pipeline' });
    expect(() =>
      advanceStatus(repoRoot, 'DEMO-001', 'qa', 'agent', { path: 'full_pipeline' })
    ).not.toThrow();
  });

  it('qa → final-gate is legal', () => {
    advanceStatus(repoRoot, 'DEMO-001', 'documenting', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'review', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'automated-gates', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'qa', 'agent', { path: 'full_pipeline' });
    expect(() =>
      advanceStatus(repoRoot, 'DEMO-001', 'final-gate', 'agent', { path: 'full_pipeline' })
    ).not.toThrow();
  });

  it('final-gate → merged requires human and final_approval_gate', () => {
    advanceStatus(repoRoot, 'DEMO-001', 'documenting', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'review', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'automated-gates', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'qa', 'agent', { path: 'full_pipeline' });
    advanceStatus(repoRoot, 'DEMO-001', 'final-gate', 'agent', { path: 'full_pipeline' });
    expect(() =>
      advanceStatus(repoRoot, 'DEMO-001', 'merged', 'human', { gate: 'final_approval_gate', path: 'full_pipeline' })
    ).not.toThrow();
  });

  it('ui-review → implementing (bounce) is legal', () => {
    advanceStatus(repoRoot, 'DEMO-001', 'documenting', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'review', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'automated-gates', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'ui-review', 'agent', { path: 'full_pipeline' });
    expect(() =>
      advanceStatus(repoRoot, 'DEMO-001', 'implementing', 'agent', { path: 'full_pipeline' })
    ).not.toThrow();
  });

  it('qa → implementing (bounce) is legal', () => {
    advanceStatus(repoRoot, 'DEMO-001', 'documenting', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'review', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'automated-gates', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'qa', 'agent', { path: 'full_pipeline' });
    expect(() =>
      advanceStatus(repoRoot, 'DEMO-001', 'implementing', 'agent', { path: 'full_pipeline' })
    ).not.toThrow();
  });
});

describe('ProjectDoc type', () => {
  it('requires name field at TS compile time', () => {
    // Enforced by `tsc --noEmit` in npm test — the @ts-expect-error below fails CI
    // if ProjectDoc ever allows missing `name`.
    const doc: ProjectDoc = { key: 'DEMO', name: 'Demo Project' };
    expect(doc.name).toBe('Demo Project');
    // @ts-expect-error — without name, should fail type-check
    const bad: ProjectDoc = { key: 'DEMO' };
    expect(bad.key).toBe('DEMO');
  });
});
