import { describe, it, expect } from 'vitest';
import { validateGateDecisionValidity } from '../../validators/gate-decision-validity.js';
import type { GateDecisionEvent } from '../../validators/types.js';

function evt(gate: GateDecisionEvent['gate'], decision: GateDecisionEvent['decision']): GateDecisionEvent {
  return {
    event_id: 'e-1', event_type: 'gate_decision',
    occurred_at: '2026-04-17T12:00:00Z',
    gate, decision,
    work_item_id: { project: 'ACME', id: 'ACME-1' },
    approver: { kind: 'human', id: 'alice' }
  };
}

describe('validator: gate-decision-validity', () => {
  it('accepts task_batch_gate + approve', () => {
    expect(validateGateDecisionValidity(evt('task_batch_gate', 'approve')).ok).toBe(true);
  });

  it('accepts task_batch_gate + split', () => {
    expect(validateGateDecisionValidity(evt('task_batch_gate', 'split')).ok).toBe(true);
  });

  it('rejects final_approval_gate + split', () => {
    expect(validateGateDecisionValidity(evt('final_approval_gate', 'split')).ok).toBe(false);
  });

  it('accepts rfc_strategy_gate + abandon', () => {
    expect(validateGateDecisionValidity(evt('rfc_strategy_gate', 'abandon')).ok).toBe(true);
  });

  it('rejects task_batch_gate + abandon', () => {
    expect(validateGateDecisionValidity(evt('task_batch_gate', 'abandon')).ok).toBe(false);
  });

  it('rejects human_merge + reject', () => {
    expect(validateGateDecisionValidity(evt('human_merge', 'reject')).ok).toBe(false);
  });
});
