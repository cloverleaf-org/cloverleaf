import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const DOC = resolve(ROOT, 'docs', 'conformance.md');
const PKG_VERSION = JSON.parse(
  readFileSync(resolve(ROOT, 'package.json'), 'utf-8'),
).version as string;

/**
 * `docs/conformance.md` tells adopters to publish a conformance statement and shows one:
 * *"Implements Cloverleaf Standard X.Y.Z at L2."* Nothing pinned that string, so it sat at
 * 0.8.1 through two releases while the package moved to 0.8.2 — the document that defines
 * how to cite a version was itself citing a stale one. It is an illustrative `e.g.` the
 * reader substitutes, which is why it kept being left; the cost of leaving it is that the
 * staleness compounds every release and nothing ever says so.
 *
 * `docs/` is in this package's `files`, so this text ships to consumers.
 *
 * ## The one literal in this file that must NOT track the version
 *
 * Line 58 also says 0.8.1 — *"The runner's own imports … arrive with the package as of
 * 0.8.1"* — and it is correct. It names the release that added `@apidevtools/swagger-parser`,
 * `ajv` and `ajv-formats` as runtime dependencies, verifiable against the tags:
 * `standard/package.json` has no `dependencies` at v0.8.0-standard and all three at
 * v0.8.1-standard. A file-wide version sweep would rewrite it into a false claim about
 * when those dependencies arrived. Two literals, one target, one decoy — so the decoy is
 * asserted here as a fixed historical fact rather than left to be rediscovered.
 *
 * ## Consequence for releases
 *
 * This binds the doc to `package.json`, so a version bump fails this suite until the
 * example is substituted. That is the point: `docs/conformance.md` now belongs on the
 * list of files a Standard bump touches.
 */
describe('the example conformance statement cites the version this package ships', () => {
  const doc = readFileSync(DOC, 'utf-8');

  it('reads a version from package.json', () => {
    expect(PKG_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('shows an example conformance statement at all', () => {
    // If the sentence is reworded away, this must fail loudly rather than
    // quietly become one fewer thing checked.
    const found = [...doc.matchAll(/Implements Cloverleaf Standard ([\d.]+) at L\d/g)];
    expect(found.length, 'no example conformance statement found in docs/conformance.md').toBeGreaterThan(0);
  });

  it('cites the current version in every example statement', () => {
    // Every occurrence, not merely the first — a second example added later
    // must not be able to drift behind unnoticed.
    for (const m of doc.matchAll(/Implements Cloverleaf Standard ([\d.]+) at L\d/g)) {
      expect(m[1], `example conformance statement cites ${m[1]}, package is ${PKG_VERSION}`).toBe(PKG_VERSION);
    }
  });

  it('leaves the runtime-dependency provenance note pinned to 0.8.1', () => {
    // The decoy. This is history, not a current-version reference: the three
    // runtime deps entered the package at 0.8.1 and that stays true forever.
    // It is pinned so a version sweep across this file fails here instead of
    // silently converting a true statement into a false one.
    expect(doc).toMatch(/arrive with the package as of 0\.8\.1/);
  });
});
