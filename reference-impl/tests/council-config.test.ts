import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCouncilConfig } from '../lib/council-config.js';

describe('loadCouncilConfig', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'clv-council-config-'));
  });
  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('returns the package default when no consumer override exists', () => {
    const cfg = loadCouncilConfig(repoRoot);
    expect(cfg.gates['task.review']).toBe('default');
    expect(cfg.profiles.default.rounds[0]).toEqual([{ member: 'reviewer' }]);
  });

  it('returns the consumer override when present', () => {
    const dir = join(repoRoot, '.cloverleaf', 'config');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'council.json'),
      JSON.stringify({
        profiles: { strict: { rounds: [[{ member: 'reviewer' }]], aggregation: 'unanimous' } },
        gates: { 'task.review': 'strict' },
      }),
    );
    const cfg = loadCouncilConfig(repoRoot);
    expect(cfg.gates['task.review']).toBe('strict');
    expect(cfg.profiles.strict.aggregation).toBe('unanimous');
  });

  it('falls back to default on invalid JSON', () => {
    const dir = join(repoRoot, '.cloverleaf', 'config');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'council.json'), 'not json');
    const cfg = loadCouncilConfig(repoRoot);
    expect(cfg.gates['task.review']).toBe('default');
  });

  it('normalizes missing profiles/gates keys to empty objects', () => {
    const dir = join(repoRoot, '.cloverleaf', 'config');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'council.json'), JSON.stringify({ profiles: { x: { rounds: [], aggregation: 'any-veto' } } }));
    const cfg = loadCouncilConfig(repoRoot);
    expect(cfg.gates).toEqual({});
    expect(Object.keys(cfg.profiles)).toContain('x');
  });
});
