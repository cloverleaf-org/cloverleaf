import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const SITE = resolve(__dirname, '..', '..', 'site', 'src');
const STANDARD_PKG = resolve(__dirname, '..', '..', 'standard', 'package.json');
const REFERENCE_README = resolve(__dirname, '..', 'README.md');
const COUNCIL_CONFIG = resolve(__dirname, '..', 'config', 'council.json');

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
 * matchAll throws on a non-global expression, and a non-global `.match()`
 * returns only the FIRST hit — so a second, stale occurrence added later sits
 * in a shipped page behind a green guard. The site lists below are swept with
 * this rather than matched once. Flags are preserved, not replaced.
 */
function everywhere(re: RegExp): RegExp {
  return re.flags.includes('g') ? re : new RegExp(re.source, re.flags + 'g');
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
 * Nav.astro renders each entry one of two ways: `external: true` emits the href
 * verbatim with target="_blank"; `external: false` passes it through url(),
 * which prefixes the '/cloverleaf' base. A wrong flag breaks the link silently
 * in whichever direction it is wrong — an absolute URL sent through url()
 * becomes '/cloverleaf/https://…', and a root-relative href marked external
 * escapes the base and 404s.
 *
 * The link guard above cannot see either case. It reads href="…" attributes out
 * of markup; these hrefs live in a frontmatter array and only become an
 * attribute after Astro renders it.
 */
const NAV_LINK = /\{\s*href:\s*'([^']+)'\s*,\s*label:\s*'([^']*)'\s*,\s*external:\s*(true|false)\s*\}/g;

describe('Nav entries agree with how Nav renders them', () => {
  const entries = [...read('components/Nav.astro').matchAll(NAV_LINK)].map((m) => ({
    href: m[1],
    label: m[2],
    external: m[3] === 'true',
  }));

  it('parses a non-empty link list', () => {
    // A renamed field or a reformatted array parses to nothing, which would
    // leave both checks below sweeping an empty set and reading as a pass.
    expect(
      entries.length,
      'no { href, label, external } entries found in Nav.astro',
    ).toBeGreaterThan(0);
  });

  it('every external entry is an absolute http(s) URL', () => {
    const offenders = entries
      .filter((e) => e.external && !/^https?:\/\//.test(e.href))
      .map((e) => `${e.label} -> ${e.href}`);
    expect(offenders).toEqual([]);
  });

  it('every internal entry is a root-relative path url() can prefix', () => {
    const offenders = entries
      .filter((e) => !e.external && !e.href.startsWith('/'))
      .map((e) => `${e.label} -> ${e.href}`);
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
      const all = [...read(site.file).matchAll(everywhere(site.re))];
      // Must find one. A reworded sentence has to fail loudly rather than
      // quietly become one fewer thing checked.
      expect(all.length, `no version matched ${site.re} in ${site.file}`).toBeGreaterThan(0);
      // And EVERY occurrence must be current, not merely the first one.
      for (const m of all) expect(m[1]).toBe(PKG_VERSION);
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
      const all = [...read(site.file).matchAll(everywhere(site.re))];
      expect(all.length, `no count matched ${site.re} in ${site.file}`).toBeGreaterThan(0);
      for (const m of all) expect(m[1]).toBe(String(rosterSize));
    });
  }
});


/**
 * DecisionGate.astro renders the two delivery council profiles inside chapter 9's
 * diagram. Nothing else in this repo read it: the link, version and roster guards
 * above check links, version strings and numerals, and none of them can see a
 * prose claim inside a diagram. It shipped naming neither the Security Reviewer
 * (which council.json seats in BOTH profiles when security_class is high) nor the
 * ui_changes condition on the UI Reviewer — the last instance of a defect class
 * that took three passes to correct in the guide prose surrounding it.
 *
 * This guard anchors EXTERNALLY, to the engine's own config/council.json. An
 * internal anchor would only catch the site disagreeing with itself and would
 * stay green if the config and the diagram ever went stale together — the hole
 * the roster guard above was found to have.
 *
 * MEMBER_NAMES and WHEN_PROSE are checked for completeness against the config, so
 * a member id or a `when` condition this file does not spell fails loudly instead
 * of being silently skipped.
 *
 * The full profile's card is written additively ("Adds ... and QA", matching
 * 11-glossary.mdx's "to the fast profile's seats"), so it is checked against the
 * members full seats that fast does not — not against its entire roster.
 */
const MEMBER_NAMES: Record<string, RegExp> = {
  // `Reviewer` alone must not be satisfied by `Security Reviewer` or `UI Reviewer`.
  reviewer: /(?<!Security )(?<!UI )\bReviewer\b/,
  security: /\bSecurity Reviewer\b/,
  ui: /\bUI Reviewer\b/,
  qa: /\bQA\b/,
};

const WHEN_PROSE: Record<string, RegExp> = {
  'security_class:high': /security_class is high/,
  ui_changes: /diff touches UI/,
};

// A card that signals it extends the other profile rather than replacing it.
const ADDITIVE = /\bAdds\b|\badditionally\b|^\s*\+/i;

type Seat = { member: string; when?: string };

function councilProfiles(): Record<string, Seat[]> {
  const cfg = JSON.parse(readFileSync(COUNCIL_CONFIG, 'utf-8'));
  const out: Record<string, Seat[]> = {};
  for (const [name, profile] of Object.entries<any>(cfg.profiles ?? {})) {
    out[name] = (profile.rounds ?? []).flat() as Seat[];
  }
  return out;
}

const DG_CARD =
  /<span class="dg-output-badge">([^<]+)<\/span>\s*<span class="dg-output-desc">([^<]+)<\/span>/g;

function decisionGateCards(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of read('components/DecisionGate.astro').matchAll(DG_CARD)) {
    out[m[1].trim()] = m[2].trim();
  }
  return out;
}

describe('the council diagram matches the council config it depicts', () => {
  const profiles = councilProfiles();
  const cards = decisionGateCards();

  it('reads both profiles, each with seats, from config/council.json', () => {
    // A renamed key or a parse that yields {} must not read as a pass.
    expect(Object.keys(profiles).sort()).toEqual(['delivery-fast', 'delivery-full']);
    for (const [name, seats] of Object.entries(profiles)) {
      expect(seats.length, `${name} parsed to no seats`).toBeGreaterThan(0);
    }
  });

  it('finds a card in DecisionGate.astro for exactly the configured profiles', () => {
    expect(Object.keys(cards).sort()).toEqual(Object.keys(profiles).sort());
    for (const [badge, desc] of Object.entries(cards)) {
      expect(desc.length, `${badge} card has an empty description`).toBeGreaterThan(0);
    }
  });

  it('spells every member id and `when` condition the config uses', () => {
    for (const [name, seats] of Object.entries(profiles)) {
      for (const seat of seats) {
        expect(
          MEMBER_NAMES[seat.member],
          `config/council.json seats "${seat.member}" in ${name}, which MEMBER_NAMES does not spell`,
        ).toBeDefined();
        if (seat.when) {
          expect(
            WHEN_PROSE[seat.when],
            `config/council.json gates on "${seat.when}" in ${name}, which WHEN_PROSE does not spell`,
          ).toBeDefined();
        }
      }
    }
  });

  it('the delivery-fast card names every member that profile seats', () => {
    const desc = cards['delivery-fast'];
    for (const seat of profiles['delivery-fast']) {
      expect(desc, `delivery-fast seats "${seat.member}" but the card omits it`).toMatch(
        MEMBER_NAMES[seat.member],
      );
      if (seat.when) {
        expect(
          desc,
          `delivery-fast seats "${seat.member}" only when "${seat.when}", which the card states unconditionally`,
        ).toMatch(WHEN_PROSE[seat.when]);
      }
    }
  });

  it('the delivery-full card names every member it adds to the fast profile', () => {
    const fast = new Set(profiles['delivery-fast'].map((s) => s.member));
    const delta = profiles['delivery-full'].filter((s) => !fast.has(s.member));
    const desc = cards['delivery-full'];

    // If full ever stops extending fast this guard is checking the wrong thing.
    expect(delta.length, 'delivery-full adds no member to delivery-fast').toBeGreaterThan(0);
    expect(desc, 'the delivery-full card does not read as extending delivery-fast').toMatch(ADDITIVE);

    for (const seat of delta) {
      expect(desc, `delivery-full adds "${seat.member}" but the card omits it`).toMatch(
        MEMBER_NAMES[seat.member],
      );
      if (seat.when) {
        expect(
          desc,
          `delivery-full seats "${seat.member}" only when "${seat.when}", which the card states unconditionally`,
        ).toMatch(WHEN_PROSE[seat.when]);
      }
    }
  });
});
