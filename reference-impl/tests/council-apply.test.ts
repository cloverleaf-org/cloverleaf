import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyCouncilVerdict, resolveCouncilPlan, GATE_DESCRIPTORS } from '../lib/council.js';
import { loadTask } from '../lib/task.js';
import { aggregate } from '../lib/aggregation.js';
import { readCouncilResult } from '../lib/council-result.js';
import type { CouncilVerdict } from '../lib/aggregation.js';

// A task parked at the collapsed `council` state (task.review runs here now).
function repoWithCouncilTask(risk: 'low' | 'high' = 'low', securityClass: 'low' | 'high' = 'low'): string {
  return repoWithTaskAt('council', risk, securityClass);
}

function repoWithTaskAt(status: string, risk: 'low' | 'high' = 'low', securityClass: 'low' | 'high' = 'low'): string {
  const repoRoot = mkdtempSync(join(tmpdir(), 'clv-apply-'));
  mkdirSync(join(repoRoot, '.cloverleaf', 'tasks'), { recursive: true });
  mkdirSync(join(repoRoot, '.cloverleaf', 'events'), { recursive: true });
  writeFileSync(
    join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-001.json'),
    JSON.stringify({
      id: 'DEMO-001', type: 'task', status, project: 'DEMO', title: 't',
      owner: { kind: 'agent', id: 'unassigned' }, context: { rfc: { project: 'DEMO', id: 'DEMO-RFC-001' } },
      acceptance_criteria: ['a'], definition_of_done: ['d'], risk_class: risk, security_class: securityClass,
    }),
  );
  return repoRoot;
}
const V = (verdict: CouncilVerdict['verdict'], members: CouncilVerdict['members']): CouncilVerdict =>
  ({ verdict, rule: 'any-veto', rationale: `${verdict}`, members });

describe('applyCouncilVerdict — decisive delivery (task.review at council)', () => {
  it('low-security pass walks council → final-gate, no gating verdict set, writes artifact', () => {
    const r = repoWithCouncilTask('low', 'low');
    const res = applyCouncilVerdict(r, 'DEMO-001', 'task.review', V('pass', [{ member: 'reviewer', verdict: 'pass' }]));
    expect(loadTask(r, 'DEMO-001').status).toBe('final-gate');
    expect(res.walk).toEqual(['council', 'final-gate']);
    expect(res.security?.gating_verdict_set).toBeNull(); // low-security → backstop not triggered
    expect(loadTask(r, 'DEMO-001').security_review_verdict).toBeUndefined();
    expect(readCouncilResult(r, 'DEMO-001', 'task.review')?.final_verdict).toBe('pass');
  });
  it('decisive delivery pass walks council → final-gate and records security pass for a high task', () => {
    const r = repoWithCouncilTask('high', 'high');
    const result = applyCouncilVerdict(r, 'DEMO-001', 'task.review', {
      verdict: 'pass', rule: 'any-veto', rationale: 'ok',
      members: [{ member: 'reviewer', verdict: 'pass' }, { member: 'security', verdict: 'pass' }],
    });
    expect(result.walk).toEqual(['council', 'final-gate']);
    expect(loadTask(r, 'DEMO-001').status).toBe('final-gate');
    expect(loadTask(r, 'DEMO-001').security_review_verdict).toBe('pass');
    expect(result.security?.gating_verdict_set).toBe('pass');
  });
  it('decisive delivery bounce walks council → implementing', () => {
    const r = repoWithCouncilTask('high');
    const result = applyCouncilVerdict(r, 'DEMO-001', 'task.review', {
      verdict: 'bounce', rule: 'any-veto', rationale: 'fix', members: [{ member: 'reviewer', verdict: 'bounce' }],
    });
    expect(result.walk).toEqual(['council', 'implementing']);
    expect(loadTask(r, 'DEMO-001').status).toBe('implementing');
  });
  it('a delivery escalate is un-lowerable: council → escalated', () => {
    const r = repoWithCouncilTask('high', 'high');
    const result = applyCouncilVerdict(r, 'DEMO-001', 'task.review', {
      verdict: 'escalate', rule: 'any-veto', rationale: 'leaked credential',
      members: [{ member: 'security', verdict: 'escalate' }, { member: 'reviewer', verdict: 'pass' }],
    });
    expect(result.walk).toEqual(['council', 'escalated']);
    expect(loadTask(r, 'DEMO-001').status).toBe('escalated');
  });
  it('high-security pass with security OMITTED still reaches final-gate + backstop set (topology-B)', () => {
    const r = repoWithCouncilTask('high', 'high'); // security-HIGH task, no security member
    applyCouncilVerdict(r, 'DEMO-001', 'task.review', V('pass', [{ member: 'reviewer', verdict: 'pass' }]));
    const res = readCouncilResult(r, 'DEMO-001', 'task.review');
    expect(loadTask(r, 'DEMO-001').status).toBe('final-gate');
    expect(loadTask(r, 'DEMO-001').security_review_verdict).toBe('pass');
    expect(res?.security?.member_verdict).toBe('absent');
    expect(res?.security?.basis).toContain('no security member');
    expect(res?.security?.gating_verdict_set).toBe('pass');
  });
  it('high-security pass with security OUT-VOTED records the override + still sets backstop', () => {
    const r = repoWithCouncilTask('high', 'high'); // gate satisfied by council authority
    applyCouncilVerdict(r, 'DEMO-001', 'task.review',
      { verdict: 'pass', rule: 'majority', rationale: 'majority', members: [
        { member: 'reviewer', verdict: 'pass' }, { member: 'security', verdict: 'bounce' }] });
    expect(loadTask(r, 'DEMO-001').status).toBe('final-gate');
    expect(loadTask(r, 'DEMO-001').security_review_verdict).toBe('pass');
    const res = readCouncilResult(r, 'DEMO-001', 'task.review');
    expect(res?.security?.member_verdict).toBe('bounce');
    expect(res?.security?.gating_verdict_set).toBe('pass');
  });
  it("throws if the task is not in council", () => {
    const r = repoWithTaskAt('implementing');
    expect(() => applyCouncilVerdict(r, 'DEMO-001', 'task.review', V('pass', [{ member: 'reviewer', verdict: 'pass' }]))).toThrow(/expected 'council'/);
  });
  it('throws for an unknown gate, listing the supported gates', () => {
    const r = repoWithCouncilTask('high');
    expect(() =>
      applyCouncilVerdict(r, 'DEMO-001', 'plan.review', V('pass', [{ member: 'reviewer', verdict: 'pass' }])),
    ).toThrow(/not supported; supported gates: task\.review/);
  });
});

describe('applyCouncilVerdict — decisive plan_review (task.plan_review at tactical-plan)', () => {
  it('decisive plan_review bounce sends tactical-plan → pending', () => {
    const r = repoWithTaskAt('tactical-plan', 'high');
    const result = applyCouncilVerdict(r, 'DEMO-001', 'task.plan_review', {
      verdict: 'bounce', rule: 'any-veto', rationale: 'reshape', members: [{ member: 'reviewer', verdict: 'bounce' }],
    });
    expect(result.walk).toEqual(['tactical-plan', 'pending']);
    expect(loadTask(r, 'DEMO-001').status).toBe('pending');
    // plan_review is a plan-shape (no code) gate: no security block on the result.
    expect(result.security).toBeUndefined();
  });
  it('decisive plan_review pass sends tactical-plan → implementing', () => {
    const r = repoWithTaskAt('tactical-plan', 'high');
    const result = applyCouncilVerdict(r, 'DEMO-001', 'task.plan_review', V('pass', [{ member: 'reviewer', verdict: 'pass' }]));
    expect(result.walk).toEqual(['tactical-plan', 'implementing']);
    expect(loadTask(r, 'DEMO-001').status).toBe('implementing');
  });
  it('a plan_review escalate is un-lowerable: tactical-plan → escalated', () => {
    const r = repoWithTaskAt('tactical-plan', 'high');
    const result = applyCouncilVerdict(r, 'DEMO-001', 'task.plan_review', V('escalate', [{ member: 'reviewer', verdict: 'escalate' }]));
    expect(result.walk).toEqual(['tactical-plan', 'escalated']);
    expect(loadTask(r, 'DEMO-001').status).toBe('escalated');
  });
  it('throws if the task is not in tactical-plan for a plan_review verdict', () => {
    const r = repoWithTaskAt('implementing');
    expect(() => applyCouncilVerdict(r, 'DEMO-001', 'task.plan_review', V('pass', [{ member: 'reviewer', verdict: 'pass' }])))
      .toThrow(/expected 'tactical-plan'/);
  });
});

describe('opt-in integration (council-plan → aggregate → apply)', () => {
  it('no council.json → source default, orchestrator would take today\'s path', () => {
    const r = repoWithCouncilTask('high');
    expect(resolveCouncilPlan(r, 'DEMO-001', 'task.review', { changedFiles: [] }).source).toBe('default');
  });
  it('consumer council.json (drop ui+security, qa+reviewer only) → council passes to final-gate', () => {
    const r = repoWithCouncilTask('high', 'high'); // security-HIGH + security dropped → proves topology-B through the gate
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
    expect(res.security?.member_verdict).toBe('absent'); // security deliberately dropped — topology-B
    expect(res.security?.gating_verdict_set).toBe('pass'); // high-security backstop still fired
  });
});

describe('applyCouncilVerdict — chair verdicts (Slice 2)', () => {
  it('records rule=chair and the forwarded members on a bounce', () => {
    const r = repoWithCouncilTask('high');
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
    const r = repoWithCouncilTask('low');
    const res = applyCouncilVerdict(r, 'DEMO-001', 'task.review', {
      verdict: 'pass', rule: 'chair', rationale: 'all clear',
      members: [{ member: 'reviewer', verdict: 'pass' }],
    });
    expect(res.rule).toBe('chair');
    expect(res.forward).toBeUndefined();
    expect(loadTask(r, 'DEMO-001').status).toBe('final-gate');
  });
});

describe('applyCouncilVerdict — gate-aware routing (Slice 4)', () => {
  it('exposes descriptors for the five supported gates', () => {
    expect(Object.keys(GATE_DESCRIPTORS).sort()).toEqual(
      ['plan.task_batch', 'rfc.strategy_gate', 'task.final_gate', 'task.plan_review', 'task.review'],
    );
    expect(GATE_DESCRIPTORS['task.final_gate']).toEqual({ state: 'final-gate', advisoryOnly: true });
  });
  it('unknown gate throws listing the supported gates', () => {
    const r = repoWithCouncilTask('high');
    expect(() => applyCouncilVerdict(r, 'DEMO-001', 'plan.strategy', V('pass', [{ member: 'reviewer', verdict: 'pass' }])))
      .toThrow(/not supported; supported gates: task\.review, task\.plan_review, task\.final_gate, plan\.task_batch, rfc\.strategy_gate/);
  });
  it('task.final_gate routes to advisory posting (no transition)', () => {
    const r = repoWithTaskAt('final-gate', 'high');
    const res = applyCouncilVerdict(r, 'DEMO-001', 'task.final_gate', V('pass', [{ member: 'reviewer', verdict: 'pass' }]));
    expect(res.mode).toBe('advisory');
    expect(res.security).toBeUndefined();
    expect(loadTask(r, 'DEMO-001').status).toBe('final-gate');
  });
  it('resolveCouncilPlan forces advisory mode for an advisory-only gate bound decisive (D4)', () => {
    const r = repoWithCouncilTask('high');
    mkdirSync(join(r, '.cloverleaf', 'config'), { recursive: true });
    writeFileSync(join(r, '.cloverleaf', 'config', 'council.json'), JSON.stringify({
      profiles: { fg: { rounds: [[{ member: 'reviewer' }, { member: 'qa' }]], aggregation: 'any-veto' } },
      gates: { 'task.final_gate': { profile: 'fg', mode: 'decisive' } },
    }));
    const plan = resolveCouncilPlan(r, 'DEMO-001', 'task.final_gate', { changedFiles: [] });
    expect(plan.mode).toBe('advisory');
    expect(plan.profile).toBe('fg');
  });
});
