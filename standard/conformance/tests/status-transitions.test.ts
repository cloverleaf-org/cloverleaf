import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TASK_SM = resolve(__dirname, '..', '..', 'state-machines', 'task.json');

describe('task state-machine — collapsed council phase (0.8.0)', () => {
  const sm = JSON.parse(readFileSync(TASK_SM, 'utf-8'));
  const has = (from: string, to: string) =>
    sm.transitions.find((t: { from: string; to: string }) => t.from === from && t.to === to);

  it('declares exactly the 9 collapsed states', () => {
    expect(sm.states.all).toEqual([
      'pending', 'tactical-plan', 'implementing', 'documenting',
      'council', 'final-gate', 'merged', 'rejected', 'escalated',
    ]);
  });

  it('has no lingering review/automated-gates/security-review/ui-review/qa state', () => {
    for (const dead of ['review', 'automated-gates', 'security-review', 'ui-review', 'qa']) {
      expect(sm.states.all).not.toContain(dead);
    }
  });

  it('enters the council phase from documenting', () => {
    expect(has('documenting', 'council')).toBeTruthy();
    expect(has('documenting', 'review')).toBeUndefined();
  });

  it('the council phase has exactly three exits: final-gate / implementing / escalated', () => {
    const exits = sm.transitions.filter((t: { from: string }) => t.from === 'council').map((t: { to: string }) => t.to).sort();
    expect(exits).toEqual(['escalated', 'final-gate', 'implementing']);
  });

  it('carries NO security_gate or resets_security_verdict annotation anywhere', () => {
    expect(sm.transitions.filter((t: { security_gate?: boolean }) => t.security_gate === true)).toHaveLength(0);
    expect(sm.transitions.filter((t: { resets_security_verdict?: boolean }) => t.resets_security_verdict === true)).toHaveLength(0);
  });

  it('carries NO fast_lane/full_pipeline path annotation anywhere', () => {
    expect(sm.transitions.filter((t: { path?: string }) => t.path !== undefined)).toHaveLength(0);
  });

  it('uses no human_merge gate; final-gate is the single human merge gate', () => {
    const gates = sm.transitions.map((t: { gate?: string }) => t.gate).filter(Boolean);
    expect(gates).not.toContain('human_merge');
    expect(has('final-gate', 'merged').gate).toBe('final_approval_gate');
    expect(has('final-gate', 'merged').allowed_actors).toEqual(['human']);
  });

  it('allows a decisive (agent) plan_review bounce: tactical-plan → pending by human OR agent', () => {
    const t = has('tactical-plan', 'pending');
    expect(t.gate).toBe('per_task_plan_review');
    expect(t.allowed_actors.sort()).toEqual(['agent', 'human']);
  });

  it('drives the council exits by agent (escalate also by human)', () => {
    expect(has('council', 'final-gate').allowed_actors).toEqual(['agent']);
    expect(has('council', 'implementing').allowed_actors).toEqual(['agent']);
    expect(has('council', 'escalated').allowed_actors.sort()).toEqual(['agent', 'human']);
  });
});
