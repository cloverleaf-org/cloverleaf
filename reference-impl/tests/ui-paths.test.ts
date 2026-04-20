import { describe, it, expect } from 'vitest';
import { matchesUiPaths, loadDefaultPatterns } from '../lib/ui-paths.js';

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

  it('loads default patterns from config file', () => {
    const patterns = loadDefaultPatterns();
    expect(patterns).toContain('site/**');
  });
});
