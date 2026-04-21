import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeAffectedRoutes, loadAffectedRoutesConfig } from '../lib/affected-routes.js';

const _defaultTmpRoot = mkdtempSync(join(tmpdir(), 'clv-affected-routes-default-'));
const DEFAULT = loadAffectedRoutesConfig(_defaultTmpRoot);
afterAll(() => {
  rmSync(_defaultTmpRoot, { recursive: true, force: true });
});

describe('computeAffectedRoutes', () => {
  it('returns [] when no files match routeScope', () => {
    expect(computeAffectedRoutes(['standard/src/foo.ts'], DEFAULT)).toEqual([]);
    expect(computeAffectedRoutes(['reference-impl/lib/cli.ts'], DEFAULT)).toEqual([]);
    expect(computeAffectedRoutes([], DEFAULT)).toEqual([]);
  });

  it('maps a direct page file to its route', () => {
    expect(computeAffectedRoutes(['src/pages/guide.astro'], DEFAULT)).toEqual(['/guide/']);
    expect(computeAffectedRoutes(['src/pages/faq.astro'], DEFAULT)).toEqual(['/faq/']);
  });

  it('maps index.astro to /', () => {
    expect(computeAffectedRoutes(['src/pages/index.astro'], DEFAULT)).toEqual(['/']);
  });

  it('maps nested pages', () => {
    expect(
      computeAffectedRoutes(['src/pages/guide/getting-started.astro'], DEFAULT)
    ).toEqual(['/guide/getting-started/']);
  });

  it('returns "all" for layout changes', () => {
    expect(computeAffectedRoutes(['src/layouts/Layout.astro'], DEFAULT)).toBe('all');
  });

  it('returns "all" for component changes', () => {
    expect(computeAffectedRoutes(['src/components/Nav.astro'], DEFAULT)).toBe('all');
  });

  it('returns "all" for global style changes', () => {
    expect(computeAffectedRoutes(['src/styles/global.css'], DEFAULT)).toBe('all');
  });

  it('returns "all" for public asset changes', () => {
    expect(computeAffectedRoutes(['public/favicon.svg'], DEFAULT)).toBe('all');
  });

  it('falls back to "all" for unrecognized paths inside routeScope', () => {
    // src/weird.xyz is inside routeScope (src/**) but matches no specific rule
    expect(computeAffectedRoutes(['src/weird.xyz'], DEFAULT)).toBe('all');
  });

  it('returns [] for project-meta files outside routeScope', () => {
    // README.md, package.json, tsconfig.json etc. don't affect rendered routes
    expect(computeAffectedRoutes(['README.md'], DEFAULT)).toEqual([]);
    expect(computeAffectedRoutes(['package.json'], DEFAULT)).toEqual([]);
    expect(computeAffectedRoutes(['tsconfig.json'], DEFAULT)).toEqual([]);
  });

  it('short-circuits to "all" on any global match', () => {
    expect(
      computeAffectedRoutes(
        ['src/pages/faq.astro', 'src/layouts/Layout.astro'],
        DEFAULT
      )
    ).toBe('all');
  });

  it('dedupes and sorts specific-route results', () => {
    expect(
      computeAffectedRoutes(
        ['src/pages/guide.astro', 'src/pages/faq.astro', 'src/pages/guide.astro'],
        DEFAULT
      )
    ).toEqual(['/faq/', '/guide/']);
  });

  it('ignores non-src files in a mixed diff', () => {
    expect(
      computeAffectedRoutes(
        ['reference-impl/lib/cli.ts', 'src/pages/faq.astro'],
        DEFAULT
      )
    ).toEqual(['/faq/']);
  });
});

describe('loadAffectedRoutesConfig package default fallback', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'clv-affected-routes-fallback-'));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('loads the bundled default config', () => {
    const cfg = loadAffectedRoutesConfig(repoRoot);
    expect(cfg.pageRoots).toContain('src/pages/');
    expect(cfg.globalPatterns.length).toBeGreaterThanOrEqual(1);
    expect(cfg.routeScope).toContain('src/**');
  });

  it('includes empty contentRoutes on package default', () => {
    const cfg = loadAffectedRoutesConfig(repoRoot);
    expect(cfg.contentRoutes).toEqual({});
  });
});

describe('loadAffectedRoutesConfig', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'cloverleaf-affected-routes-'));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('returns package default when consumer override is absent', () => {
    const cfg = loadAffectedRoutesConfig(repoRoot);
    expect(cfg.pageRoots).toContain('src/pages/');
    expect(cfg.contentRoutes).toEqual({});
  });

  it('returns consumer override when present', () => {
    const overrideDir = join(repoRoot, '.cloverleaf', 'config');
    mkdirSync(overrideDir, { recursive: true });
    writeFileSync(
      join(overrideDir, 'affected-routes.json'),
      JSON.stringify({
        pageRoots: ['custom/pages/'],
        globalPatterns: [],
        routeScope: ['custom/**'],
        contentRoutes: { 'custom/content/blog/**': '/blog/' }
      })
    );
    const cfg = loadAffectedRoutesConfig(repoRoot);
    expect(cfg.pageRoots).toEqual(['custom/pages/']);
    expect(cfg.contentRoutes).toEqual({ 'custom/content/blog/**': '/blog/' });
  });

  it('defaults contentRoutes to empty object when consumer override omits it', () => {
    const overrideDir = join(repoRoot, '.cloverleaf', 'config');
    mkdirSync(overrideDir, { recursive: true });
    writeFileSync(
      join(overrideDir, 'affected-routes.json'),
      JSON.stringify({
        pageRoots: ['x/'],
        globalPatterns: [],
        routeScope: ['x/**']
      })
    );
    const cfg = loadAffectedRoutesConfig(repoRoot);
    expect(cfg.contentRoutes).toEqual({});
  });
});

describe('computeAffectedRoutes with contentRoutes', () => {
  it('maps a content file to its configured route', () => {
    const cfg = {
      pageRoots: ['src/pages/'],
      globalPatterns: [],
      routeScope: ['src/**'],
      contentRoutes: { 'src/content/guide/**': '/guide/' },
    };
    expect(
      computeAffectedRoutes(['src/content/guide/01-intro.mdx'], cfg)
    ).toEqual(['/guide/']);
  });

  it('contentRoutes evaluated after globalPatterns short-circuit', () => {
    const cfg = {
      pageRoots: [],
      globalPatterns: ['src/content/**'],
      routeScope: ['src/**'],
      contentRoutes: { 'src/content/guide/**': '/guide/' },
    };
    expect(
      computeAffectedRoutes(['src/content/guide/01.mdx'], cfg)
    ).toBe('all');
  });

  it('contentRoutes evaluated before routeScope fallback', () => {
    const cfg = {
      pageRoots: [],
      globalPatterns: [],
      routeScope: ['src/**'],
      contentRoutes: { 'src/content/guide/**': '/guide/' },
    };
    expect(
      computeAffectedRoutes(['src/content/guide/01.mdx'], cfg)
    ).toEqual(['/guide/']);
  });

  it('dedupes content-route results across multiple files mapping to same route', () => {
    const cfg = {
      pageRoots: [],
      globalPatterns: [],
      routeScope: ['src/**'],
      contentRoutes: { 'src/content/guide/**': '/guide/' },
    };
    expect(
      computeAffectedRoutes(
        ['src/content/guide/01.mdx', 'src/content/guide/02.mdx'],
        cfg
      )
    ).toEqual(['/guide/']);
  });
});
