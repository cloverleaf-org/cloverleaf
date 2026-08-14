import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const SITE = resolve(__dirname, '..', '..', 'site', 'src');
const STANDARD_PKG = resolve(__dirname, '..', '..', 'standard', 'package.json');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function read(rel: string): string {
  return readFileSync(resolve(SITE, rel), 'utf-8');
}

/**
 * The site renders every chapter onto one page: guide.astro emits
 * `id={`chapter-${c.data.chapter}`}` per chapter, and `base: '/cloverleaf'`
 * means a raw `/guide/...` href resolves outside the base entirely. A branch
 * once shipped five links that satisfied neither rule — including the pointer
 * added by the very commit that was fixing the topic it pointed at. All five
 * survived `astro check`, four commits and three task reviews, because nothing
 * in this repo watches links.
 *
 * Anchors are resolved against the chapter numbers actually present in guide
 * frontmatter, not merely shape-matched, so a link to a chapter that does not
 * exist fails too.
 */
const MD_LINK = /\[[^\]]*\]\(([^)]+)\)/g;
const EXTERNAL = /^(https?:\/\/|mailto:)/;
const RAW_INTERNAL_HREF = /href\s*=\s*"(\/[^"]*)"/g;
const CHAPTER_ANCHOR_LITERAL = /#chapter-\d+/g;

function chapterAnchors(): Set<string> {
  const dir = resolve(SITE, 'content', 'guide');
  const out = new Set<string>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.mdx')) continue;
    const m = readFileSync(join(dir, f), 'utf-8').match(/^chapter:\s*(\d+)\s*$/m);
    if (m) out.add(`#chapter-${m[1]}`);
  }
  return out;
}

describe('every site link resolves', () => {
  const pages = walk(SITE).filter((f) => f.endsWith('.astro') || f.endsWith('.mdx'));
  const anchors = chapterAnchors();
  const links = pages.flatMap((f) =>
    [...readFileSync(f, 'utf-8').matchAll(MD_LINK)].map((m) => ({
      file: relative(SITE, f),
      href: m[1].trim(),
    })),
  );

  it('sweeps a non-empty page surface', () => {
    // A sweep that silently matched no files would read exactly like a pass.
    expect(pages.length).toBeGreaterThan(20);
  });

  it('derives the chapter anchors guide.astro actually emits', () => {
    // An empty anchor set would pass every link by accident.
    expect(anchors.size).toBeGreaterThan(5);
  });

  it('finds the markdown links it claims to check', () => {
    expect(links.length).toBeGreaterThanOrEqual(5);
  });

  it('every markdown link is external or a resolving chapter anchor', () => {
    const offenders = links
      .filter((l) => !EXTERNAL.test(l.href) && !anchors.has(l.href))
      .map((l) => `${l.file} -> ${l.href}`);
    expect(offenders).toEqual([]);
  });

  it('every #chapter-N literal resolves, even outside markdown link syntax', () => {
    // MD_LINK only matches `[text](url)`. start.astro builds its chapter
    // link as `url('/guide') + '#chapter-7'`, a JS string literal that
    // markdown syntax never sees, so a renumbered or removed chapter would go
    // dead there and MD_LINK would stay silent. guide.astro's own
    // `#chapter-${c.data.chapter}` is a template expression, not a fixed
    // literal — CHAPTER_ANCHOR_LITERAL requires a digit immediately after the
    // dash, so it does not match and is not an offender.
    const offenders: string[] = [];
    for (const f of pages) {
      for (const m of readFileSync(f, 'utf-8').matchAll(CHAPTER_ANCHOR_LITERAL)) {
        if (!anchors.has(m[0])) offenders.push(`${relative(SITE, f)} -> ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no internal href bypasses the base-aware url() helper', () => {
    // SVG fragment refs (href="#icon-...") start with '#', not '/', and are
    // untouched. Nav.astro's unwrapped href={link.href} is the external:true
    // branch, where base-prefixing an absolute URL would break it.
    const offenders: string[] = [];
    for (const f of pages) {
      for (const m of readFileSync(f, 'utf-8').matchAll(RAW_INTERNAL_HREF)) {
        offenders.push(`${relative(SITE, f)} -> ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * The footer renders on every page. It said v0.3.0 while the package said
 * 0.8.0 and npm's latest was 0.7.1 — wrong against both the repo and the world.
 *
 * Deliberately a guard rather than build-time derivation: site.yml deploys on
 * any push to main touching site/**, so deriving would let a future version
 * bump silently republish the guide against an npm release that does not exist
 * yet. This fails loudly instead and forces the decision at bump time.
 */
const PKG_VERSION: string = JSON.parse(readFileSync(STANDARD_PKG, 'utf-8')).version;

const VERSION_SITES = [
  { label: 'Footer standardVersion const', file: 'components/Footer.astro', re: /const standardVersion = '([\d.]+)'/ },
  { label: 'Hero stat line', file: 'components/Hero.astro', re: /Standard v([\d.]+)/ },
  { label: 'FAQ "is the methodology stable"', file: 'pages/faq.astro', re: /Standard v([\d.]+)/ },
  { label: 'FAQ "how do I cite Cloverleaf"', file: 'pages/faq.astro', re: /currently v([\d.]+)/ },
];

describe('the site states the Standard version it ships against', () => {
  it('reads a version from standard/package.json', () => {
    expect(PKG_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  for (const site of VERSION_SITES) {
    it(`${site.label} matches standard/package.json`, () => {
      const m = read(site.file).match(site.re);
      // Must find one. A reworded sentence has to fail loudly rather than
      // quietly become one fewer thing checked.
      expect(m, `no version matched ${site.re} in ${site.file}`).not.toBeNull();
      expect(m![1]).toBe(PKG_VERSION);
    });
  }
});
