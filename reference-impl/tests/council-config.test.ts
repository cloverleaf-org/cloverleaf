import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCouncilConfig, loadCouncilConfigWithSource } from '../lib/council-config.js';

describe('loadCouncilConfig', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'clv-council-config-'));
  });
  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('returns the two-lane package default when no consumer override exists', () => {
    const cfg = loadCouncilConfig(repoRoot);
    // task.review is bound by risk_class: low → delivery-fast, high → delivery-full.
    expect(cfg.gates['task.review']).toEqual({
      by: 'risk_class',
      map: { low: 'delivery-fast', high: 'delivery-full' },
    });
    // delivery-fast (low risk): reviewer, then security only when security_class:high.
    expect(cfg.profiles['delivery-fast'].rounds[0]).toEqual([{ member: 'reviewer' }]);
    expect(cfg.profiles['delivery-fast'].rounds[1].map((mem) => mem.member)).toEqual(['security']);
    // delivery-full (high risk): reviewer, then security(if-high) + ui(if-changes) + qa.
    expect(cfg.profiles['delivery-full'].rounds[0]).toEqual([{ member: 'reviewer' }]);
    expect(cfg.profiles['delivery-full'].rounds[1].map((mem) => mem.member)).toEqual(['security', 'ui', 'qa']);
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

  it('falls back to the two-lane default on invalid JSON', () => {
    const dir = join(repoRoot, '.cloverleaf', 'config');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'council.json'), 'not json');
    const cfg = loadCouncilConfig(repoRoot);
    expect(cfg.gates['task.review']).toEqual({
      by: 'risk_class',
      map: { low: 'delivery-fast', high: 'delivery-full' },
    });
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

  it('falls back to the two-lane default when consumer JSON is a non-object (e.g. null)', () => {
    const dir = join(repoRoot, '.cloverleaf', 'config');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'council.json'), 'null');
    const cfg = loadCouncilConfig(repoRoot);
    expect(cfg.gates['task.review']).toEqual({
      by: 'risk_class',
      map: { low: 'delivery-fast', high: 'delivery-full' },
    });
  });
});

describe('loadCouncilConfigWithSource', () => {
  it("source is 'default' when no consumer file exists", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'clv-cc-'));
    expect(loadCouncilConfigWithSource(repoRoot).source).toBe('default');
  });
  it("source is 'consumer' when a valid consumer file exists", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'clv-cc-'));
    mkdirSync(join(repoRoot, '.cloverleaf', 'config'), { recursive: true });
    writeFileSync(join(repoRoot, '.cloverleaf', 'config', 'council.json'),
      JSON.stringify({ profiles: { p: { rounds: [[{ member: 'reviewer' }]], aggregation: 'any-veto' } }, gates: { 'task.review': 'p' } }));
    const { config, source } = loadCouncilConfigWithSource(repoRoot);
    expect(source).toBe('consumer');
    expect(config.gates['task.review']).toBe('p');
  });
  it("source falls back to 'default' when the consumer file is malformed", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'clv-cc-'));
    mkdirSync(join(repoRoot, '.cloverleaf', 'config'), { recursive: true });
    writeFileSync(join(repoRoot, '.cloverleaf', 'config', 'council.json'), '{ not json');
    expect(loadCouncilConfigWithSource(repoRoot).source).toBe('default');
  });
});
