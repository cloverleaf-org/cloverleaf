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
