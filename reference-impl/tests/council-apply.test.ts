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
    const r = repoWithCouncilTask('high', 'high'); // security-HIGH task; no security verdict reported
    applyCouncilVerdict(r, 'DEMO-001', 'task.review', V('pass', [{ member: 'reviewer', verdict: 'pass' }]));
    const res = readCouncilResult(r, 'DEMO-001', 'task.review');
    expect(loadTask(r, 'DEMO-001').status).toBe('final-gate');
    expect(loadTask(r, 'DEMO-001').security_review_verdict).toBe('pass');
    expect(res?.security?.member_verdict).toBe('absent');
    // The shipped delivery-full profile DOES configure a security member for a
    // security_class:high task, so "no security member configured" would be false here —
    // one was configured and simply never reported.
    expect(res?.security?.basis).toBe('security member configured for this task but did not run; no security verdict recorded');
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

// `council.members` names only the members that *ran*, so a missing security verdict
// used to render identically whether the profile configured a security member or not.
// The basis is now classified against the profile's resolved plan.
describe('applyCouncilVerdict — security.basis states only what the run can prove', () => {
  // A security member the plan does not name is either absent from the profile or excluded
  // by its `when` predicate; the plan cannot tell those apart, so the string claims only
  // what it knows — that none is in *this task's* resolved plan. The trailing clause states
  // what the council actually did, since on a bounce nothing advanced.
  const NOT_IN_PLAN = "no security member in this task's resolved council plan";

  it('distinguishes a configured-but-unreached security member from an unconfigured one', () => {
    // delivery-full (risk high) puts a blocking security member in round 2 for a
    // security_class:high task; a round-1 bounce with on_round_bounce=stop means it never ran.
    const r = repoWithCouncilTask('high', 'high');
    const res = applyCouncilVerdict(r, 'DEMO-001', 'task.review', V('bounce', [{ member: 'reviewer', verdict: 'bounce' }]));
    expect(res.security?.member_verdict).toBe('absent');
    expect(res.security?.basis).not.toContain('no security member configured');
    expect(res.security?.basis).toMatch(/not reached|did not run/i);
    expect(res.security?.basis).toMatch(/earlier round/i);
    // the artifact on disk is the record a human reads; it must say the same thing
    expect(readCouncilResult(r, 'DEMO-001', 'task.review')?.security?.basis).toBe(res.security?.basis);
  });

  it('does not blame an earlier round when every member that ran passed', () => {
    // Same profile, so security is planned and absent — but nothing bounced, so the
    // stop-on-round-bounce explanation would be a fabrication.
    const r = repoWithCouncilTask('high', 'high');
    const res = applyCouncilVerdict(r, 'DEMO-001', 'task.review', V('pass', [{ member: 'reviewer', verdict: 'pass' }]));
    expect(res.security?.basis).toMatch(/did not run/i);
    expect(res.security?.basis).not.toMatch(/earlier round/i);
  });

  it('names the escalate short-circuit when a member escalated', () => {
    const r = repoWithCouncilTask('high', 'high');
    const res = applyCouncilVerdict(r, 'DEMO-001', 'task.review', V('escalate', [{ member: 'reviewer', verdict: 'escalate' }]));
    expect(loadTask(r, 'DEMO-001').status).toBe('escalated');
    expect(res.security?.basis).toMatch(/not reached/i);
    expect(res.security?.basis).toMatch(/escalated and the council short-circuited/i);
  });

  it('does not blame an earlier round when only a NON-blocking member bounced', () => {
    // reviewer is in round 1 of delivery-full, strictly earlier than security's round 2, so
    // only the blocking flag stands between this and a causal claim. A non-blocking bounce
    // does not stop the council, so it cannot explain the absence.
    const r = repoWithCouncilTask('high', 'high');
    const res = applyCouncilVerdict(r, 'DEMO-001', 'task.review',
      V('pass', [{ member: 'reviewer', verdict: 'bounce', blocking: false }]));
    expect(res.security?.basis).toMatch(/did not run/i);
    expect(res.security?.basis).not.toMatch(/earlier round|short-circuit/i);
  });

  it('does not blame a stop rule fired by a member in the SAME round as security', () => {
    // Round 0 dispatches reviewer and security concurrently. A blocking reviewer bounce stops
    // the council "before the next round" — it cannot un-dispatch security, which was already
    // running. So the absence is an anomaly (a lost envelope), and blaming an earlier round
    // points the auditor away from it.
    const r = repoWithCouncilTask('high', 'high');
    mkdirSync(join(r, '.cloverleaf', 'config'), { recursive: true });
    writeFileSync(join(r, '.cloverleaf', 'config', 'council.json'), JSON.stringify({
      profiles: { samestop: {
        rounds: [[{ member: 'reviewer' }, { member: 'security' }]],
        aggregation: 'any-veto', on_round_bounce: 'stop',
      } },
      gates: { 'task.review': 'samestop' },
    }));
    const res = applyCouncilVerdict(r, 'DEMO-001', 'task.review', V('bounce', [{ member: 'reviewer', verdict: 'bounce' }]));
    expect(res.security?.basis).toMatch(/did not run/i);
    expect(res.security?.basis).not.toMatch(/earlier round/i);
  });

  it('does not blame an escalate from a round AFTER security', () => {
    // If round 2 ran at all, security's round 1 completed — so a round-2 escalate cannot
    // explain a missing security verdict, and naming it hides the real anomaly.
    const r = repoWithCouncilTask('high', 'high');
    mkdirSync(join(r, '.cloverleaf', 'config'), { recursive: true });
    writeFileSync(join(r, '.cloverleaf', 'config', 'council.json'), JSON.stringify({
      profiles: { late: {
        rounds: [[{ member: 'reviewer' }], [{ member: 'security' }], [{ member: 'qa' }]],
        aggregation: 'any-veto', on_round_bounce: 'stop',
      } },
      gates: { 'task.review': 'late' },
    }));
    const res = applyCouncilVerdict(r, 'DEMO-001', 'task.review',
      V('escalate', [{ member: 'reviewer', verdict: 'pass' }, { member: 'qa', verdict: 'escalate' }]));
    expect(res.security?.basis).toMatch(/did not run/i);
    expect(res.security?.basis).not.toMatch(/short-circuit/i);
  });

  it('does not blame an earlier round when the profile continues past a bounce', () => {
    const r = repoWithCouncilTask('high', 'high');
    mkdirSync(join(r, '.cloverleaf', 'config'), { recursive: true });
    writeFileSync(join(r, '.cloverleaf', 'config', 'council.json'), JSON.stringify({
      profiles: { keepgoing: {
        rounds: [[{ member: 'reviewer' }], [{ member: 'security' }]],
        aggregation: 'any-veto', on_round_bounce: 'continue',
      } },
      gates: { 'task.review': 'keepgoing' },
    }));
    const res = applyCouncilVerdict(r, 'DEMO-001', 'task.review', V('bounce', [{ member: 'reviewer', verdict: 'bounce' }]));
    expect(res.security?.basis).toMatch(/did not run/i);
    expect(res.security?.basis).not.toMatch(/earlier round/i);
  });

  it('reports a bounce as a bounce when no security member is in the plan', () => {
    // The task walks council → implementing, so the basis must not claim it advanced.
    const r = repoWithCouncilTask('high', 'high');
    mkdirSync(join(r, '.cloverleaf', 'config'), { recursive: true });
    writeFileSync(join(r, '.cloverleaf', 'config', 'council.json'), JSON.stringify({
      profiles: { lean: { rounds: [[{ member: 'reviewer' }]], aggregation: 'any-veto' } },
      gates: { 'task.review': 'lean' },
    }));
    const res = applyCouncilVerdict(r, 'DEMO-001', 'task.review', V('bounce', [{ member: 'reviewer', verdict: 'bounce' }]));
    expect(loadTask(r, 'DEMO-001').status).toBe('implementing');
    expect(res.security?.basis).toBe(`${NOT_IN_PLAN}; council bounced to implementing`);
  });

  it('reports an escalate as an escalate when no security member is in the plan', () => {
    const r = repoWithCouncilTask('high', 'high');
    mkdirSync(join(r, '.cloverleaf', 'config'), { recursive: true });
    writeFileSync(join(r, '.cloverleaf', 'config', 'council.json'), JSON.stringify({
      profiles: { lean: { rounds: [[{ member: 'reviewer' }]], aggregation: 'any-veto' } },
      gates: { 'task.review': 'lean' },
    }));
    const res = applyCouncilVerdict(r, 'DEMO-001', 'task.review', V('escalate', [{ member: 'reviewer', verdict: 'escalate' }]));
    expect(loadTask(r, 'DEMO-001').status).toBe('escalated');
    expect(res.security?.basis).toBe(`${NOT_IN_PLAN}; council escalated`);
  });

  it('claims council authority only on a pass, when no security member is in the plan', () => {
    // delivery-fast's security member carries `when: security_class:high`, so on a
    // low-security task it is not in the resolved plan at all. The plan cannot tell that
    // apart from a profile that never listed one — which is why the string says "not in
    // this task's resolved plan" rather than the false "no security member configured".
    const r = repoWithCouncilTask('low', 'low');
    const res = applyCouncilVerdict(r, 'DEMO-001', 'task.review', V('pass', [{ member: 'reviewer', verdict: 'pass' }]));
    expect(loadTask(r, 'DEMO-001').status).toBe('final-gate');
    expect(res.security?.basis).toBe(`${NOT_IN_PLAN}; advanced under council authority`);
    expect(res.security?.basis).not.toContain('no security member configured');
  });

  it('says the plan was unresolvable rather than guessing, and still completes the apply', () => {
    const r = repoWithCouncilTask('high', 'high');
    mkdirSync(join(r, '.cloverleaf', 'config'), { recursive: true });
    writeFileSync(join(r, '.cloverleaf', 'config', 'council.json'), JSON.stringify({
      profiles: { typo: { rounds: [[{ member: 'reviwer' }]], aggregation: 'any-veto' } }, // unknown member id
      gates: { 'task.review': 'typo' },
    }));
    const res = applyCouncilVerdict(r, 'DEMO-001', 'task.review', V('pass', [{ member: 'reviewer', verdict: 'pass' }]));
    expect(loadTask(r, 'DEMO-001').status).toBe('final-gate'); // a bad council.json cannot break the apply
    expect(res.security?.basis).toMatch(/could not be resolved/i);
    expect(res.security?.basis).not.toContain(NOT_IN_PLAN);
  });

  it('leaves the basis for a security member that did run untouched', () => {
    const r = repoWithCouncilTask('high', 'high');
    const passed = applyCouncilVerdict(r, 'DEMO-001', 'task.review',
      V('pass', [{ member: 'reviewer', verdict: 'pass' }, { member: 'security', verdict: 'pass' }]));
    expect(passed.security?.basis).toBe('security member passed');
    const r2 = repoWithCouncilTask('high', 'high');
    const outvoted = applyCouncilVerdict(r2, 'DEMO-001', 'task.review', {
      verdict: 'pass', rule: 'majority', rationale: 'majority',
      members: [{ member: 'reviewer', verdict: 'pass' }, { member: 'security', verdict: 'bounce' }],
    });
    expect(outvoted.security?.basis).toBe(`security member returned 'bounce'; council pass by rule "majority"`);
  });
});
