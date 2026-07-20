/**
 * Integration tests for the v0.8.1 security guarantee in the COLLAPSED council FSM.
 *
 * The mechanical security-gate (the FSM `security_gate` annotation on
 * automated-gates → ui-review and the review → automated-gates verdict reset)
 * is RETIRED (KD1). The guarantee is now carried by:
 *   1. the B4 writeback at `documenting → council` (a declared-low task whose diff
 *      touches a sensitive path is upgraded to security_class:high), and
 *   2. the delivery council's blocking `security` member + the applyCouncilVerdict
 *      backstop that records security_review_verdict='pass' at final-gate.
 *
 * The blocking-member / backstop / un-lowerable-escalate mechanics are unit-tested
 * in council-security.test.ts; this file drives the end-to-end integration (writeback
 * at the door → council → final-gate; a security escalate → escalated).
 *
 * Uses __setMockChangedFiles to inject diffs deterministically (in-process, so we
 * call advanceStatus() directly rather than via the CLI child process).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { advanceStatus, loadTask } from '../lib/task.js';
import { applyCouncilVerdict, resolveCouncilPlan } from '../lib/council.js';
import { aggregate } from '../lib/aggregation.js';
import { __setMockChangedFiles } from '../lib/security-classify.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// Under-classification at the door (LOAD-BEARING dogfood, rewritten for the collapse)
// ---------------------------------------------------------------------------

describe('Under-classification at the door (LOAD-BEARING dogfood)', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = createTempRepo();
    // Seed: low-declared task at documenting (under-classified), one step before council.
    writeBaseTask(repoRoot, {
      status: 'documenting',
      risk_class: 'low',
      security_class: 'low',
      security_review_verdict: null,
    });
  });

  afterEach(() => {
    __setMockChangedFiles(null);
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('dogfood: a sensitive diff upgrades security_class to high at documenting → council; the security member then blocks and the passing council reaches final-gate', () => {
    // Inject a sensitive file so the diff-detect fires.
    // scripts/deploy.sh matches the "**/deploy*.sh" path pattern in the default security-paths config.
    __setMockChangedFiles(['scripts/deploy.sh']);

    // documenting → council: the B4 writeback fires because declared=low, effective=high,
    // upgrading security_class to 'high'. No mechanical gate refuses this (KD1); the upgrade
    // is what arms the blocking security member for the delivery council.
    advanceStatus(repoRoot, 'DEMO-001', 'council', 'agent');

    const upgraded = loadTaskFromDisk(repoRoot);
    expect(upgraded.status).toBe('council');
    expect(upgraded.security_class).toBe('high');

    // The council plan now includes the blocking `security` member (delivery-fast round 2,
    // when security_class:high). This is the guarantee: an under-classified sensitive diff
    // is caught by the security member rather than a mechanical FSM gate.
    const plan = resolveCouncilPlan(repoRoot, 'DEMO-001', 'task.review', { changedFiles: ['scripts/deploy.sh'] });
    const security = plan.rounds.flat().find((m) => m.member === 'security');
    expect(security).toBeDefined();
    expect(security?.blocking).toBe(true);

    // The security member passes; the council passes → council → final-gate, and the
    // backstop records security_review_verdict='pass' for the (now-high) task.
    const verdict = aggregate(
      [{ member: 'reviewer', verdict: 'pass' }, { member: 'security', verdict: 'pass' }],
      'any-veto',
      {},
    );
    expect(verdict.verdict).toBe('pass');
    const res = applyCouncilVerdict(repoRoot, 'DEMO-001', 'task.review', verdict);
    expect(res.walk).toEqual(['council', 'final-gate']);

    const finalTask = loadTaskFromDisk(repoRoot);
    expect(finalTask.status).toBe('final-gate');
    expect(finalTask.security_review_verdict).toBe('pass');
  });
});

// ---------------------------------------------------------------------------
// Blocker → escalated (rewritten for the collapse: the security member escalates)
// ---------------------------------------------------------------------------

describe('Blocker → escalated', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = createTempRepo();
    // Seed: high task parked at the collapsed `council` state.
    writeBaseTask(repoRoot, {
      status: 'council',
      risk_class: 'high',
      security_class: 'high',
      security_review_verdict: null,
    });
  });

  afterEach(() => {
    __setMockChangedFiles(null);
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('blocker: a security escalate is un-lowerable → council drives the task to escalated; terminal', () => {
    // The security member returns escalate (a hard blocker). An escalate short-circuits
    // aggregation regardless of the other members, and applyCouncilVerdict drives
    // council → escalated.
    const verdict = aggregate(
      [{ member: 'reviewer', verdict: 'pass' }, { member: 'security', verdict: 'escalate' }],
      'any-veto',
      {},
    );
    expect(verdict.verdict).toBe('escalate');
    const res = applyCouncilVerdict(repoRoot, 'DEMO-001', 'task.review', verdict);
    expect(res.walk).toEqual(['council', 'escalated']);
    expect(loadTask(repoRoot, 'DEMO-001').status).toBe('escalated');

    // Confirm escalated is terminal: any further advance must fail (illegal transition).
    let caughtErr: (Error & { code?: string }) | null = null;
    try {
      advanceStatus(repoRoot, 'DEMO-001', 'merged', 'human');
    } catch (err) {
      caughtErr = err as Error & { code?: string };
    }
    expect(caughtErr).not.toBeNull();
    expect(caughtErr?.code).not.toBe('SECURITY_GATE');
    expect(caughtErr?.message.toLowerCase()).toMatch(/illegal|not allowed/);
  });
});
