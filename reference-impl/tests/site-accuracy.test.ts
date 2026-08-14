import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const SITE = resolve(__dirname, '..', '..', 'site', 'src');

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
