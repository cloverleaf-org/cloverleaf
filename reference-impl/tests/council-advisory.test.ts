import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { postAdvisoryVerdict } from '../lib/council.js';
import { loadTask } from '../lib/task.js';
import { readCouncilResult } from '../lib/council-result.js';
import type { CouncilVerdict } from '../lib/aggregation.js';

function repoWithTaskAt(status: string): string {
  const repoRoot = mkdtempSync(join(tmpdir(), 'clv-adv-'));
  mkdirSync(join(repoRoot, '.cloverleaf', 'tasks'), { recursive: true });
  mkdirSync(join(repoRoot, '.cloverleaf', 'events'), { recursive: true });
  writeFileSync(
    join(repoRoot, '.cloverleaf', 'tasks', 'DEMO-001.json'),
    JSON.stringify({
      id: 'DEMO-001', type: 'task', status, project: 'DEMO', title: 't',
      owner: { kind: 'agent', id: 'unassigned' }, context: { rfc: { project: 'DEMO', id: 'DEMO-RFC-001' } },
      acceptance_criteria: ['a'], definition_of_done: ['d'], risk_class: 'high',
    }),
  );
  return repoRoot;
}
const V = (
  verdict: CouncilVerdict['verdict'],
  members: CouncilVerdict['members'],
  extra: Partial<CouncilVerdict> = {},
): CouncilVerdict => ({ verdict, rule: 'any-veto', rationale: `${verdict}`, members, ...extra });

describe('postAdvisoryVerdict — final_gate (advisory)', () => {
  it('pass: records mode=advisory, no transition, artifact + feedback written', () => {
    const r = repoWithTaskAt('final-gate');
    const res = postAdvisoryVerdict(r, 'DEMO-001', 'task.final_gate', 'final-gate',
      V('pass', [{ member: 'reviewer', verdict: 'pass' }]));
    expect(res.mode).toBe('advisory');
    expect(res.walk).toEqual(['final-gate']);
    expect(res.security).toBeUndefined();
    expect(loadTask(r, 'DEMO-001').status).toBe('final-gate'); // NO transition
    expect(readCouncilResult(r, 'DEMO-001', 'task.final_gate')?.final_verdict).toBe('pass');
    const fb = readdirSync(join(r, '.cloverleaf', 'feedback'));
    expect(fb.some((f) => /^DEMO-001-c\d+\.json$/.test(f))).toBe(true);
  });
  it('bounce: no transition', () => {
    const r = repoWithTaskAt('final-gate');
    postAdvisoryVerdict(r, 'DEMO-001', 'task.final_gate', 'final-gate',
      V('bounce', [{ member: 'reviewer', verdict: 'bounce' }]));
    expect(loadTask(r, 'DEMO-001').status).toBe('final-gate');
  });
  it('escalate: recorded verbatim, no transition (invariant holds trivially)', () => {
    const r = repoWithTaskAt('final-gate');
    const res = postAdvisoryVerdict(r, 'DEMO-001', 'task.final_gate', 'final-gate',
      V('escalate', [{ member: 'security', verdict: 'escalate' }]));
    expect(res.final_verdict).toBe('escalate');
    expect(loadTask(r, 'DEMO-001').status).toBe('final-gate');
  });
  it('forward is recorded when present', () => {
    const r = repoWithTaskAt('final-gate');
    const res = postAdvisoryVerdict(r, 'DEMO-001', 'task.final_gate', 'final-gate',
      V('bounce', [{ member: 'qa', verdict: 'bounce' }], { rule: 'chair', forward: ['qa'] }));
    expect(res.forward).toEqual(['qa']);
    expect(readCouncilResult(r, 'DEMO-001', 'task.final_gate')?.forward).toEqual(['qa']);
  });
  it('throws when the task is not in the expected state', () => {
    const r = repoWithTaskAt('implementing');
    expect(() => postAdvisoryVerdict(r, 'DEMO-001', 'task.final_gate', 'final-gate',
      V('pass', [{ member: 'reviewer', verdict: 'pass' }]))).toThrow(/expected 'final-gate'/);
  });
});

describe('postAdvisoryVerdict — plan_review (advisory)', () => {
  it('posts at tactical-plan without transitioning', () => {
    const r = repoWithTaskAt('tactical-plan');
    const res = postAdvisoryVerdict(r, 'DEMO-001', 'task.plan_review', 'tactical-plan',
      V('bounce', [{ member: 'reviewer', verdict: 'bounce' }]));
    expect(res.mode).toBe('advisory');
    expect(res.walk).toEqual(['tactical-plan']);
    expect(loadTask(r, 'DEMO-001').status).toBe('tactical-plan');
  });
});
