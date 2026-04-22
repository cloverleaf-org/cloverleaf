import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSpike, saveSpike, advanceSpikeStatus, type SpikeDoc } from '../lib/spike.js';

function validSpike(overrides: Partial<SpikeDoc> = {}): SpikeDoc {
  return {
    type: 'spike',
    project: 'CLV',
    id: 'CLV-010',
    title: 'Webkit install cost',
    status: 'pending',
    owner: { kind: 'agent', id: 'researcher' },
    parent_rfc: { project: 'CLV', id: 'CLV-009' },
    question: 'What is the webkit install size and time?',
    method: 'research',
    ...overrides,
  } as SpikeDoc;
}

describe('spike lib', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cl-spike-'));
    mkdirSync(join(tmp, '.cloverleaf', 'spikes'), { recursive: true });
    mkdirSync(join(tmp, '.cloverleaf', 'events'), { recursive: true });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('saveSpike then loadSpike round-trips', () => {
    const spike = validSpike();
    saveSpike(tmp, spike);
    expect(loadSpike(tmp, 'CLV-010')).toEqual(spike);
  });

  it('saveSpike on completed must include findings + recommendation', () => {
    const bad = validSpike({ status: 'completed' });
    expect(() => saveSpike(tmp, bad)).toThrow();
    const good = validSpike({
      status: 'completed',
      findings: 'webkit bundle is 180MB; install takes ~45s.',
      recommendation: 'Cache at PLAYWRIGHT_BROWSERS_PATH to avoid repeat downloads.',
    } as unknown as SpikeDoc);
    saveSpike(tmp, good);
    expect(loadSpike(tmp, 'CLV-010').status).toBe('completed');
  });

  it('advanceSpikeStatus pending → running → completed happy path', () => {
    saveSpike(tmp, validSpike());
    advanceSpikeStatus(tmp, 'CLV-010', 'running', 'agent');
    expect(loadSpike(tmp, 'CLV-010').status).toBe('running');
    // Before transitioning to completed, save findings + recommendation.
    saveSpike(tmp, {
      ...loadSpike(tmp, 'CLV-010'),
      findings: 'f',
      recommendation: 'r',
    } as unknown as SpikeDoc);
    advanceSpikeStatus(tmp, 'CLV-010', 'completed', 'agent');
    expect(loadSpike(tmp, 'CLV-010').status).toBe('completed');
    const events = readdirSync(join(tmp, '.cloverleaf', 'events'));
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  it('advanceSpikeStatus rejects illegal transition', () => {
    saveSpike(tmp, validSpike());
    // pending → completed is illegal (must go through running)
    expect(() => advanceSpikeStatus(tmp, 'CLV-010', 'completed', 'agent')).toThrow(/Illegal transition/);
  });
});
