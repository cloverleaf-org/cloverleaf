/**
 * scope-extend.test.ts — 6 test cases for the extend-scope CLI subcommand.
 *
 * Covers:
 *  1.  extend-scope adds new files into scope.files_touched (sorted, deduped)
 *  2.  extend-scope is idempotent: re-running with the same files produces no change
 *  3.  extend-scope appends a valid audit.jsonl entry with correct shape
 *  4.  extend-scope exits 2 when --reason is missing
 *  5.  extend-scope exits 2 when --add is missing
 *  6.  extend-scope exits 2 when --add is present but has no files
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI = resolve(__dirname, '..', 'lib', 'cli.ts');

function run(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(
      `npx tsx ${CLI} ${args.map((a) => JSON.stringify(a)).join(' ')}`,
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
      exitCode: e.status ?? 1,
    };
  }
}

/** Minimal valid task document (satisfies schema) */
function makeTaskDoc(taskId: string, filesT?: string[]): Record<string, unknown> {
  return {
    type: 'task',
    project: 'DEMO',
    id: taskId,
    title: `Task ${taskId}`,
    status: 'pending',
    risk_class: 'low',
    owner: { kind: 'agent', id: 'implementer' },
    acceptance_criteria: ['ac'],
    definition_of_done: ['dod'],
    context: { rfc: { project: 'DEMO', id: 'DEMO-001' } },
    ...(filesT !== undefined ? { scope: { files_touched: filesT } } : {}),
  };
}

describe('extend-scope', () => {
  let repoRoot: string;
  const taskId = 'DEMO-002';

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'cloverleaf-extend-scope-'));
    mkdirSync(join(repoRoot, '.cloverleaf', 'projects'), { recursive: true });
    mkdirSync(join(repoRoot, '.cloverleaf', 'tasks'), { recursive: true });

    writeFileSync(
      join(repoRoot, '.cloverleaf', 'projects', 'DEMO.json'),
      JSON.stringify({ key: 'DEMO', name: 'Demo' })
    );
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  // 1. extend-scope adds new files into scope.files_touched (sorted, deduped)
  it('adds new files to scope.files_touched, sorted and deduped', () => {
    const task = makeTaskDoc(taskId, ['lib/a.ts']);
    writeFileSync(
      join(repoRoot, '.cloverleaf', 'tasks', `${taskId}.json`),
      JSON.stringify(task)
    );

    const { exitCode } = run([
      'extend-scope',
      repoRoot,
      taskId,
      '--add',
      'lib/c.ts',
      'lib/b.ts',
      '--reason',
      'Added during implementation',
    ]);
    expect(exitCode).toBe(0);

    const updated = JSON.parse(
      readFileSync(join(repoRoot, '.cloverleaf', 'tasks', `${taskId}.json`), 'utf-8')
    );
    expect(updated.scope.files_touched).toEqual(['lib/a.ts', 'lib/b.ts', 'lib/c.ts']);
  });

  // 2. extend-scope is idempotent
  it('is idempotent: re-running with same files produces no change to the task doc', () => {
    const task = makeTaskDoc(taskId, ['lib/a.ts', 'lib/b.ts']);
    writeFileSync(
      join(repoRoot, '.cloverleaf', 'tasks', `${taskId}.json`),
      JSON.stringify(task)
    );

    run([
      'extend-scope',
      repoRoot,
      taskId,
      '--add',
      'lib/b.ts',
      '--reason',
      'Already in scope',
    ]);

    const updated = JSON.parse(
      readFileSync(join(repoRoot, '.cloverleaf', 'tasks', `${taskId}.json`), 'utf-8')
    );
    // No new file added, existing set preserved sorted
    expect(updated.scope.files_touched).toEqual(['lib/a.ts', 'lib/b.ts']);
  });

  // 3. extend-scope appends a valid audit.jsonl entry
  it('appends a correctly-shaped audit.jsonl entry with ts, kind, task_id, files, reason', () => {
    // Task has parent pointing to plan DEMO-010
    const task = {
      ...makeTaskDoc(taskId, ['lib/existing.ts']),
      parent: { project: 'DEMO', id: 'DEMO-010' },
    };
    writeFileSync(
      join(repoRoot, '.cloverleaf', 'tasks', `${taskId}.json`),
      JSON.stringify(task)
    );

    const { exitCode } = run([
      'extend-scope',
      repoRoot,
      taskId,
      '--add',
      'lib/new.ts',
      '--reason',
      'discovered during impl',
    ]);
    expect(exitCode).toBe(0);

    const auditPath = join(
      repoRoot,
      '.cloverleaf',
      'runs',
      'plan',
      'DEMO-010',
      'audit.jsonl'
    );
    expect(existsSync(auditPath)).toBe(true);

    const lines = readFileSync(auditPath, 'utf-8')
      .split('\n')
      .filter(Boolean);
    expect(lines.length).toBe(1);

    const entry = JSON.parse(lines[0]);
    expect(entry.kind).toBe('extend-scope');
    expect(entry.task_id).toBe(taskId);
    expect(entry.files).toEqual(['lib/new.ts']);
    expect(entry.reason).toBe('discovered during impl');
    expect(typeof entry.ts).toBe('string');
    // ts must be a valid ISO 8601 date
    expect(() => new Date(entry.ts).toISOString()).not.toThrow();
  });

  // 4. extend-scope exits 2 when --reason is missing
  it('exits 2 when --reason flag is missing', () => {
    const task = makeTaskDoc(taskId, []);
    writeFileSync(
      join(repoRoot, '.cloverleaf', 'tasks', `${taskId}.json`),
      JSON.stringify(task)
    );

    const { exitCode, stderr } = run([
      'extend-scope',
      repoRoot,
      taskId,
      '--add',
      'lib/foo.ts',
    ]);
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/--reason/i);
  });

  // 5. extend-scope exits 2 when --add is missing
  it('exits 2 when --add flag is missing entirely', () => {
    const task = makeTaskDoc(taskId, []);
    writeFileSync(
      join(repoRoot, '.cloverleaf', 'tasks', `${taskId}.json`),
      JSON.stringify(task)
    );

    const { exitCode, stderr } = run([
      'extend-scope',
      repoRoot,
      taskId,
      '--reason',
      'some reason',
    ]);
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/--add/i);
  });

  // 6. extend-scope exits 2 when --add has no files
  it('exits 2 when --add is present but has no file arguments', () => {
    const task = makeTaskDoc(taskId, []);
    writeFileSync(
      join(repoRoot, '.cloverleaf', 'tasks', `${taskId}.json`),
      JSON.stringify(task)
    );

    const { exitCode, stderr } = run([
      'extend-scope',
      repoRoot,
      taskId,
      '--add',
      '--reason',
      'some reason',
    ]);
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/--add/i);
  });
});
