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

/** Directories holding `file`, repo-relative. node_modules is skipped: a vendored
 *  dependency's metadata is not this repo's to keep in sync. */
function findPackagesWith(file: string, dir: string = REPO): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...findPackagesWith(file, full));
    else if (entry === file) out.push(relative(REPO, dir));
  }
  return out;
}

const LOCKED_PACKAGES = findPackagesWith('package-lock.json').sort();

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

/**
 * The same rule one file over, and this one is worse. A published package's version is
 * also written to a plain `VERSION` file, and unlike a lockfile that file *ships* —
 * `VERSION` is in the `files` array of both `standard` and `reference-impl`, so a stale
 * one is not merely repo-internal untidiness, it is wrong in the installed tarball.
 * Nothing checked it. Of the six-site reference-impl bump list this is the entry carried
 * by a release note alone: `package.json` is the source, `tests/skills.test.ts` trips on
 * its own hardcoded assertion, and the two lockfile fields are covered above.
 *
 * The `standard/VERSION` read at the top of this file looks like it already covers this.
 * It does not: it asks whether reference-impl's declared *range* (`^0.8.0`) admits that
 * version, so `standard/VERSION` could sit at 0.8.2 against a package.json of 0.8.3 and
 * still satisfy it. A range check is not an equality check — verified by mutation, which
 * leaves both range assertions green.
 */

/**
 * Two packages, not the three above: `site` has no VERSION file, being unpublished and
 * versioned only by its package.json. The roster is derived rather than named for the
 * same reason as the lockfile walk, and here the pin reaches in both directions — a
 * VERSION file added to a new package trips it, and so does one deleted from an existing
 * package, which nothing else in the suite would notice for `reference-impl`.
 *
 * ⚠ `reference-impl/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` also
 * carry versions and are deliberately NOT in lockstep — they bump on feature releases
 * only, and the patch train leaves them behind (0.13.2 against a package.json of 0.13.4
 * as this is written). They are decoys, not omissions. Do not extend this guard to them.
 */
const EXPECTED_VERSIONED_PACKAGES = ['reference-impl', 'standard'];

const VERSIONED_PACKAGES = findPackagesWith('VERSION').sort();

describe('package contract: VERSION files track package.json', () => {
  it('finds every VERSION-bearing package in the repo', () => {
    expect(VERSIONED_PACKAGES).toEqual(EXPECTED_VERSIONED_PACKAGES);
  });

  for (const dir of VERSIONED_PACKAGES) {
    it(`${dir}: VERSION matches package.json`, () => {
      const version = readFileSync(resolve(REPO, dir, 'VERSION'), 'utf-8').trim();
      const pkgVersion = JSON.parse(
        readFileSync(resolve(REPO, dir, 'package.json'), 'utf-8'),
      ).version;
      expect(version).toBe(pkgVersion);
    });
  }
});
