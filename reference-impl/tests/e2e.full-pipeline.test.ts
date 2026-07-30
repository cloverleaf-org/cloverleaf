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

describe('collapsed council orchestration (CLI-level)', () => {
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
  // The collapsed council FSM no longer has fast_lane/full_pipeline paths; the
  // delivery council runs at the `council` state and the single human gate is
  // final_approval_gate at final-gate.

  it('drives a task through the collapsed council pipeline ending in merged', () => {
    seedTask('high');

    const calls: string[][] = [
      ['advance-status', repoRoot, 'DEMO-001', 'tactical-plan', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'implementing', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'documenting', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'council', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'final-gate', 'agent'],
      ['emit-gate-decision', repoRoot, 'DEMO-001', 'final_approval_gate', 'approve', 'human'],
      ['advance-status', repoRoot, 'DEMO-001', 'merged', 'human', 'final_approval_gate'],
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
    expect(events.length).toBeGreaterThanOrEqual(6);
  });

  it('drives a task through a council bounce and recovers', () => {
    seedTask('high');

    const calls: string[][] = [
      ['advance-status', repoRoot, 'DEMO-001', 'tactical-plan', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'implementing', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'documenting', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'council', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'implementing', 'agent'], // council bounce
      ['advance-status', repoRoot, 'DEMO-001', 'documenting', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'council', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'final-gate', 'agent'],
    ];

    for (const args of calls) {
      const { exitCode, stderr } = run(args);
      expect(exitCode, `cli ${args.join(' ')} failed: ${stderr}`).toBe(0);
    }

    const task = JSON.parse(
      readFileSync(join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-001.json'), 'utf-8')
    );
    expect(task.status).toBe('final-gate');
  });

  it('drives a task with risk_class=low end-to-end through the council', () => {
    seedTask('low');

    const calls: string[][] = [
      ['advance-status', repoRoot, 'DEMO-001', 'tactical-plan', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'implementing', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'documenting', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'council', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'final-gate', 'agent'],
      ['emit-gate-decision', repoRoot, 'DEMO-001', 'final_approval_gate', 'approve', 'human'],
      ['advance-status', repoRoot, 'DEMO-001', 'merged', 'human', 'final_approval_gate'],
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

  it('runs the delivery-full council WITHOUT the ui member when affected-routes is empty, passing to final-gate', () => {
    seedTask('high');

    // With no affected routes (empty diff), the delivery-full profile's ui member
    // (when: ui_changes) is inactive; only reviewer + security(+qa) run. The council
    // still passes and the task reaches final-gate.
    const plan = JSON.parse(
      run(['council-plan', repoRoot, 'DEMO-001', 'task.review', '--changed-files=']).stdout
    );
    expect(plan.profile).toBe('delivery-full');
    const members = plan.rounds.flat().map((m: { member: string }) => m.member);
    expect(members).not.toContain('ui');

    const calls: string[][] = [
      ['advance-status', repoRoot, 'DEMO-001', 'tactical-plan', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'implementing', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'documenting', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'council', 'agent'],
      ['advance-status', repoRoot, 'DEMO-001', 'final-gate', 'agent'],
    ];
    for (const args of calls) {
      const { exitCode, stderr } = run(args);
      expect(exitCode, `cli ${args.join(' ')} failed: ${stderr}`).toBe(0);
    }

    const task = JSON.parse(
      readFileSync(join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-001.json'), 'utf-8')
    );
    expect(task.status).toBe('final-gate');
  });
});
