import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyCouncilVerdict } from '../lib/council.js';
import { loadTask } from '../lib/task.js';
import { readCouncilResult } from '../lib/council-result.js';
import type { CouncilVerdict } from '../lib/aggregation.js';

function repoWithReviewTask(risk: 'low' | 'high', securityClass: 'low' | 'high' = 'low'): string {
  const repoRoot = mkdtempSync(join(tmpdir(), 'clv-apply-'));
  mkdirSync(join(repoRoot, '.cloverleaf', 'tasks'), { recursive: true });
  mkdirSync(join(repoRoot, '.cloverleaf', 'events'), { recursive: true });
  writeFileSync(
    join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-001.json'),
    JSON.stringify({
      id: 'DEMO-001', type: 'task', status: 'review', project: 'DEMO', title: 't',
      owner: { kind: 'agent', id: 'unassigned' }, context: { rfc: { project: 'DEMO', id: 'DEMO-RFC-001' } },
      acceptance_criteria: ['a'], definition_of_done: ['d'], risk_class: risk, security_class: securityClass,
    }),
  );
  return repoRoot;
}
const V = (verdict: CouncilVerdict['verdict'], members: CouncilVerdict['members']): CouncilVerdict =>
  ({ verdict, rule: 'any-veto', rationale: `${verdict}`, members });

describe('applyCouncilVerdict', () => {
  it('fast lane pass → automated-gates, sets gating verdict, writes artifact', () => {
    const r = repoWithReviewTask('low');
    const res = applyCouncilVerdict(r, 'DEMO-001', 'task.review', V('pass', [{ member: 'reviewer', verdict: 'pass' }]));
    expect(loadTask(r, 'DEMO-001').status).toBe('automated-gates');
    expect(loadTask(r, 'DEMO-001').security_review_verdict).toBe('pass');
    expect(res.walk).toEqual(['review', 'automated-gates']);
    expect(readCouncilResult(r, 'DEMO-001', 'task.review')?.final_verdict).toBe('pass');
  });
  it('full pipeline pass → final-gate via qa', () => {
    const r = repoWithReviewTask('high');
    const res = applyCouncilVerdict(r, 'DEMO-001', 'task.review', V('pass', [{ member: 'reviewer', verdict: 'pass' }, { member: 'qa', verdict: 'pass' }]));
    expect(loadTask(r, 'DEMO-001').status).toBe('final-gate');
    expect(res.walk).toEqual(['review', 'automated-gates', 'qa', 'final-gate']);
  });
  it('full pipeline pass with security OMITTED still reaches final-gate (topology-B)', () => {
    const r = repoWithReviewTask('high', 'high'); // security-HIGH task: genuinely exercises the v0.8.1 gate
    applyCouncilVerdict(r, 'DEMO-001', 'task.review', V('pass', [{ member: 'reviewer', verdict: 'pass' }, { member: 'qa', verdict: 'pass' }]));
    const res = readCouncilResult(r, 'DEMO-001', 'task.review');
    expect(loadTask(r, 'DEMO-001').status).toBe('final-gate');
    expect(res?.security.member_verdict).toBe('absent');
    expect(res?.security.basis).toContain('no security member');
  });
  it('full pipeline pass with security OUT-VOTED records the override', () => {
    const r = repoWithReviewTask('high', 'high'); // security-HIGH task: gate satisfied by council authority
    applyCouncilVerdict(r, 'DEMO-001', 'task.review',
      { verdict: 'pass', rule: 'majority', rationale: 'majority', members: [
        { member: 'reviewer', verdict: 'pass' }, { member: 'qa', verdict: 'pass' }, { member: 'security', verdict: 'bounce' }] });
    expect(loadTask(r, 'DEMO-001').status).toBe('final-gate');
    expect(readCouncilResult(r, 'DEMO-001', 'task.review')?.security.member_verdict).toBe('bounce');
  });
  it('bounce → implementing', () => {
    const r = repoWithReviewTask('high');
    applyCouncilVerdict(r, 'DEMO-001', 'task.review', V('bounce', [{ member: 'reviewer', verdict: 'bounce' }]));
    expect(loadTask(r, 'DEMO-001').status).toBe('implementing');
  });
  it('escalate → escalated', () => {
    const r = repoWithReviewTask('high');
    applyCouncilVerdict(r, 'DEMO-001', 'task.review', V('escalate', [{ member: 'security', verdict: 'escalate' }]));
    expect(loadTask(r, 'DEMO-001').status).toBe('escalated');
  });
  it('throws if the task is not in review', () => {
    const r = repoWithReviewTask('high');
    const t = loadTask(r, 'DEMO-001'); t.status = 'implementing';
    writeFileSync(join(r, '.cloverleaf', 'tasks', 'DEMO-001.json'), JSON.stringify(t));
    expect(() => applyCouncilVerdict(r, 'DEMO-001', 'task.review', V('pass', [{ member: 'reviewer', verdict: 'pass' }]))).toThrow(/expected 'review'/);
  });
});
