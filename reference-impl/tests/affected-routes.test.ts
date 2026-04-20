import { describe, it, expect } from 'vitest';
import { computeAffectedRoutes, loadDefaultConfig } from '../lib/affected-routes.js';

const DEFAULT = loadDefaultConfig();

describe('computeAffectedRoutes', () => {
  it('returns [] when no files match routeScope', () => {
    expect(computeAffectedRoutes(['standard/src/foo.ts'], DEFAULT)).toEqual([]);
    expect(computeAffectedRoutes(['reference-impl/lib/cli.ts'], DEFAULT)).toEqual([]);
    expect(computeAffectedRoutes([], DEFAULT)).toEqual([]);
  });

  it('maps a direct page file to its route', () => {
    expect(computeAffectedRoutes(['site/src/pages/guide.astro'], DEFAULT)).toEqual(['/guide/']);
    expect(computeAffectedRoutes(['site/src/pages/faq.astro'], DEFAULT)).toEqual(['/faq/']);
  });

  it('maps index.astro to /', () => {
    expect(computeAffectedRoutes(['site/src/pages/index.astro'], DEFAULT)).toEqual(['/']);
  });

  it('maps nested pages', () => {
    expect(
      computeAffectedRoutes(['site/src/pages/guide/getting-started.astro'], DEFAULT)
    ).toEqual(['/guide/getting-started/']);
  });

  it('returns "all" for layout changes', () => {
    expect(computeAffectedRoutes(['site/src/layouts/Layout.astro'], DEFAULT)).toBe('all');
  });

  it('returns "all" for component changes', () => {
    expect(computeAffectedRoutes(['site/src/components/Nav.astro'], DEFAULT)).toBe('all');
  });

  it('returns "all" for global style changes', () => {
    expect(computeAffectedRoutes(['site/src/styles/global.css'], DEFAULT)).toBe('all');
  });

  it('returns "all" for public asset changes', () => {
    expect(computeAffectedRoutes(['site/public/favicon.svg'], DEFAULT)).toBe('all');
  });

  it('returns "all" for astro config changes', () => {
    expect(computeAffectedRoutes(['site/astro.config.mjs'], DEFAULT)).toBe('all');
  });

  it('returns "all" for content-collection mdx', () => {
    expect(
      computeAffectedRoutes(['site/src/content/guide/01-intro.mdx'], DEFAULT)
    ).toBe('all');
  });

  it('falls back to "all" for unrecognized site paths', () => {
    expect(computeAffectedRoutes(['site/weird/unknown.xyz'], DEFAULT)).toBe('all');
  });

  it('short-circuits to "all" on any global match', () => {
    expect(
      computeAffectedRoutes(
        ['site/src/pages/faq.astro', 'site/src/layouts/Layout.astro'],
        DEFAULT
      )
    ).toBe('all');
  });

  it('dedupes and sorts specific-route results', () => {
    expect(
      computeAffectedRoutes(
        ['site/src/pages/guide.astro', 'site/src/pages/faq.astro', 'site/src/pages/guide.astro'],
        DEFAULT
      )
    ).toEqual(['/faq/', '/guide/']);
  });

  it('ignores non-site files in a mixed diff', () => {
    expect(
      computeAffectedRoutes(
        ['reference-impl/lib/cli.ts', 'site/src/pages/faq.astro'],
        DEFAULT
      )
    ).toEqual(['/faq/']);
  });
});

describe('loadDefaultConfig', () => {
  it('loads the bundled default config', () => {
    const cfg = loadDefaultConfig();
    expect(cfg.pageRoots).toContain('site/src/pages/');
    expect(cfg.globalPatterns.length).toBeGreaterThanOrEqual(5);
    expect(cfg.routeScope).toContain('site/**');
  });
});
