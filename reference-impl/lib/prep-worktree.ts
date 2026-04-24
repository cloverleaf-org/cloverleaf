import { cpSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

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
 */
export function prepWorktree(mainRoot: string, worktreePath: string): void {
  const mainStandardNm = join(mainRoot, 'standard', 'node_modules');
  const mainRefImplNm = join(mainRoot, 'reference-impl', 'node_modules');
  const wtStandardPkg = join(worktreePath, 'standard', 'package.json');
  const wtRefImplPkg = join(worktreePath, 'reference-impl', 'package.json');

  if (!existsSync(wtStandardPkg)) {
    throw new Error(`worktree missing standard/package.json at ${wtStandardPkg}`);
  }
  if (!existsSync(wtRefImplPkg)) {
    throw new Error(`worktree missing reference-impl/package.json at ${wtRefImplPkg}`);
  }
  if (!existsSync(mainStandardNm)) {
    throw new Error(`main missing standard/node_modules at ${mainStandardNm} — run \`npm ci\` in main's standard/ first`);
  }
  if (!existsSync(mainRefImplNm)) {
    throw new Error(`main missing reference-impl/node_modules at ${mainRefImplNm} — run \`npm ci\` in main's reference-impl/ first`);
  }

  const wtStandardNm = join(worktreePath, 'standard', 'node_modules');
  const wtRefImplNm = join(worktreePath, 'reference-impl', 'node_modules');

  // verbatimSymlinks keeps relative symlink targets byte-identical, so the @cloverleaf/standard
  // link in reference-impl/node_modules/ resolves against the worktree after copy.
  cpSync(mainStandardNm, wtStandardNm, { recursive: true, verbatimSymlinks: true });
  cpSync(mainRefImplNm, wtRefImplNm, { recursive: true, verbatimSymlinks: true });

  execSync('npm run build', {
    cwd: join(worktreePath, 'standard'),
    stdio: 'pipe',
  });
}
