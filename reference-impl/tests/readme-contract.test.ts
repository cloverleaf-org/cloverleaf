import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import satisfies from 'semver/functions/satisfies.js';

const ROOT = resolve(__dirname, '..');
const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf-8');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));

/**
 * README.md ships inside the package (it is in package.json's `files` allowlist),
 * so its claims are published artifacts. These two facts have an unambiguous
 * source of truth on disk, so they are checked mechanically rather than by eye.
 *
 * Deliberately NOT a vocabulary blocklist: prose stays free to discuss removed
 * states in a migration note without tripping the suite.
 */
describe('README contract', () => {
  it('documents exactly the skills that ship in skills/', () => {
    const onDisk = readdirSync(resolve(ROOT, 'skills'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    // Skill bullets only — anchored to list-item start so prose mentions of
    // `/cloverleaf-run` elsewhere in the document are not counted. Grouping the
    // list under subheadings is fine; the scan is whole-file.
    const documented = [
      ...new Set(
        [...readme.matchAll(/^-\s+`\/(cloverleaf-[a-z][a-z-]*)`/gm)].map((m) => m[1]),
      ),
    ].sort();

    // Equality, not subset: this must fail both when the README advertises a
    // skill that does not exist and when a shipped skill goes undocumented.
    expect(documented).toEqual(onDisk);
  });

  it('names a Standard version admitted by the dependency range', () => {
    const match = readme.match(/Cloverleaf Standard\]\([^)]*\)\s+v(\d+\.\d+\.\d+)/);
    expect(match, 'README must state the Standard version it implements').not.toBeNull();

    // Range satisfaction, not string equality: fails on a genuinely stale major
    // or minor without forcing a README edit on every Standard patch bump.
    const range = pkg.dependencies['@cloverleaf/standard'];
    expect(satisfies(match![1], range)).toBe(true);
  });
});
