import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI = resolve(__dirname, '..', 'lib', 'cli.ts');

function run(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`npx tsx ${CLI} ${args.map((a) => JSON.stringify(a)).join(' ')}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
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

describe('cli', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'cloverleaf-cli-'));
    mkdirSync(join(repoRoot, '.cloverleaf', 'projects'), { recursive: true });
    mkdirSync(join(repoRoot, '.cloverleaf', 'tasks'), { recursive: true });
    mkdirSync(join(repoRoot, '.cloverleaf', 'events'), { recursive: true });
    mkdirSync(join(repoRoot, '.cloverleaf', 'feedback'), { recursive: true });
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
        title: 'demo',
        status: 'pending',
        path: 'fast_lane',
        acceptance_criteria: ['a'],
        definition_of_done: 'd',
        context: {},
      })
    );
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('load-task returns task JSON', () => {
    const { stdout, exitCode } = run(['load-task', repoRoot, 'DEMO-001']);
    expect(exitCode).toBe(0);
    const doc = JSON.parse(stdout);
    expect(doc.id).toBe('DEMO-001');
  });

  it('infer-project returns the sole project', () => {
    const { stdout, exitCode } = run(['infer-project', repoRoot]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe('DEMO');
  });

  it('next-task-id allocates the next ID', () => {
    const { stdout } = run(['next-task-id', repoRoot, '--project=DEMO']);
    expect(stdout.trim()).toBe('DEMO-002');
  });

  it('advance-status moves task through a legal transition', () => {
    const { exitCode } = run(['advance-status', repoRoot, 'DEMO-001', 'tactical-plan', 'agent']);
    expect(exitCode).toBe(0);
    const task = JSON.parse(readFileSync(join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-001.json'), 'utf-8'));
    expect(task.status).toBe('tactical-plan');
  });

  it('advance-status exits nonzero on illegal transition', () => {
    const { exitCode, stderr } = run(['advance-status', repoRoot, 'DEMO-001', 'merged', 'agent']);
    expect(exitCode).not.toBe(0);
    expect(stderr.toLowerCase()).toMatch(/illegal|not allowed/);
  });
});
