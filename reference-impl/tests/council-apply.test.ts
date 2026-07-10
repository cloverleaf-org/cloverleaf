import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyCouncilVerdict, resolveCouncilPlan } from '../lib/council.js';
import { loadTask } from '../lib/task.js';
import { aggregate } from '../lib/aggregation.js';
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
  it('throws for a gate other than task.review (Minor 1 — gate guard)', () => {
    const r = repoWithReviewTask('high');
    expect(() =>
      applyCouncilVerdict(r, 'DEMO-001', 'plan.review', V('pass', [{ member: 'reviewer', verdict: 'pass' }])),
    ).toThrow(/not supported yet|task\.review/);
  });
});

describe('opt-in integration (council-plan → aggregate → apply)', () => {
  it('no council.json → source default, orchestrator would take today\'s path', () => {
    const r = repoWithReviewTask('high');
    expect(resolveCouncilPlan(r, 'DEMO-001', 'task.review', { changedFiles: [] }).source).toBe('default');
  });
  it('consumer council.json (drop ui+security, qa+reviewer only) → council passes to final-gate', () => {
    const r = repoWithReviewTask('high', 'high'); // security-HIGH + security dropped → proves topology-B through the gate
    mkdirSync(join(r, '.cloverleaf', 'config'), { recursive: true });
    writeFileSync(join(r, '.cloverleaf', 'config', 'council.json'), JSON.stringify({
      profiles: { lean: { rounds: [[{ member: 'reviewer' }, { member: 'qa' }]], aggregation: 'any-veto' } },
      gates: { 'task.review': 'lean' },
    }));
    const plan = resolveCouncilPlan(r, 'DEMO-001', 'task.review', { changedFiles: [] });
    expect(plan.source).toBe('consumer');
    const members = plan.rounds.flat().map((m) => ({ member: m.member, verdict: 'pass' as const, blocking: m.blocking, weight: m.weight }));
    const verdict = aggregate(members, plan.aggregation as import('../lib/aggregation.js').ThresholdRule);
    expect(verdict.verdict).toBe('pass');
    const res = applyCouncilVerdict(r, 'DEMO-001', 'task.review', verdict);
    expect(loadTask(r, 'DEMO-001').status).toBe('final-gate');
    expect(res.security.member_verdict).toBe('absent'); // security deliberately dropped — topology-B
  });
});

describe('walk_note — administrative qa traversal (F5)', () => {
  it('full lane with qa OMITTED from members → walk_note set', () => {
    const r = repoWithReviewTask('high');
    const res = applyCouncilVerdict(r, 'DEMO-001', 'task.review', V('pass', [{ member: 'reviewer', verdict: 'pass' }]));
    expect(res.walk).toContain('qa');
    expect(res.walk_note).toBe('qa state traversed administratively; no qa member ran');
  });
  it('full lane with qa AS a member → walk_note undefined', () => {
    const r = repoWithReviewTask('high');
    const res = applyCouncilVerdict(r, 'DEMO-001', 'task.review',
      V('pass', [{ member: 'reviewer', verdict: 'pass' }, { member: 'qa', verdict: 'pass' }]));
    expect(res.walk_note).toBeUndefined();
  });
  it('fast lane → walk_note undefined', () => {
    const r = repoWithReviewTask('low');
    const res = applyCouncilVerdict(r, 'DEMO-001', 'task.review', V('pass', [{ member: 'reviewer', verdict: 'pass' }]));
    expect(res.walk_note).toBeUndefined();
  });
});

describe('applyCouncilVerdict — chair verdicts (Slice 2)', () => {
  it('records rule=chair and the forwarded members on a bounce', () => {
    const r = repoWithReviewTask('high');
    const res = applyCouncilVerdict(r, 'DEMO-001', 'task.review', {
      verdict: 'bounce', rule: 'chair', rationale: 'address security',
      members: [{ member: 'reviewer', verdict: 'pass' }, { member: 'security', verdict: 'bounce' }],
      forward: ['security'],
    });
    expect(loadTask(r, 'DEMO-001').status).toBe('implementing');
    expect(res.rule).toBe('chair');
    expect(res.forward).toEqual(['security']);
    expect(readCouncilResult(r, 'DEMO-001', 'task.review')?.forward).toEqual(['security']);
  });
  it('a chair pass records rule=chair and no forward', () => {
    const r = repoWithReviewTask('low');
    const res = applyCouncilVerdict(r, 'DEMO-001', 'task.review', {
      verdict: 'pass', rule: 'chair', rationale: 'all clear',
      members: [{ member: 'reviewer', verdict: 'pass' }],
    });
    expect(res.rule).toBe('chair');
    expect(res.forward).toBeUndefined();
    expect(loadTask(r, 'DEMO-001').status).toBe('automated-gates');
  });
});
