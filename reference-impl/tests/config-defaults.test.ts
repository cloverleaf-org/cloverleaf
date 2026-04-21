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
