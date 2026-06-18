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

describe('aggregate — unanimous', () => {
  it('passes only when all pass', () => {
    expect(aggregate([m('a', 'pass'), m('b', 'pass')], 'unanimous').verdict).toBe('pass');
    expect(aggregate([m('a', 'pass'), m('b', 'bounce')], 'unanimous').verdict).toBe('bounce');
  });
});

describe('aggregate — majority', () => {
  it('passes on strict majority', () => {
    expect(aggregate([m('a', 'pass'), m('b', 'pass'), m('c', 'bounce')], 'majority').verdict).toBe('pass');
  });
  it('bounces on a tie (fail-safe)', () => {
    expect(aggregate([m('a', 'pass'), m('b', 'bounce')], 'majority').verdict).toBe('bounce');
  });
});

describe('aggregate — quorum(k)', () => {
  it('passes when >= k members pass', () => {
    expect(aggregate([m('a', 'pass'), m('b', 'pass'), m('c', 'bounce')], { quorum: 2 }).verdict).toBe('pass');
  });
  it('bounces when fewer than k pass', () => {
    expect(aggregate([m('a', 'pass'), m('b', 'bounce'), m('c', 'bounce')], { quorum: 2 }).verdict).toBe('bounce');
  });
});

describe('aggregate — weighted', () => {
  it('passes when pass-weight is a strict majority of total weight (default)', () => {
    const r = aggregate([m('senior', 'pass', { weight: 3 }), m('junior', 'bounce', { weight: 1 })], 'weighted');
    expect(r.verdict).toBe('pass'); // 3 of 4 > half
  });
  it('honors an explicit weightedThreshold', () => {
    const r = aggregate([m('a', 'pass', { weight: 2 }), m('b', 'bounce', { weight: 2 })], 'weighted', { weightedThreshold: 2 });
    expect(r.verdict).toBe('pass'); // passWeight 2 >= threshold 2
  });
});

describe('aggregate — single member degenerates to that member', () => {
  it('any-veto single pass → pass; single bounce → bounce', () => {
    expect(aggregate([m('a', 'pass')], 'any-veto').verdict).toBe('pass');
    expect(aggregate([m('a', 'bounce')], 'any-veto').verdict).toBe('bounce');
  });
});

describe('aggregate — empty members (degenerate)', () => {
  it('passes with the no-blocking-members rationale', () => {
    const r = aggregate([], 'any-veto');
    expect(r.verdict).toBe('pass');
    expect(r.rationale).toBe('no blocking members');
  });
});
