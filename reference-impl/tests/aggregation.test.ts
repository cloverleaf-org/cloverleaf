import { describe, it, expect } from 'vitest';
import { aggregate, type MemberVerdict } from '../lib/aggregation.js';

const m = (member: string, verdict: MemberVerdict['verdict'], extra: Partial<MemberVerdict> = {}): MemberVerdict =>
  ({ member, verdict, ...extra });

describe('aggregate — escalate short-circuit (safety invariant)', () => {
  it('escalates if any member escalates, regardless of rule', () => {
    const r = aggregate([m('reviewer', 'pass'), m('security', 'escalate')], 'any-veto');
    expect(r.verdict).toBe('escalate');
    expect(r.rationale).toContain('security');
  });

  it('escalate from an advisory member still short-circuits', () => {
    const r = aggregate([m('reviewer', 'pass'), m('perf', 'escalate', { blocking: false })], 'majority');
    expect(r.verdict).toBe('escalate');
  });
});

describe('aggregate — any-veto', () => {
  it('passes when all blocking members pass', () => {
    expect(aggregate([m('a', 'pass'), m('b', 'pass')], 'any-veto').verdict).toBe('pass');
  });
  it('bounces when any blocking member bounces', () => {
    expect(aggregate([m('a', 'pass'), m('b', 'bounce')], 'any-veto').verdict).toBe('bounce');
  });
  it('ignores advisory members for gating', () => {
    expect(aggregate([m('a', 'pass'), m('b', 'bounce', { blocking: false })], 'any-veto').verdict).toBe('pass');
  });
  it('passes when there are no blocking members', () => {
    const r = aggregate([m('a', 'bounce', { blocking: false })], 'any-veto');
    expect(r.verdict).toBe('pass');
    expect(r.rationale).toContain('no blocking members');
  });
});
