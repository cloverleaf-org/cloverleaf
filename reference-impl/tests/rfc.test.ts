import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
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
});
