import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const LIB = resolve(__dirname, '..', 'lib');

/**
 * The `path` argument (`fast_lane` / `full_pipeline`) was the reference-impl half of a
 * distinction the collapsed 0.13.0 delivery FSM no longer makes. It reached from a CLI
 * positional through `advanceStatus` into the emitted event's `reason` field, and on the
 * way it silently overrode the task's own declared `risk_class` in the fixture handed to
 * the validators. Nothing in-tree ever passed it. These guards keep it gone.
 *
 * Scoped to `lib/` — `tests/` has to spell the forbidden words in order to forbid them,
 * and CHANGELOG.md is the historical record of the removal.
 */
const LANE = /fast_lane|full_pipeline/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe('the retired delivery-lane vocabulary stays out of reference-impl', () => {
  const swept = walk(LIB);

  it('sweeps a non-empty lib surface', () => {
    // A sweep that silently matched nothing would read exactly like a pass.
    expect(swept.length).toBeGreaterThan(30);
  });

  it('no lib source names a delivery lane', () => {
    const offenders = swept
      .filter((f) => LANE.test(readFileSync(f, 'utf-8')))
      .map((f) => relative(LIB, f));
    expect(offenders).toEqual([]);
  });
});

const SITE = resolve(__dirname, '..', '..', 'site', 'src');

/**
 * Slice 4 collapsed the two-lane delivery topology into one path whose council
 * composition varies by risk_class. The guide kept describing the retired model:
 * a fast/full lane split, an `automated-gates` hub, and security_gate /
 * resets_security_verdict annotations on edges out of it. The §PATH sweep covered
 * `standard/` and `reference-impl/lib` but not `site/`, which is how this survived.
 *
 * The glossary is allowed one designated block naming the retired terms, so a reader
 * holding an older document can map it onto the current model. Everything else in
 * site/src is swept.
 */
const RETIRED_DELIVERY =
  /fast[ _-]lane|full[ _-]pipeline|automated[ _-]gates|resets_security_verdict|both lanes|two[ -]lanes?/i;

const RETIRED_VOCAB_HEADING = '### Retired vocabulary';

function sweepableText(file: string): string {
  const src = readFileSync(file, 'utf-8');
  if (!file.endsWith('11-glossary.mdx')) return src;
  const cut = src.indexOf(RETIRED_VOCAB_HEADING);
  // Heading renamed or removed → sweep the whole file → the offenders assertion fails
  // loudly rather than the exclusion silently widening.
  return cut === -1 ? src : src.slice(0, cut);
}

describe('the retired delivery topology stays out of the site', () => {
  const swept = walk(SITE);
  const glossary = resolve(SITE, 'content', 'guide', '11-glossary.mdx');

  it('sweeps a non-empty site surface', () => {
    // A sweep that silently matched nothing would read exactly like a pass.
    expect(swept.length).toBeGreaterThan(30);
  });

  it('no site source names the retired delivery topology', () => {
    const offenders = swept
      .filter((f) => RETIRED_DELIVERY.test(sweepableText(f)))
      .map((f) => relative(SITE, f));
    expect(offenders).toEqual([]);
  });

  it('the glossary exclusion is real and narrow', () => {
    // It must remove something (otherwise it is decorative and the migration note is
    // missing) and must not swallow the file (otherwise the glossary is unswept).
    const whole = readFileSync(glossary, 'utf-8');
    const sweepable = sweepableText(glossary);
    const excluded = whole.slice(sweepable.length);
    expect(RETIRED_DELIVERY.test(whole)).toBe(true);
    expect(sweepable.length).toBeLessThan(whole.length);
    expect(sweepable).toContain('**DAG**'); // does not swallow the front
    expect(sweepable).toContain('**Work Item**'); // nor the last real entry
    expect(excluded).not.toMatch(/^\*\*/m); // only the mapping block lives past the heading
  });
});
