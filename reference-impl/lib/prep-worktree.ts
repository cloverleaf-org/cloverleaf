import { cpSync, existsSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { loadDiscoveryConfig } from './discovery-config.js';

/**
 * Prepare a freshly-created git worktree of the cloverleaf monorepo for running reference-impl
 * tests. Addresses the v0.5 dogfood finding (CLV-16, CLV-17 Delivery runs) where Reviewer/QA
 * subagents hit `Cannot find module '@cloverleaf/standard/validators/index.js'` because:
 *
 *   1. The worktree has no `node_modules` at all (git worktrees don't inherit it).
 *   2. Running `npm install` in the worktree's `reference-impl/` follows the `file:../standard`
 *      dep, but the worktree's `standard/` has no `dist/` (nothing built) and no `node_modules/`
 *      (ajv-formats etc., needed by the conformance runner).
 *
 * Strategy: reuse main's already-installed deps and build standard/ fresh from the worktree
 * sources so any branch changes to `standard/src` are picked up.
 *
 *   - Copy `<main>/standard/node_modules`       → `<wt>/standard/node_modules`
 *   - Run `npm run build`                       in `<wt>/standard`  (produces worktree dist/)
 *   - Copy `<main>/reference-impl/node_modules` → `<wt>/reference-impl/node_modules`
 *     The `@cloverleaf/standard → ../../../standard` relative symlink is preserved verbatim so
 *     it resolves to the worktree's OWN standard/, not main's.
 *
 * Walker-mode resilience (CLV-37): when `mainRoot` is itself a walker worktree without
 * node_modules, walk up ancestor directories until one is found that contains both
 * `standard/node_modules` and `reference-impl/node_modules`. This allows the orchestrator to
 * pass the current walker worktree path without needing to know the actual primary repo root.
 */

/**
 * Walk up the directory tree from `startDir` until a directory is found that contains both
 * `standard/node_modules` and `reference-impl/node_modules`. Returns that directory, or null
 * if the filesystem root is reached without finding one.
 */
function findPrimaryRoot(startDir: string): string | null {
  let candidate = startDir;
  while (true) {
    if (
      existsSync(join(candidate, 'standard', 'node_modules')) &&
      existsSync(join(candidate, 'reference-impl', 'node_modules'))
    ) {
      return candidate;
    }
    const parent = dirname(candidate);
    if (parent === candidate) {
      // Reached filesystem root without finding a match.
      return null;
    }
    candidate = parent;
  }
}

/**
 * Walk up from `startDir` to find the nearest ancestor where the given `subdir` exists.
 * Returns the ancestor path, or null if the filesystem root is reached without a match.
 */
function findNearestAncestorWithSubdir(startDir: string, subdir: string): string | null {
  let candidate = startDir;
  while (true) {
    if (existsSync(join(candidate, subdir))) {
      return candidate;
    }
    const parent = dirname(candidate);
    if (parent === candidate) {
      return null;
    }
    candidate = parent;
  }
}

/**
 * Build a diagnostic error message when `findPrimaryRoot` fails to find an ancestor with
 * both `standard/node_modules` and `reference-impl/node_modules`. Walks up separately for
 * each subdirectory to produce a precise message naming the specific missing directory.
 */
function buildMissingNodeModulesError(mainRoot: string): Error {
  const hasStandard = findNearestAncestorWithSubdir(mainRoot, join('standard', 'node_modules'));
  const hasRefImpl = findNearestAncestorWithSubdir(mainRoot, join('reference-impl', 'node_modules'));

  if (hasStandard !== null && hasRefImpl === null) {
    // standard/node_modules exists somewhere in the tree but reference-impl/node_modules does not.
    const missing = join(hasStandard, 'reference-impl', 'node_modules');
    return new Error(`main missing reference-impl/node_modules at ${missing} — run \`npm ci\` in main's reference-impl/ first`);
  }
  if (hasRefImpl !== null && hasStandard === null) {
    // reference-impl/node_modules exists somewhere in the tree but standard/node_modules does not.
    const missing = join(hasRefImpl, 'standard', 'node_modules');
    return new Error(`main missing standard/node_modules at ${missing} — run \`npm ci\` in main's standard/ first`);
  }
  // Neither found (or both missing): fall back to reporting standard/node_modules against the
  // original mainRoot argument (preserves prior behaviour for the truly-empty case).
  const mainStandardNm = join(mainRoot, 'standard', 'node_modules');
  return new Error(`main missing standard/node_modules at ${mainStandardNm} — run \`npm ci\` in main's standard/ first`);
}

export function prepWorktree(mainRoot: string, worktreePath: string): void {
  const embedded =
    existsSync(join(worktreePath, 'standard', 'package.json')) &&
    existsSync(join(worktreePath, 'reference-impl', 'package.json'));

  // configRoot is where .cloverleaf/config/discovery.json is read from. Embedded mode
  // walks up to the primary repo (which holds node_modules + the config); a non-monorepo
  // consumer uses mainRoot directly.
  let configRoot: string;
  if (embedded) {
    const resolvedMain = findPrimaryRoot(mainRoot);
    if (resolvedMain === null) {
      throw buildMissingNodeModulesError(mainRoot);
    }
    configRoot = resolvedMain;
  } else {
    configRoot = mainRoot;
  }

  const config = loadDiscoveryConfig(configRoot);

  if (embedded) {
    // Embedded / monorepo mode: prime the cloverleaf TS tooling (unchanged behavior).
    copyEmbeddedArtifacts(configRoot, worktreePath);
  }

  // Both modes: copy any gitignored dirs the consumer's tests/briefs reference.
  copyPrepDirs(configRoot, config.prep_copy_dirs, worktreePath);

  if (embedded) {
    // Build standard/ fresh from the worktree's own sources.
    execSync('npm run build', {
      cwd: join(worktreePath, 'standard'),
      stdio: 'pipe',
    });
  }

  // Both modes: run the consumer's worktree setup command, if configured.
  if (config.worktree_setup_command.trim() !== '') {
    execSync(config.worktree_setup_command, {
      cwd: worktreePath,
      stdio: 'pipe',
    });
  }
}

/**
 * Embedded / monorepo mode: copy the primary repo's installed cloverleaf TS deps + built
 * dist into the worktree, preserving the @cloverleaf/standard relative symlink. (See the
 * file header for the CLV-16/17/37/52 history.)
 */
function copyEmbeddedArtifacts(resolvedMain: string, worktreePath: string): void {
  primeCopy(join(resolvedMain, 'standard', 'node_modules'), join(worktreePath, 'standard', 'node_modules'));
  primeCopy(join(resolvedMain, 'reference-impl', 'node_modules'), join(worktreePath, 'reference-impl', 'node_modules'));
  primeCopy(join(resolvedMain, 'reference-impl', 'dist'), join(worktreePath, 'reference-impl', 'dist'));
}

/**
 * Honor discovery_config.prep_copy_dirs: copy each listed gitignored directory from
 * configRoot into the worktree. Missing entries warn and are skipped.
 */
function copyPrepDirs(configRoot: string, dirs: string[], worktreePath: string): void {
  for (const dir of dirs) {
    const srcPath = join(configRoot, dir);
    const dstPath = join(worktreePath, dir);
    if (!existsSync(srcPath)) {
      process.stderr.write(`prep-worktree: prep_copy_dirs entry '${dir}' not found at ${srcPath} — skipping.\n`);
      continue;
    }
    primeCopy(srcPath, dstPath);
  }
}

function primeCopy(src: string, dst: string): void {
  if (existsSync(dst)) {
    rmSync(dst, { recursive: true, force: true });
  }
  cpSync(src, dst, { recursive: true, verbatimSymlinks: true });
}
