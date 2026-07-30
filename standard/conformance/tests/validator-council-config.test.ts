import { describe, it, expect } from 'vitest';
import { validateCouncilConfig } from '../../validators/council-config.js';

const GD = { 'task.review': { kind: 'code' }, 'plan.task_batch': { kind: 'plan' } };

describe('validator: council-config', () => {
  it('accepts a kind-homogeneous code profile bound to a code gate', () => {
    const cfg = { profiles: { p: { rounds: [[{ member: 'reviewer' }]], aggregation: 'any-veto' } }, gates: { 'task.review': 'p' } };
    expect(validateCouncilConfig(cfg as never, GD).ok).toBe(true);
  });

  it('rejects a profile that mixes kinds', () => {
    const cfg = { profiles: { p: { rounds: [[{ member: 'a', kind: 'code' }, { member: 'b', kind: 'plan' }]], aggregation: 'any-veto' } }, gates: {} };
    const r = validateCouncilConfig(cfg as never, GD);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations[0].rule).toBe('council-config');
  });

  it('rejects binding a plan-kind gate to a code-kind profile', () => {
    const cfg = { profiles: { p: { rounds: [[{ member: 'reviewer' }]], aggregation: 'any-veto' } }, gates: { 'plan.task_batch': 'p' } };
    expect(validateCouncilConfig(cfg as never, GD).ok).toBe(false);
  });

  it('rejects an unknown aggregation rule', () => {
    const cfg = { profiles: { p: { rounds: [[{ member: 'reviewer' }]], aggregation: 'supermajority' } }, gates: {} };
    expect(validateCouncilConfig(cfg as never, GD).ok).toBe(false);
  });

  it('accepts a plan-kind custom-role profile bound to a plan gate', () => {
    const cfg = { profiles: { pl: { rounds: [[{ member: 'plan-strategy', prompt: 'plan-strategy.md', kind: 'plan' }]], aggregation: 'any-veto' } }, gates: { 'plan.task_batch': 'pl' } };
    expect(validateCouncilConfig(cfg as never, GD).ok).toBe(true);
  });
});
