import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import satisfies from 'semver/functions/satisfies.js';

const ROOT = resolve(__dirname, '..');
const REPO = resolve(ROOT, '..');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
const standardVersion = readFileSync(resolve(ROOT, '..', 'standard', 'VERSION'), 'utf-8').trim();

describe('package contract: @cloverleaf/standard range', () => {
  it('peerDependencies range admits the standard version this repo builds against', () => {
    const range = pkg.peerDependencies['@cloverleaf/standard'];
    expect(satisfies(standardVersion, range)).toBe(true);
  });

  it('dependencies range admits the standard version this repo builds against', () => {
    const range = pkg.dependencies['@cloverleaf/standard'];
    expect(satisfies(standardVersion, range)).toBe(true);
  });
});

/**
 * A package.json version has two twins in its package-lock.json — the lockfile's root
 * `.version` and `.packages[""].version`. `npm install` rewrites both; a hand-edited
 * bump touches neither, and nothing downstream ever complains, because npm does not
 * publish lockfiles. The drift is invisible outside this repo.
 *
 * It has already happened here. `standard/package-lock.json` sat at 0.8.1 through the
 * entire 0.8.2 release while `standard/package.json` said 0.8.2, and was caught by hand
 * mid-release during 0.8.3. Until this guard the rule was carried by a release note
 * asking a human to remember it.
 *
 * The roster is derived by walking the tree rather than naming the packages, so a
 * package added later is checked the day it arrives instead of the day someone
 * remembers to extend a list.
 */

/** Directories holding a package-lock.json, repo-relative. node_modules is skipped:
 *  a vendored dependency's lockfile is not this repo's to keep in sync. */
function findLockedPackages(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...findLockedPackages(full));
    else if (entry === 'package-lock.json') out.push(relative(REPO, dir));
  }
  return out;
}

const LOCKED_PACKAGES = findLockedPackages(REPO).sort();

/**
 * `site` is in scope despite being unpublished and parked at 0.1.0. Excluding it would
 * mean carving a named exception into a guard whose whole point is that the roster is
 * derived, not curated — and its lockfile drifts like any other the first time the site
 * is bumped. `reference-impl/examples/toy-repo` is absent for a structural reason, not
 * an exception: it is a fixture with a package.json and no lockfile, so there is no
 * pair to keep in sync.
 */
const EXPECTED_LOCKED_PACKAGES = ['reference-impl', 'site', 'standard'];

describe('package contract: lockfile versions track package.json', () => {
  // Pinning the roster is what stops an empty or mis-rooted walk from reading as a pass,
  // and makes adding a package a deliberate edit here rather than a silent unguarding.
  it('finds every lockfile-bearing package in the repo', () => {
    expect(LOCKED_PACKAGES).toEqual(EXPECTED_LOCKED_PACKAGES);
  });

  // Two assertions per package, not one: the fields are written independently and one
  // can be correct while the other is stale.
  for (const dir of LOCKED_PACKAGES) {
    const read = (file: string) =>
      JSON.parse(readFileSync(resolve(REPO, dir, file), 'utf-8'));

    it(`${dir}: lockfile root .version matches package.json`, () => {
      expect(read('package-lock.json').version).toBe(read('package.json').version);
    });

    it(`${dir}: lockfile .packages[""].version matches package.json`, () => {
      expect(read('package-lock.json').packages['']?.version).toBe(read('package.json').version);
    });
  }
});
