import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const CONFIG_DIR = resolve(__dirname, '..', 'config');
const FORBIDDEN_SUBSTRINGS = [
  'cloverleaf',
  '/cloverleaf',
  'site/src/content/guide',
  'site/src/pages',
  'site/src/layouts',
  'site/src/components',
  'site/astro.config',
];

describe('package config defaults must stay framework-generic', () => {
  const files = readdirSync(CONFIG_DIR).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    it(`${f} contains no cloverleaf-specific paths or names`, () => {
      const raw = readFileSync(resolve(CONFIG_DIR, f), 'utf-8').toLowerCase();
      for (const forbidden of FORBIDDEN_SUBSTRINGS) {
        expect(raw).not.toContain(forbidden.toLowerCase());
      }
    });
  }
});

describe('config/council.json — package default shape (reproduces today)', () => {
  const raw = readFileSync(resolve(CONFIG_DIR, 'council.json'), 'utf-8');
  const cfg = JSON.parse(raw) as {
    profiles: Record<string, { rounds: { member: string; when?: string }[][]; aggregation: string; on_round_bounce?: string }>;
    gates: Record<string, unknown>;
  };

  it('binds task.review to the default profile', () => {
    expect(cfg.gates['task.review']).toBe('default');
  });

  it('round 1 is the fresh-eyes reviewer alone', () => {
    expect(cfg.profiles.default.rounds[0]).toEqual([{ member: 'reviewer' }]);
  });

  it('round 2 is conditional security/ui + unconditional qa', () => {
    const r2 = cfg.profiles.default.rounds[1];
    expect(r2.map((x) => x.member)).toEqual(['security', 'ui', 'qa']);
    expect(r2.find((x) => x.member === 'security')!.when).toBe('security_class:high');
    expect(r2.find((x) => x.member === 'ui')!.when).toBe('ui_changes');
    expect(r2.find((x) => x.member === 'qa')!.when).toBeUndefined();
  });

  it('aggregates any-veto and stops on a bouncing round (matches today)', () => {
    expect(cfg.profiles.default.aggregation).toBe('any-veto');
    expect(cfg.profiles.default.on_round_bounce).toBe('stop');
  });
});

describe('config/discovery.json — package default shape', () => {
  const raw = readFileSync(resolve(CONFIG_DIR, 'discovery.json'), 'utf-8');
  const cfg = JSON.parse(raw) as Record<string, unknown>;

  it('docContextUri is empty string', () => {
    expect(cfg.docContextUri).toBe('');
  });

  it('projectId is empty string', () => {
    expect(cfg.projectId).toBe('');
  });

  it('idStart is 1', () => {
    expect(cfg.idStart).toBe(1);
  });

  it('has exactly 3 fields', () => {
    expect(Object.keys(cfg).sort()).toEqual(['docContextUri', 'idStart', 'projectId']);
  });
});
