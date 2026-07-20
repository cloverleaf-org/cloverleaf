import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateSecurityGate } from '../../validators/security-gate.js';
import type { StatusTransitions, Task, StatusTransitionEvent } from '../../validators/types.js';

const TASK_SM = resolve(__dirname, '..', '..', 'state-machines', 'task.json');

function evt(from: string, to: string, actor: 'agent' | 'human' = 'agent'): StatusTransitionEvent {
  return {
    event_id: 'e-sg', event_type: 'status_transition', occurred_at: '2026-07-20T00:00:00Z',
    work_item_id: { project: 'CLV', id: 'CLV-1' }, work_item_type: 'task',
    from_status: from, to_status: to, actor: { kind: actor, id: actor },
  };
}
function task(security_class: 'low' | 'high', verdict: 'pass' | 'bounce' | 'escalate' | null): Task {
  return {
    id: 'CLV-1', type: 'task', status: 'council', project: 'CLV', title: 't',
    owner: { kind: 'agent', id: 'unassigned' },
    context: { rfc: { project: 'CLV', id: 'CLV-1' } },
    definition_of_done: ['x'], acceptance_criteria: ['y'],
    risk_class: 'high', security_class, security_review_verdict: verdict,
  } as unknown as Task;
}

describe('validator: security-gate — retired from the default FSM (0.8.0)', () => {
  const sm = JSON.parse(readFileSync(TASK_SM, 'utf-8')) as StatusTransitions;

  it('the collapsed task.json carries zero security_gate transitions', () => {
    expect(sm.transitions.filter((t) => (t as { security_gate?: boolean }).security_gate === true)).toHaveLength(0);
  });

  it('is a no-op (ok) on the real council → final-gate transition even for high + null', () => {
    // The guarantee moved to a blocking security council member + the applyCouncilVerdict backstop.
    expect(validateSecurityGate(evt('council', 'final-gate'), sm, task('high', null)).ok).toBe(true);
  });
});

describe('validator: security-gate — the primitive still enforces a synthetic flagged transition', () => {
  const synthetic = {
    type: 'task',
    states: { initial: ['council'], terminal: ['merged'], all: ['council', 'merged'] },
    transitions: [{ from: 'council', to: 'merged', security_gate: true, allowed_actors: ['human'] }],
  } as unknown as StatusTransitions;

  it('refuses high + null with rule "security-gate"', () => {
    const r = validateSecurityGate(evt('council', 'merged', 'human'), synthetic, task('high', null));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations[0].rule).toBe('security-gate');
  });
  it('allows high + pass', () => {
    expect(validateSecurityGate(evt('council', 'merged', 'human'), synthetic, task('high', 'pass')).ok).toBe(true);
  });
  it('allows low + null', () => {
    expect(validateSecurityGate(evt('council', 'merged', 'human'), synthetic, task('low', null)).ok).toBe(true);
  });
});
