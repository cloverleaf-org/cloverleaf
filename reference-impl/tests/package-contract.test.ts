import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import satisfies from 'semver/functions/satisfies.js';

const ROOT = resolve(__dirname, '..');
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
