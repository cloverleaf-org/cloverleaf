import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync, readlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepWorktree } from '../lib/prep-worktree.js';

// Fakes a `main` and `worktree` tree mirroring the cloverleaf repo layout (reference-impl/ + standard/),
// then asserts that prepWorktree populates the worktree with (a) standard/node_modules, (b) standard/dist via
// the branch's own build script, and (c) reference-impl/node_modules — preserving the @cloverleaf/standard
// relative symlink so it resolves to the worktree's own standard/.

let main: string;
let wt: string;

beforeEach(() => {
  main = mkdtempSync(join(tmpdir(), 'cl-prep-main-'));
  wt = mkdtempSync(join(tmpdir(), 'cl-prep-wt-'));

  // Main: a populated repo
  // standard/
  mkdirSync(join(main, 'standard'), { recursive: true });
  writeFileSync(
    join(main, 'standard', 'package.json'),
    JSON.stringify({
      name: '@cloverleaf/standard',
      version: '0.0.0-test',
      scripts: {
        // Tiny build stand-in so we don't need real tsc in the test.
        build: 'mkdir -p dist && echo built-from-worktree > dist/marker.txt',
      },
    }) + '\n',
  );
  mkdirSync(join(main, 'standard', 'node_modules'), { recursive: true });
  mkdirSync(join(main, 'standard', 'node_modules', 'some-dep'), { recursive: true });
  writeFileSync(join(main, 'standard', 'node_modules', 'some-dep', 'package.json'), '{"name":"some-dep"}');

  // reference-impl/
  mkdirSync(join(main, 'reference-impl'), { recursive: true });
  writeFileSync(
    join(main, 'reference-impl', 'package.json'),
    JSON.stringify({
      name: '@cloverleaf/reference-impl',
      version: '0.0.0-test',
      dependencies: { '@cloverleaf/standard': 'file:../standard' },
    }) + '\n',
  );
  mkdirSync(join(main, 'reference-impl', 'node_modules', '@cloverleaf'), { recursive: true });
  // The relative symlink npm creates for a file: workspace dep. Copy this literally → worktree should resolve
  // to its own standard/, not main's.
  symlinkSync('../../../standard', join(main, 'reference-impl', 'node_modules', '@cloverleaf', 'standard'));
  mkdirSync(join(main, 'reference-impl', 'node_modules', 'vitest'), { recursive: true });
  writeFileSync(
    join(main, 'reference-impl', 'node_modules', 'vitest', 'package.json'),
    '{"name":"vitest"}',
  );

  // Worktree: bare checkout — just source files, no node_modules, no dist
  mkdirSync(join(wt, 'standard'), { recursive: true });
  writeFileSync(
    join(wt, 'standard', 'package.json'),
    JSON.stringify({
      name: '@cloverleaf/standard',
      version: '0.0.0-test',
      scripts: {
        build: 'mkdir -p dist && echo built-from-worktree > dist/marker.txt',
      },
    }) + '\n',
  );
  mkdirSync(join(wt, 'reference-impl'), { recursive: true });
  writeFileSync(
    join(wt, 'reference-impl', 'package.json'),
    JSON.stringify({
      name: '@cloverleaf/reference-impl',
      version: '0.0.0-test',
      dependencies: { '@cloverleaf/standard': 'file:../standard' },
    }) + '\n',
  );
});

afterEach(() => {
  rmSync(main, { recursive: true, force: true });
  rmSync(wt, { recursive: true, force: true });
});

describe('prepWorktree', () => {
  it('copies standard/node_modules from main to worktree', () => {
    prepWorktree(main, wt);
    expect(existsSync(join(wt, 'standard', 'node_modules'))).toBe(true);
    expect(existsSync(join(wt, 'standard', 'node_modules', 'some-dep', 'package.json'))).toBe(true);
  });

  it('runs the standard build script inside the worktree (dist/ comes from worktree sources)', () => {
    prepWorktree(main, wt);
    expect(existsSync(join(wt, 'standard', 'dist', 'marker.txt'))).toBe(true);
  });

  it('copies reference-impl/node_modules including non-symlink deps', () => {
    prepWorktree(main, wt);
    expect(existsSync(join(wt, 'reference-impl', 'node_modules', 'vitest', 'package.json'))).toBe(true);
  });

  it('preserves the @cloverleaf/standard relative symlink so it resolves to the worktree standard/', () => {
    prepWorktree(main, wt);
    const linkPath = join(wt, 'reference-impl', 'node_modules', '@cloverleaf', 'standard');
    // The literal target must be unchanged — relative path, not dereferenced to main's standard.
    expect(readlinkSync(linkPath)).toBe('../../../standard');
    // And it resolves to the worktree's own standard/, not main's.
    expect(realpathSync(linkPath)).toBe(realpathSync(join(wt, 'standard')));
  });

  it('throws if main is missing node_modules (infrastructure not primed)', () => {
    rmSync(join(main, 'reference-impl', 'node_modules'), { recursive: true, force: true });
    expect(() => prepWorktree(main, wt)).toThrowError(/node_modules/);
  });

  it('throws if worktree is missing required package.json files', () => {
    rmSync(join(wt, 'standard', 'package.json'));
    expect(() => prepWorktree(main, wt)).toThrowError(/standard\/package\.json/);
  });

  it('is idempotent — running twice on the same worktree succeeds without EEXIST (v0.5.5 #E)', () => {
    // CLV-20's Reviewer hit `Error: EEXIST, File exists
    //   '/tmp/cl-review-CLV-20/reference-impl/node_modules/vite/node_modules/.bin'`
    // when prep-worktree was invoked a second time on an already-partially-populated worktree.
    // Root cause: Node's cpSync with verbatimSymlinks: true does not always overwrite an
    // existing symlink at the destination, even with force: true (default). Fix: wipe the
    // destination tree before recopying. This test guards the fix.
    prepWorktree(main, wt);
    expect(() => prepWorktree(main, wt)).not.toThrow();
    // All artifacts still in place after the second run.
    expect(existsSync(join(wt, 'standard', 'node_modules', 'some-dep', 'package.json'))).toBe(true);
    expect(existsSync(join(wt, 'standard', 'dist', 'marker.txt'))).toBe(true);
    expect(existsSync(join(wt, 'reference-impl', 'node_modules', 'vitest', 'package.json'))).toBe(true);
    expect(readlinkSync(join(wt, 'reference-impl', 'node_modules', '@cloverleaf', 'standard'))).toBe('../../../standard');
  });

  it('survives a nested .bin symlink pattern in main (v0.5.5 #E)', () => {
    // Mirrors what npm creates: vite/node_modules/.bin → ../../.bin (or similar). The
    // CLV-20 regression was triggered specifically by this pattern; the synthetic fixture
    // above didn't exercise it. Adding it here so the regression wouldn't slip through again.
    mkdirSync(join(main, 'reference-impl', 'node_modules', 'vite', 'node_modules'), { recursive: true });
    symlinkSync('../../.bin', join(main, 'reference-impl', 'node_modules', 'vite', 'node_modules', '.bin'));
    mkdirSync(join(main, 'reference-impl', 'node_modules', '.bin'), { recursive: true });
    writeFileSync(join(main, 'reference-impl', 'node_modules', '.bin', 'vite'), '#!/usr/bin/env node\n');

    prepWorktree(main, wt);
    // Second call on the same tree is the repro from CLV-20's Reviewer.
    expect(() => prepWorktree(main, wt)).not.toThrow();
    expect(readlinkSync(join(wt, 'reference-impl', 'node_modules', 'vite', 'node_modules', '.bin'))).toBe('../../.bin');
  });
});
