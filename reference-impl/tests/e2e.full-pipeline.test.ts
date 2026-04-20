import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs';
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

describe('full_pipeline orchestration (CLI-level)', () => {
  let repoRoot: string;

  function seedTask(riskClass: 'low' | 'high'): void {
    repoRoot = mkdtempSync(join(tmpdir(), 'cloverleaf-e2e-'));
    mkdirSync(join(repoRoot, '.cloverleaf', 'projects'), { recursive: true });
    mkdirSync(join(repoRoot, '.cloverleaf', 'tasks'), { recursive: true });
    mkdirSync(join(repoRoot, '.cloverleaf', 'events'), { recursive: true });
    mkdirSync(join(repoRoot, '.cloverleaf', 'feedback'), { recursive: true });
    writeFileSync(
      join(repoRoot, '.cloverleaf', 'projects', 'DEMO.json'),
      JSON.stringify({ key: 'DEMO', name: 'Demo' })
    );
    writeFileSync(
      join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-001.json'),
      JSON.stringify({
        id: 'DEMO-001',
        type: 'task',
        status: 'pending',
        risk_class: riskClass,
        owner: { kind: 'agent', id: 'implementer' },
        project: 'DEMO',
        title: 'demo full pipeline',
        context: { rfc: { project: 'DEMO', id: 'DEMO-RFC-001' } },
        acceptance_criteria: ['add a UI page'],
        definition_of_done: ['ui page rendered'],
      })
    );
  }

  afterEach(() => {
    if (repoRoot) {
      rmSync(repoRoot, { recursive: true, force: true });
      repoRoot = '';
    }
  });

  // advance-status positional signature: <repoRoot> <taskId> <toStatus> <actor> [gate] [path]
  // For path-tagged transitions without a gate, pass '' as the gate positional arg.

  it('drives a task through the full pipeline ending in merged', () => {
    seedTask('high');

    const calls: string[][] = [
      ['advance-status', repoRoot, 'DEMO-001', 'tactical-plan', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'implementing', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'documenting', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'review', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'automated-gates', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'ui-review', 'agent', '', 'full_pipeline'],
      ['advance-status', repoRoot, 'DEMO-001', 'qa', 'agent', '', 'full_pipeline'],
      ['advance-status', repoRoot, 'DEMO-001', 'final-gate', 'agent', '', 'full_pipeline'],
      ['emit-gate-decision', repoRoot, 'DEMO-001', 'final_approval_gate', 'approve', 'human'],
      ['advance-status', repoRoot, 'DEMO-001', 'merged', 'human', 'final_approval_gate', 'full_pipeline'],
    ];

    for (const args of calls) {
      const { exitCode, stderr } = run(args);
      expect(exitCode, `cli ${args.join(' ')} failed: ${stderr}`).toBe(0);
    }

    const task = JSON.parse(
      readFileSync(join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-001.json'), 'utf-8')
    );
    expect(task.status).toBe('merged');

    const events = readdirSync(join(repoRoot, '.cloverleaf', 'events'));
    expect(events.length).toBeGreaterThanOrEqual(10);
  });

  it('drives a task through a review bounce and recovers', () => {
    seedTask('high');

    const calls: string[][] = [
      ['advance-status', repoRoot, 'DEMO-001', 'tactical-plan', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'implementing', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'documenting', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'review', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'implementing', 'agent'], // review bounce
      ['advance-status', repoRoot, 'DEMO-001', 'documenting', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'review', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'automated-gates', 'agent'],
    ];

    for (const args of calls) {
      const { exitCode, stderr } = run(args);
      expect(exitCode, `cli ${args.join(' ')} failed: ${stderr}`).toBe(0);
    }

    const task = JSON.parse(
      readFileSync(join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-001.json'), 'utf-8')
    );
    expect(task.status).toBe('automated-gates');
  });

  it('fast_lane drives a task with risk_class=low end-to-end', () => {
    seedTask('low');

    const calls: string[][] = [
      ['advance-status', repoRoot, 'DEMO-001', 'tactical-plan', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'implementing', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'documenting', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'review', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'automated-gates', 'agent'],
      ['emit-gate-decision', repoRoot, 'DEMO-001', 'human_merge', 'approve', 'human'],
      ['advance-status', repoRoot, 'DEMO-001', 'merged', 'human', 'human_merge', 'fast_lane'],
    ];

    for (const args of calls) {
      const { exitCode, stderr } = run(args);
      expect(exitCode, `cli ${args.join(' ')} failed: ${stderr}`).toBe(0);
    }

    const merged = JSON.parse(
      readFileSync(join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-001.json'), 'utf-8')
    );
    expect(merged.status).toBe('merged');
  });

  it('skips ui-review when affected-routes is empty, advances to qa', () => {
    seedTask('high');

    const warmup: string[][] = [
      ['advance-status', repoRoot, 'DEMO-001', 'tactical-plan', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'implementing', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'documenting', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'review', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'automated-gates', 'agent'],
    ];
    for (const args of warmup) {
      const { exitCode } = run(args);
      expect(exitCode).toBe(0);
    }

    // The real skill would invoke `affected-routes`; here we simulate the empty-set
    // outcome by advancing automated-gates → qa directly with path=full_pipeline,
    // matching the skill's step-5 skip-path.
    const skip = run([
      'advance-status', repoRoot, 'DEMO-001', 'qa', 'agent', '', 'full_pipeline',
    ]);
    expect(skip.exitCode, `cli skip failed: ${skip.stderr}`).toBe(0);

    const task = JSON.parse(
      readFileSync(join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-001.json'), 'utf-8')
    );
    expect(task.status).toBe('qa');
  });
});
