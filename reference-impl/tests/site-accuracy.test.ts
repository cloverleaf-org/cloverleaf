import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const SITE = resolve(__dirname, '..', '..', 'site', 'src');
const STANDARD_PKG = resolve(__dirname, '..', '..', 'standard', 'package.json');
const REFERENCE_README = resolve(__dirname, '..', 'README.md');

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
    expect(links.length).toBeGreaterThanOrEqual(3);
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

/**
 * The count drifted three separate ways. 1546a66 created the guide at 7,
 * consistent with the matrix and the glossary. 14ffc35 changed 07-agents.mdx
 * to 8 for the Security Reviewer and touched none of the other five sites.
 * Meanwhile standard/agent-contracts/ reached its own eight by adding
 * chair.openapi.yaml — a different set, since no security-reviewer contract
 * exists. reference-impl/README.md lists the union: nine, all Real.
 *
 * The matrix is the roster; prose must agree with what it renders. Note
 * 07-agents.mdx's "8th role" ordinal is deliberately not a site here — an
 * ordinal is not a count, and that sentence no longer carries a number.
 */
const AGENT_CARD = /<span class="agent-name">/g;

/**
 * Internal parity cannot see collective staleness. 1546a66 created the whole
 * site at 7 — consistently — and every site above would have been green
 * throughout; when a tenth agent ships, the matrix and all eight numerals sit
 * silently at 9. Both sibling guards anchor outside the site (version →
 * standard/package.json, chapter anchors → guide frontmatter). This one anchors
 * to reference-impl/README.md's `### Agents` table, the artifact the
 * roster-of-nine decision was actually based on.
 *
 * The table runs from the `### Agents` heading to the next `### `. Its rows
 * begin with `| `; the `|---|---|---|` separator does not, so it drops out on
 * its own, leaving the header row plus one row per agent.
 */
function readmeAgentRows(): string[] {
  const body = readFileSync(REFERENCE_README, 'utf-8');
  const section = body.split(/^### Agents$/m)[1]?.split(/^### /m)[0] ?? '';
  return section.split('\n').filter((l) => l.startsWith('| '));
}

const ROSTER_SITES = [
  { label: 'ch.7 "defines N default agent roles"', file: 'content/guide/07-agents.mdx', re: /defines (\d+) default agent roles/ },
  { label: 'ch.7 "run all N"', file: 'content/guide/07-agents.mdx', re: /run all (\d+) by switching personas/ },
  { label: 'glossary "recommends N by default"', file: 'content/guide/11-glossary.mdx', re: /recommends (\d+) by default/ },
  { label: 'FAQ "The N agents"', file: 'pages/faq.astro', re: /The (\d+) agents are recommended roles/ },
  { label: 'FAQ "N agents) is settled"', file: 'pages/faq.astro', re: /(\d+) agents\) is settled/ },
  { label: 'start "The N default agents"', file: 'pages/start.astro', re: /The (\d+) default agents are a recommended split/ },
  { label: 'start "run all N"', file: 'pages/start.astro', re: /run all (\d+) in a single Claude session/ },
  { label: 'Hero stat line "N agents"', file: 'components/Hero.astro', re: /(\d+) agents/ },
];

describe('the site agrees with itself on how many agents Cloverleaf defines', () => {
  const rosterSize = [...read('components/AgentMatrix.astro').matchAll(AGENT_CARD)].length;

  it('counts a non-empty roster in AgentMatrix', () => {
    expect(rosterSize).toBeGreaterThan(5);
  });

  it('the rendered roster matches the reference-impl README agent table', () => {
    const rows = readmeAgentRows();
    // A renamed or removed heading parses to nothing, which must not read as a
    // pass. One header row plus at least one agent row is the floor.
    expect(rows.length, 'no `| ` rows found under `### Agents` in reference-impl/README.md').toBeGreaterThan(1);
    expect(rows.length - 1).toBe(rosterSize);
  });

  for (const site of ROSTER_SITES) {
    it(`${site.label} matches the rendered roster`, () => {
      const m = read(site.file).match(site.re);
      expect(m, `no count matched ${site.re} in ${site.file}`).not.toBeNull();
      expect(m![1]).toBe(String(rosterSize));
    });
  }
});
