import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { matchesUiPaths, loadUiPathsConfig } from '../lib/ui-paths.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('matchesUiPaths', () => {
  const defaultPatterns = ['site/**'];

  it('returns true when any changed path matches a pattern', () => {
    expect(matchesUiPaths(['site/src/pages/index.astro'], defaultPatterns)).toBe(true);
    expect(matchesUiPaths(['site/public/logo.svg'], defaultPatterns)).toBe(true);
  });

  it('returns false when no paths match', () => {
    expect(matchesUiPaths(['standard/src/index.ts'], defaultPatterns)).toBe(false);
    expect(matchesUiPaths(['reference-impl/lib/cli.ts'], defaultPatterns)).toBe(false);
  });

  it('returns true if at least one of many paths matches', () => {
    expect(
      matchesUiPaths(
        ['reference-impl/lib/cli.ts', 'site/src/components/Nav.astro'],
        defaultPatterns
      )
    ).toBe(true);
  });

  it('returns false for empty diff', () => {
    expect(matchesUiPaths([], defaultPatterns)).toBe(false);
  });

  it('supports multiple patterns', () => {
    const patterns = ['site/**', 'apps/web/**'];
    expect(matchesUiPaths(['apps/web/x.tsx'], patterns)).toBe(true);
    expect(matchesUiPaths(['apps/api/x.ts'], patterns)).toBe(false);
  });

  it('package default patterns include site/**', () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'clv-ui-paths-default-'));
    try {
      const { patterns } = loadUiPathsConfig(tmpRoot);
      expect(patterns).toContain('site/**');
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

describe('loadUiPathsConfig', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'cloverleaf-ui-paths-'));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('returns package default when consumer override is absent', () => {
    const cfg = loadUiPathsConfig(repoRoot);
    expect(cfg.patterns).toContain('site/**');
  });

  it('returns consumer override when present', () => {
    const overrideDir = join(repoRoot, '.cloverleaf', 'config');
    mkdirSync(overrideDir, { recursive: true });
    writeFileSync(
      join(overrideDir, 'ui-paths.json'),
      JSON.stringify({ patterns: ['apps/web/**', 'packages/ui/**'] })
    );
    const cfg = loadUiPathsConfig(repoRoot);
    expect(cfg.patterns).toEqual(['apps/web/**', 'packages/ui/**']);
    expect(cfg.patterns).not.toContain('site/**');
  });

  it('ignores consumer override with invalid shape (missing patterns array)', () => {
    const overrideDir = join(repoRoot, '.cloverleaf', 'config');
    mkdirSync(overrideDir, { recursive: true });
    writeFileSync(
      join(overrideDir, 'ui-paths.json'),
      JSON.stringify({ unrelated: 'data' })
    );
    const cfg = loadUiPathsConfig(repoRoot);
    expect(cfg.patterns).toContain('site/**');
  });

  it('ignores consumer override with invalid JSON', () => {
    const overrideDir = join(repoRoot, '.cloverleaf', 'config');
    mkdirSync(overrideDir, { recursive: true });
    writeFileSync(
      join(overrideDir, 'ui-paths.json'),
      'not-valid-json'
    );
    const cfg = loadUiPathsConfig(repoRoot);
    expect(cfg.patterns).toContain('site/**');
  });
});
