/**
 * CLV-107: Integration tests for security-gate Flows 1–4 + backward-compat.
 *
 * Each describe block drives the full CLI surface (set-task-field via CLI subprocess)
 * and library surface (advance-status via direct call) end-to-end against a temp repo.
 * No LLM subagent involvement.
 * Uses __setMockChangedFiles to inject diffs deterministically (in-process).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { advanceStatus, loadTask, saveTask } from '../lib/task.js';
import { __setMockChangedFiles } from '../lib/security-classify.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLI = resolve(__dirname, '..', 'lib', 'cli.ts');

/**
 * Invoke the CLI in a child process. Used for set-task-field (CLI-only surface).
 * Note: __setMockChangedFiles does NOT transfer to child processes — for advance-status
 * with mock diffs, call advanceStatus() directly (in-process) instead.
 */
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

/** Create a minimal temp repo with the required .cloverleaf structure. */
function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cloverleaf-sg-'));
  mkdirSync(join(dir, '.cloverleaf', 'projects'), { recursive: true });
  mkdirSync(join(dir, '.cloverleaf', 'tasks'), { recursive: true });
  mkdirSync(join(dir, '.cloverleaf', 'events'), { recursive: true });
  mkdirSync(join(dir, '.cloverleaf', 'feedback'), { recursive: true });
  writeFileSync(
    join(dir, '.cloverleaf', 'projects', 'DEMO.json'),
    JSON.stringify({ key: 'DEMO', name: 'Demo' })
  );
  return dir;
}

function writeBaseTask(repoRoot: string, overrides: Record<string, unknown> = {}): void {
  const base: Record<string, unknown> = {
    id: 'DEMO-001',
    type: 'task',
    status: 'pending',
    owner: { kind: 'agent', id: 'unassigned' },
    project: 'DEMO',
    title: 'demo',
    context: { rfc: { project: 'DEMO', id: 'DEMO-RFC-001' } },
    acceptance_criteria: ['a'],
    definition_of_done: ['d'],
    risk_class: 'low',
  };
  const task = { ...base, ...overrides };
  writeFileSync(
    join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-001.json'),
    JSON.stringify(task)
  );
}

function loadTaskFromDisk(repoRoot: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-001.json'), 'utf-8')
  ) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Flow 1 — Clean two-pass
// ---------------------------------------------------------------------------

describe('Flow 1 — Clean two-pass', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = createTempRepo();
    // Seed: high-class task at automated-gates, verdict null
    writeBaseTask(repoRoot, {
      status: 'automated-gates',
      risk_class: 'high',
      security_class: 'high',
      security_review_verdict: null,
    });
  });

  afterEach(() => {
    __setMockChangedFiles(null);
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('clean two-pass: high task traverses security-review → automated-gates → ui-review', () => {
    // Step 1: automated-gates → security-review (unconditional; no security_gate on this edge)
    advanceStatus(repoRoot, 'DEMO-001', 'security-review', 'agent');
    expect(loadTaskFromDisk(repoRoot).status).toBe('security-review');

    // Step 2: set verdict=pass via CLI set-task-field
    const r2 = run(['set-task-field', repoRoot, 'DEMO-001', 'security_review_verdict', 'pass']);
    expect(r2.exitCode).toBe(0);

    // Step 3: security-review → automated-gates (unconditional edge; verdict preserved)
    advanceStatus(repoRoot, 'DEMO-001', 'automated-gates', 'agent');
    expect(loadTaskFromDisk(repoRoot).status).toBe('automated-gates');

    // Step 4: automated-gates → ui-review (security_gate=true; guard allows because verdict=pass)
    // Use empty mock diff so the security-classify doesn't upgrade the class.
    __setMockChangedFiles([]);
    advanceStatus(repoRoot, 'DEMO-001', 'ui-review', 'agent', { path: 'full_pipeline' });

    // Final assertions
    const task = loadTaskFromDisk(repoRoot);
    expect(task.status).toBe('ui-review');
    expect(task.security_review_verdict).toBe('pass');
  });
});

// ---------------------------------------------------------------------------
// Flow 2 — LOAD-BEARING dogfood reproduction (under-classification at the door)
// ---------------------------------------------------------------------------

describe('Flow 2 — Under-classification at the door (LOAD-BEARING dogfood)', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = createTempRepo();
    // Seed: low-declared task at automated-gates (under-classified)
    writeBaseTask(repoRoot, {
      status: 'automated-gates',
      risk_class: 'low',
      security_class: 'low',
      security_review_verdict: null,
    });
  });

  afterEach(() => {
    __setMockChangedFiles(null);
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('dogfood: low-declared task with sensitive diff is refused, upgraded, then recovers to merged', () => {
    // Inject a sensitive file so the diff-detect fires.
    // scripts/deploy.sh matches the "**/deploy*.sh" path pattern in the default security-paths config.
    __setMockChangedFiles(['scripts/deploy.sh']);

    // Attempt fast-lane merge: should fail with SECURITY_GATE because:
    // 1. Writeback fires: declared=low, effective=high → security_class upgraded to 'high'.
    // 2. Validator sees high+null → refuses.
    let caughtErr: (Error & { code?: string }) | null = null;
    try {
      advanceStatus(repoRoot, 'DEMO-001', 'merged', 'human', { gate: 'human_merge', path: 'fast_lane' });
    } catch (err) {
      caughtErr = err as Error & { code?: string };
    }

    expect(caughtErr).not.toBeNull();
    expect(caughtErr?.code).toBe('SECURITY_GATE');

    // The error message must contain the security-gate refusal text.
    expect(caughtErr?.message).toMatch(/security_review_verdict.*pass|security-gate/i);

    // Despite the refusal, the writeback must have fired: security_class should now be 'high'.
    const taskAfterRefusal = loadTaskFromDisk(repoRoot);
    expect(taskAfterRefusal.security_class).toBe('high');

    // Clear the sensitive mock — simulate clean diff for recovery.
    __setMockChangedFiles([]);

    // Recovery sequence:
    // 1) automated-gates → security-review (unconditional; no guard on this edge)
    advanceStatus(repoRoot, 'DEMO-001', 'security-review', 'agent');

    // 2) Set verdict=pass via CLI set-task-field
    const r2 = run(['set-task-field', repoRoot, 'DEMO-001', 'security_review_verdict', 'pass']);
    expect(r2.exitCode).toBe(0);

    // 3) security-review → automated-gates
    advanceStatus(repoRoot, 'DEMO-001', 'automated-gates', 'agent');

    // 4) Retry: automated-gates → merged (fast-lane). Verdict is now pass so guard allows.
    advanceStatus(repoRoot, 'DEMO-001', 'merged', 'human', { gate: 'human_merge', path: 'fast_lane' });

    // Final assertions
    const finalTask = loadTaskFromDisk(repoRoot);
    expect(finalTask.status).toBe('merged');
    expect(finalTask.security_review_verdict).toBe('pass');
  });
});

// ---------------------------------------------------------------------------
// Flow 3 — Rework reset
// ---------------------------------------------------------------------------

describe('Flow 3 — Rework reset', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = createTempRepo();
    // Seed: high task at review with verdict=pass (from a prior cycle)
    writeBaseTask(repoRoot, {
      status: 'review',
      risk_class: 'high',
      security_class: 'high',
      security_review_verdict: 'pass',
    });
  });

  afterEach(() => {
    __setMockChangedFiles(null);
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('rework reset: review → automated-gates resets verdict to null; next guarded advance refuses', () => {
    // Step 1: review → automated-gates (carries resets_security_verdict=true)
    advanceStatus(repoRoot, 'DEMO-001', 'automated-gates', 'agent');

    // Reload — verdict must now be null (reset fired)
    const taskAfterReset = loadTaskFromDisk(repoRoot);
    expect(taskAfterReset.security_review_verdict).toBe(null);

    // Step 2: attempt automated-gates → ui-review (security_gate=true)
    // verdict=null + high class → guard must refuse with SECURITY_GATE
    __setMockChangedFiles([]);
    let caughtErr: (Error & { code?: string }) | null = null;
    try {
      advanceStatus(repoRoot, 'DEMO-001', 'ui-review', 'agent', { path: 'full_pipeline' });
    } catch (err) {
      caughtErr = err as Error & { code?: string };
    }

    expect(caughtErr).not.toBeNull();
    expect(caughtErr?.code).toBe('SECURITY_GATE');
    expect(caughtErr?.message).toMatch(/security_review_verdict.*pass|security-gate/i);
  });
});

// ---------------------------------------------------------------------------
// Flow 4 — Blocker → escalated
// ---------------------------------------------------------------------------

describe('Flow 4 — Blocker → escalated', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = createTempRepo();
    // Seed: task at security-review (high class, no verdict yet)
    writeBaseTask(repoRoot, {
      status: 'security-review',
      risk_class: 'high',
      security_class: 'high',
      security_review_verdict: null,
    });
  });

  afterEach(() => {
    __setMockChangedFiles(null);
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('blocker: set verdict=escalate → advance to escalated; task is terminal', () => {
    // Step 1: set verdict=escalate via CLI set-task-field
    const r1 = run(['set-task-field', repoRoot, 'DEMO-001', 'security_review_verdict', 'escalate']);
    expect(r1.exitCode).toBe(0);

    // Step 2: security-review → escalated (allowed by the state machine for agent/human)
    advanceStatus(repoRoot, 'DEMO-001', 'escalated', 'agent');

    // Assertions: status=escalated, verdict=escalate
    const task = loadTaskFromDisk(repoRoot);
    expect(task.status).toBe('escalated');
    expect(task.security_review_verdict).toBe('escalate');

    // Confirm escalated is terminal: any further advance must fail (illegal transition).
    // The state machine has no outgoing guarded edges from escalated.
    let caughtErr: (Error & { code?: string }) | null = null;
    try {
      advanceStatus(repoRoot, 'DEMO-001', 'merged', 'human');
    } catch (err) {
      caughtErr = err as Error & { code?: string };
    }

    expect(caughtErr).not.toBeNull();
    // Must be an illegal-transition error, NOT a security-gate error.
    expect(caughtErr?.code).not.toBe('SECURITY_GATE');
    expect(caughtErr?.message.toLowerCase()).toMatch(/illegal|not allowed/);
  });
});

// ---------------------------------------------------------------------------
// Backward-compat — Field absent (0.8.0-era task)
// ---------------------------------------------------------------------------

describe('Backward-compat — security_review_verdict field absent', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = createTempRepo();
    // Seed: high task at review WITHOUT security_review_verdict property in JSON.
    const taskObj: Record<string, unknown> = {
      id: 'DEMO-001',
      type: 'task',
      status: 'review',
      owner: { kind: 'agent', id: 'unassigned' },
      project: 'DEMO',
      title: 'demo',
      context: { rfc: { project: 'DEMO', id: 'DEMO-RFC-001' } },
      acceptance_criteria: ['a'],
      definition_of_done: ['d'],
      risk_class: 'high',
      security_class: 'high',
      // NOTE: security_review_verdict intentionally absent (simulating 0.8.0-era task)
    };
    writeFileSync(
      join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-001.json'),
      JSON.stringify(taskObj)
    );
  });

  afterEach(() => {
    __setMockChangedFiles(null);
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('backward-compat: absent field treated as null on read; review → automated-gates writes null; guard then refuses', () => {
    // Verify the field is truly absent before advancing
    const rawBefore = loadTaskFromDisk(repoRoot);
    expect(Object.prototype.hasOwnProperty.call(rawBefore, 'security_review_verdict')).toBe(false);

    // Step 1: review → automated-gates (resets_security_verdict=true)
    // The reset writes security_review_verdict: null explicitly even though the field was absent.
    advanceStatus(repoRoot, 'DEMO-001', 'automated-gates', 'agent');

    // Reload — the reset must have written null explicitly
    const taskAfterReset = loadTaskFromDisk(repoRoot);
    expect(taskAfterReset.security_review_verdict).toBe(null);

    // Step 2: attempt guarded advance; verdict is null + class=high → guard must refuse
    __setMockChangedFiles([]);
    let caughtErr: (Error & { code?: string }) | null = null;
    try {
      advanceStatus(repoRoot, 'DEMO-001', 'ui-review', 'agent', { path: 'full_pipeline' });
    } catch (err) {
      caughtErr = err as Error & { code?: string };
    }

    expect(caughtErr).not.toBeNull();
    expect(caughtErr?.code).toBe('SECURITY_GATE');
    expect(caughtErr?.message).toMatch(/security_review_verdict.*pass|security-gate/i);
  });
});
