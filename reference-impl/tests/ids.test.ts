import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  nextTaskId,
  nextEventId,
  nextFeedbackIteration,
  listProjects,
  inferProject,
  nextWorkItemId,
} from '../lib/ids.js';

describe('ids', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'cloverleaf-ids-'));
    mkdirSync(join(repoRoot, '.cloverleaf', 'projects'), { recursive: true });
    mkdirSync(join(repoRoot, '.cloverleaf', 'tasks'), { recursive: true });
    mkdirSync(join(repoRoot, '.cloverleaf', 'events'), { recursive: true });
    mkdirSync(join(repoRoot, '.cloverleaf', 'feedback'), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  describe('nextTaskId', () => {
    it('returns 001 when no tasks exist', () => {
      expect(nextTaskId(repoRoot, 'ACME')).toBe('ACME-001');
    });

    it('returns the next sequential ID', () => {
      writeFileSync(join(repoRoot, '.cloverleaf', 'tasks', 'ACME-001.json'), '{}');
      writeFileSync(join(repoRoot, '.cloverleaf', 'tasks', 'ACME-003.json'), '{}');
      expect(nextTaskId(repoRoot, 'ACME')).toBe('ACME-004');
    });

    it('ignores other projects', () => {
      writeFileSync(join(repoRoot, '.cloverleaf', 'tasks', 'FOO-001.json'), '{}');
      expect(nextTaskId(repoRoot, 'ACME')).toBe('ACME-001');
    });
  });

  describe('nextEventId', () => {
    it('returns 001 when no events exist', () => {
      expect(nextEventId(repoRoot, 'ACME')).toBe(1);
    });

    it('returns the next sequential number', () => {
      writeFileSync(join(repoRoot, '.cloverleaf', 'events', 'ACME-001-status.json'), '{}');
      writeFileSync(join(repoRoot, '.cloverleaf', 'events', 'ACME-002-gate.json'), '{}');
      expect(nextEventId(repoRoot, 'ACME')).toBe(3);
    });

    it('ignores other projects and non-matching files', () => {
      writeFileSync(join(repoRoot, '.cloverleaf', 'events', 'FOO-001-status.json'), '{}');
      writeFileSync(join(repoRoot, '.cloverleaf', 'events', 'evt-001-status.json'), '{}');
      expect(nextEventId(repoRoot, 'ACME')).toBe(1);
    });
  });

  describe('nextFeedbackIteration', () => {
    it('returns 1 when no feedback exists', () => {
      expect(nextFeedbackIteration(repoRoot, 'ACME', 200)).toBe(1);
    });

    it('returns the next iteration for that task', () => {
      writeFileSync(join(repoRoot, '.cloverleaf', 'feedback', 'ACME-200-r1.json'), '{}');
      writeFileSync(join(repoRoot, '.cloverleaf', 'feedback', 'ACME-200-r2.json'), '{}');
      expect(nextFeedbackIteration(repoRoot, 'ACME', 200)).toBe(3);
    });

    it('ignores other tasks', () => {
      writeFileSync(join(repoRoot, '.cloverleaf', 'feedback', 'ACME-201-r1.json'), '{}');
      expect(nextFeedbackIteration(repoRoot, 'ACME', 200)).toBe(1);
    });
  });

  describe('listProjects', () => {
    it('lists project IDs from filenames', () => {
      writeFileSync(join(repoRoot, '.cloverleaf', 'projects', 'ACME.json'), '{}');
      writeFileSync(join(repoRoot, '.cloverleaf', 'projects', 'FOO.json'), '{}');
      expect(listProjects(repoRoot).sort()).toEqual(['ACME', 'FOO']);
    });

    it('returns empty when no projects exist', () => {
      expect(listProjects(repoRoot)).toEqual([]);
    });
  });

  describe('inferProject', () => {
    it('returns the explicit argument when provided', () => {
      writeFileSync(join(repoRoot, '.cloverleaf', 'projects', 'ACME.json'), '{}');
      writeFileSync(join(repoRoot, '.cloverleaf', 'projects', 'FOO.json'), '{}');
      expect(inferProject(repoRoot, 'FOO')).toBe('FOO');
    });

    it('infers when exactly one project exists', () => {
      writeFileSync(join(repoRoot, '.cloverleaf', 'projects', 'ACME.json'), '{}');
      expect(inferProject(repoRoot)).toBe('ACME');
    });

    it('throws when zero projects', () => {
      expect(() => inferProject(repoRoot)).toThrow(/no projects/i);
    });

    it('throws when multiple projects and none specified', () => {
      writeFileSync(join(repoRoot, '.cloverleaf', 'projects', 'ACME.json'), '{}');
      writeFileSync(join(repoRoot, '.cloverleaf', 'projects', 'FOO.json'), '{}');
      expect(() => inferProject(repoRoot)).toThrow(/ambiguous|specify/i);
    });
  });
});

describe('nextWorkItemId', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cl-ids-'));
    for (const d of ['rfcs', 'spikes', 'plans', 'tasks']) {
      mkdirSync(join(tmp, '.cloverleaf', d), { recursive: true });
    }
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('returns <project>-1 when all four dirs are empty', () => {
    expect(nextWorkItemId(tmp, 'CLV')).toBe('CLV-1');
  });

  it('picks max across rfcs/spikes/plans/tasks plus 1', () => {
    writeFileSync(join(tmp, '.cloverleaf/rfcs/CLV-5.json'), '{}');
    writeFileSync(join(tmp, '.cloverleaf/spikes/CLV-8.json'), '{}');
    writeFileSync(join(tmp, '.cloverleaf/plans/CLV-3.json'), '{}');
    writeFileSync(join(tmp, '.cloverleaf/tasks/CLV-12.json'), '{}');
    expect(nextWorkItemId(tmp, 'CLV')).toBe('CLV-13');
  });

  it('ignores non-matching files', () => {
    writeFileSync(join(tmp, '.cloverleaf/tasks/readme.txt'), 'x');
    writeFileSync(join(tmp, '.cloverleaf/rfcs/OTHER-9.json'), '{}');
    expect(nextWorkItemId(tmp, 'CLV')).toBe('CLV-1');
  });
});
