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
