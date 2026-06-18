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
    expect(cfg.profiles.default.rounds[1].map((mem) => mem.member)).toEqual(['security', 'ui', 'qa']);
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
    expect(cfg.profiles.default).toBeUndefined(); // full replacement — default profile is not merged in
  });

  it('falls back to default on invalid JSON', () => {
    const dir = join(repoRoot, '.cloverleaf', 'config');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'council.json'), 'not json');
    const cfg = loadCouncilConfig(repoRoot);
    expect(cfg.gates['task.review']).toBe('default');
  });

  it('fully replaces the default: a partial consumer file yields empty gates + no default leak', () => {
    const dir = join(repoRoot, '.cloverleaf', 'config');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'council.json'), JSON.stringify({ profiles: { x: { rounds: [], aggregation: 'any-veto' } } }));
    const cfg = loadCouncilConfig(repoRoot);
    expect(cfg.gates).toEqual({});
    expect(Object.keys(cfg.profiles)).toContain('x');
    expect(cfg.profiles.default).toBeUndefined(); // replace, not merge
  });

  it('falls back to default when consumer JSON is a non-object (e.g. null)', () => {
    const dir = join(repoRoot, '.cloverleaf', 'config');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'council.json'), 'null');
    const cfg = loadCouncilConfig(repoRoot);
    expect(cfg.gates['task.review']).toBe('default');
  });
});
