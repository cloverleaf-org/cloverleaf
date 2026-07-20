import { describe, it, expect } from 'vitest';
import { GATE_DESCRIPTORS } from '../lib/council.js';

describe('GATE_DESCRIPTORS (Slice 4)', () => {
  it('rebinds task.review to the collapsed council state (decisive)', () => {
    expect(GATE_DESCRIPTORS['task.review']).toEqual({ state: 'council', advisoryOnly: false });
  });
  it('makes task.plan_review decisive-capable at tactical-plan', () => {
    expect(GATE_DESCRIPTORS['task.plan_review']).toEqual({ state: 'tactical-plan', advisoryOnly: false });
  });
  it('keeps task.final_gate advisory at final-gate', () => {
    expect(GATE_DESCRIPTORS['task.final_gate']).toEqual({ state: 'final-gate', advisoryOnly: true });
  });
  it('adds advisory plan/rfc discovery gates carrying their kind', () => {
    expect(GATE_DESCRIPTORS['plan.task_batch']).toEqual({ state: 'task_batch_gate', advisoryOnly: true, kind: 'plan' });
    expect(GATE_DESCRIPTORS['rfc.strategy_gate']).toEqual({ state: 'rfc_strategy_gate', advisoryOnly: true, kind: 'rfc' });
  });
});
