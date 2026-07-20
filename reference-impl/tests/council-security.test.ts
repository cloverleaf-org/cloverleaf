import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveCouncilPlan, applyCouncilVerdict } from '../lib/council.js';
import { aggregate } from '../lib/aggregation.js';
import { loadTask } from '../lib/task.js';

const base = {
  type: 'task', project: 'DEMO', title: 't', owner: { kind: 'agent', id: 'x' },
  context: { rfc: { project: 'DEMO', id: 'DEMO-1' } }, acceptance_criteria: ['a'], definition_of_done: ['d'],
};
function repoWithTask(task: Record<string, unknown>): string {
  const repo = mkdtempSync(join(tmpdir(), 'clv-sec-'));
  mkdirSync(join(repo, '.cloverleaf', 'tasks'), { recursive: true });
  mkdirSync(join(repo, '.cloverleaf', 'events'), { recursive: true });
  writeFileSync(join(repo, '.cloverleaf', 'tasks', `${task.id}.json`), JSON.stringify(task));
  return repo;
}

describe('v0.8.1 security guarantee survives the collapse (KD1)', () => {
  it('the high lane makes security a blocking member', () => {
    const repo = repoWithTask({ ...base, id: 'SEC-001', status: 'council', risk_class: 'high', security_class: 'high' });
    const plan = resolveCouncilPlan(repo, 'SEC-001', 'task.review', { changedFiles: ['src/x.ts'] });
    expect(plan.rounds.flat().find((m) => m.member === 'security')?.blocking).toBe(true);
    rmSync(repo, { recursive: true, force: true });
  });

  it('a high task cannot reach final-gate when the security member bounces', () => {
    const repo = repoWithTask({ ...base, id: 'SEC-002', status: 'council', risk_class: 'high', security_class: 'high' });
    const verdict = aggregate([{ member: 'reviewer', verdict: 'pass' }, { member: 'security', verdict: 'bounce' }], 'any-veto', {});
    expect(verdict.verdict).toBe('bounce');
    const r = applyCouncilVerdict(repo, 'SEC-002', 'task.review', verdict);
    expect(r.walk).toEqual(['council', 'implementing']);
    expect(loadTask(repo, 'SEC-002').status).toBe('implementing');
    rmSync(repo, { recursive: true, force: true });
  });

  it('a security escalate is un-lowerable: the task escalates', () => {
    const repo = repoWithTask({ ...base, id: 'SEC-003', status: 'council', risk_class: 'high', security_class: 'high' });
    const verdict = aggregate([{ member: 'reviewer', verdict: 'pass' }, { member: 'security', verdict: 'escalate' }], 'any-veto', {});
    expect(verdict.verdict).toBe('escalate');
    applyCouncilVerdict(repo, 'SEC-003', 'task.review', verdict);
    expect(loadTask(repo, 'SEC-003').status).toBe('escalated');
    rmSync(repo, { recursive: true, force: true });
  });

  it('a passing high task records security_review_verdict=pass at final-gate (backstop)', () => {
    const repo = repoWithTask({ ...base, id: 'SEC-004', status: 'council', risk_class: 'high', security_class: 'high' });
    const r = applyCouncilVerdict(repo, 'SEC-004', 'task.review', {
      verdict: 'pass', rule: 'any-veto', rationale: 'ok',
      members: [{ member: 'reviewer', verdict: 'pass' }, { member: 'security', verdict: 'pass' }],
    });
    expect(loadTask(repo, 'SEC-004').status).toBe('final-gate');
    expect(loadTask(repo, 'SEC-004').security_review_verdict).toBe('pass');
    expect(r.security!.gating_verdict_set).toBe('pass');
    rmSync(repo, { recursive: true, force: true });
  });
});
