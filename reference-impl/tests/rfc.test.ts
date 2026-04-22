import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRfc, saveRfc, advanceRfcStatus, type RfcDoc } from '../lib/rfc.js';

function validRfc(overrides: Partial<RfcDoc> = {}): RfcDoc {
  return {
    type: 'rfc',
    project: 'CLV',
    id: 'CLV-009',
    title: 'Cross-browser UI review',
    status: 'drafting',
    owner: { kind: 'human', id: 'renato' },
    problem: 'UI review currently runs chromium-only.',
    solution: 'Add webkit and firefox runners to CI.',
    unknowns: [],
    acceptance_criteria: ['CI passes on webkit', 'CI passes on firefox'],
    out_of_scope: [],
    ...overrides,
  } as RfcDoc;
}

describe('rfc lib', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cl-rfc-'));
    mkdirSync(join(tmp, '.cloverleaf', 'rfcs'), { recursive: true });
    mkdirSync(join(tmp, '.cloverleaf', 'events'), { recursive: true });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('saveRfc then loadRfc round-trips', () => {
    const rfc = validRfc();
    saveRfc(tmp, rfc);
    expect(loadRfc(tmp, 'CLV-009')).toEqual(rfc);
  });

  it('saveRfc throws on schema violation', () => {
    const broken = validRfc();
    // @ts-expect-error intentionally invalid
    delete broken.title;
    expect(() => saveRfc(tmp, broken)).toThrow();
  });

  it('advanceRfcStatus drafting → spike-in-flight emits event and saves', () => {
    saveRfc(tmp, validRfc());
    advanceRfcStatus(tmp, 'CLV-009', 'spike-in-flight', 'agent');
    expect(loadRfc(tmp, 'CLV-009').status).toBe('spike-in-flight');
    const events = readdirSync(join(tmp, '.cloverleaf', 'events'));
    expect(events).toHaveLength(1);
  });

  it('advanceRfcStatus rejects illegal transition', () => {
    saveRfc(tmp, validRfc());
    expect(() => advanceRfcStatus(tmp, 'CLV-009', 'approved', 'human')).toThrow(/Illegal transition/);
  });

  it('advanceRfcStatus rfc_strategy_gate gate-pending → approved requires human actor', () => {
    saveRfc(tmp, validRfc({ status: 'gate-pending' }));
    expect(() => advanceRfcStatus(tmp, 'CLV-009', 'approved', 'agent', { gate: 'rfc_strategy_gate' })).toThrow();
    advanceRfcStatus(tmp, 'CLV-009', 'approved', 'human', { gate: 'rfc_strategy_gate' });
    expect(loadRfc(tmp, 'CLV-009').status).toBe('approved');
  });

  it('saveRfc auto-creates the rfcs directory on first write (v0.5.1)', () => {
    // Scope: simulate a fresh consumer repo that has never run Discovery.
    // Prior to v0.5.1 this threw ENOENT — the events/feedback auto-create
    // fix from v0.1.1 was not propagated to rfcs/spikes/plans/tasks.
    const fresh = mkdtempSync(join(tmpdir(), 'cl-rfc-fresh-'));
    try {
      expect(existsSync(join(fresh, '.cloverleaf', 'rfcs'))).toBe(false);
      saveRfc(fresh, validRfc());
      expect(existsSync(join(fresh, '.cloverleaf', 'rfcs', 'CLV-009.json'))).toBe(true);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });
});
