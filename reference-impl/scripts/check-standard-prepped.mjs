#!/usr/bin/env node
/**
 * check-standard-prepped.mjs
 *
 * Sanity-check run as the first step of `prepublishOnly`.
 *
 * Walks up from `process.cwd()` until it finds a directory that contains
 * `standard/package.json`, treating that directory as the repo root.
 * Then verifies that both `standard/dist/` and `standard/node_modules/`
 * exist.  If either is absent, prints an actionable error to stderr and
 * exits with code 1.  If both are present, exits 0 with no output.
 */

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Walk up from `startDir` looking for a directory that contains
 * `standard/package.json`.  Returns the repo root when found, or null
 * if the filesystem root is reached without finding it.
 *
 * @param {string} startDir
 * @returns {string | null}
 */
function findRepoRoot(startDir) {
  let current = startDir;
  while (true) {
    if (existsSync(join(current, 'standard', 'package.json'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      // Filesystem root — not found.
      return null;
    }
    current = parent;
  }
}

const cwd = process.cwd();
const repoRoot = findRepoRoot(cwd);

if (repoRoot === null) {
  process.stderr.write(
    'ERROR: standard/ is not prepped in this environment.\n' +
    'Run:  cloverleaf-cli prep-worktree <primaryRoot> <worktreeRoot>\n' +
    '  OR: (cd ../standard && npm ci && npm run build)\n',
  );
  process.exit(1);
}

const distOk = existsSync(join(repoRoot, 'standard', 'dist'));
const nmOk   = existsSync(join(repoRoot, 'standard', 'node_modules'));

if (!distOk || !nmOk) {
  process.stderr.write(
    'ERROR: standard/ is not prepped in this environment.\n' +
    'Run:  cloverleaf-cli prep-worktree <primaryRoot> <worktreeRoot>\n' +
    '  OR: (cd ../standard && npm ci && npm run build)\n',
  );
  process.exit(1);
}

// Both present — all good, exit 0 with no output.
