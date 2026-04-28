import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, symlinkSync, readlinkSync, realpathSync } from 'node:fs';
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
  // Simulate an already-built dist/ in the primary repo (the artefacts CLV-52 must copy).
  mkdirSync(join(main, 'reference-impl', 'dist', 'lib'), { recursive: true });
  writeFileSync(join(main, 'reference-impl', 'dist', 'cli.mjs'), '// cli entry\n');
  writeFileSync(join(main, 'reference-impl', 'dist', 'lib', 'qa-report.mjs'), '// qa-report entry\n');
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

  it('copies primary reference-impl/dist into worktree and contains at least one .mjs file (CLV-52)', () => {
    prepWorktree(main, wt);
    // The dist/ directory must exist in the worktree.
    expect(existsSync(join(wt, 'reference-impl', 'dist'))).toBe(true);
    // At least one .mjs file must be present (mirrors the primary's built output).
    const distFiles = readdirSync(join(wt, 'reference-impl', 'dist'));
    expect(distFiles.some((f) => f.endsWith('.mjs'))).toBe(true);
    // The specific dist entry a Reviewer/QA agent would import must be present.
    expect(existsSync(join(wt, 'reference-impl', 'dist', 'lib', 'qa-report.mjs'))).toBe(true);
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
    // dist/ must also survive a second run (CLV-52 idempotence).
    expect(existsSync(join(wt, 'reference-impl', 'dist', 'cli.mjs'))).toBe(true);
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

  it('walker-mode: succeeds when mainRoot is a walker worktree (no node_modules) by walking up to the primary root (CLV-37)', () => {
    // Simulates the walker bug: the orchestrator passes a walker worktree path as mainRoot.
    // That walker worktree has source files but no node_modules. The actual primary repo with
    // node_modules lives in a parent directory. prepWorktree must walk up and find it.

    // Build a fake filesystem hierarchy:
    //   primaryRoot/
    //     standard/node_modules/some-dep/   ← installed deps
    //     reference-impl/node_modules/...   ← installed deps
    //   primaryRoot/walkers/walker-wt/       ← the "main" path passed by the orchestrator
    //     standard/package.json             (source files, no node_modules)
    //     reference-impl/package.json

    const primaryRoot = mkdtempSync(join(tmpdir(), 'cl-prep-primary-'));
    try {
      // Set up the primary repo with node_modules.
      mkdirSync(join(primaryRoot, 'standard', 'node_modules', 'some-dep'), { recursive: true });
      writeFileSync(join(primaryRoot, 'standard', 'node_modules', 'some-dep', 'package.json'), '{"name":"some-dep"}');
      mkdirSync(join(primaryRoot, 'standard'), { recursive: true });
      writeFileSync(
        join(primaryRoot, 'standard', 'package.json'),
        JSON.stringify({
          name: '@cloverleaf/standard',
          version: '0.0.0-test',
          scripts: { build: 'mkdir -p dist && echo built-from-worktree > dist/marker.txt' },
        }) + '\n',
      );
      mkdirSync(join(primaryRoot, 'reference-impl', 'node_modules', '@cloverleaf'), { recursive: true });
      symlinkSync('../../../standard', join(primaryRoot, 'reference-impl', 'node_modules', '@cloverleaf', 'standard'));
      mkdirSync(join(primaryRoot, 'reference-impl', 'node_modules', 'vitest'), { recursive: true });
      writeFileSync(join(primaryRoot, 'reference-impl', 'node_modules', 'vitest', 'package.json'), '{"name":"vitest"}');
      // Simulate the already-built dist/ that prepWorktree must copy (CLV-52).
      mkdirSync(join(primaryRoot, 'reference-impl', 'dist'), { recursive: true });
      writeFileSync(join(primaryRoot, 'reference-impl', 'dist', 'index.mjs'), '// index\n');
      mkdirSync(join(primaryRoot, 'reference-impl'), { recursive: true });
      writeFileSync(
        join(primaryRoot, 'reference-impl', 'package.json'),
        JSON.stringify({ name: '@cloverleaf/reference-impl', version: '0.0.0-test' }) + '\n',
      );

      // Set up the walker worktree (a child path of primaryRoot, with source but no node_modules).
      const walkerWt = join(primaryRoot, 'walkers', 'walker-wt');
      mkdirSync(join(walkerWt, 'standard'), { recursive: true });
      writeFileSync(
        join(walkerWt, 'standard', 'package.json'),
        JSON.stringify({
          name: '@cloverleaf/standard',
          version: '0.0.0-test',
          scripts: { build: 'mkdir -p dist && echo built-from-worktree > dist/marker.txt' },
        }) + '\n',
      );
      mkdirSync(join(walkerWt, 'reference-impl'), { recursive: true });
      writeFileSync(
        join(walkerWt, 'reference-impl', 'package.json'),
        JSON.stringify({ name: '@cloverleaf/reference-impl', version: '0.0.0-test' }) + '\n',
      );

      // The target worktree to be prepped.
      const targetWt = mkdtempSync(join(tmpdir(), 'cl-prep-target-'));
      try {
        mkdirSync(join(targetWt, 'standard'), { recursive: true });
        writeFileSync(
          join(targetWt, 'standard', 'package.json'),
          JSON.stringify({
            name: '@cloverleaf/standard',
            version: '0.0.0-test',
            scripts: { build: 'mkdir -p dist && echo built-from-worktree > dist/marker.txt' },
          }) + '\n',
        );
        mkdirSync(join(targetWt, 'reference-impl'), { recursive: true });
        writeFileSync(
          join(targetWt, 'reference-impl', 'package.json'),
          JSON.stringify({ name: '@cloverleaf/reference-impl', version: '0.0.0-test' }) + '\n',
        );

        // Pass walkerWt (no node_modules) as mainRoot — must walk up to primaryRoot.
        expect(() => prepWorktree(walkerWt, targetWt)).not.toThrow();
        expect(existsSync(join(targetWt, 'standard', 'node_modules', 'some-dep', 'package.json'))).toBe(true);
        expect(existsSync(join(targetWt, 'standard', 'dist', 'marker.txt'))).toBe(true);
        expect(existsSync(join(targetWt, 'reference-impl', 'node_modules', 'vitest', 'package.json'))).toBe(true);
      } finally {
        rmSync(targetWt, { recursive: true, force: true });
      }
    } finally {
      rmSync(primaryRoot, { recursive: true, force: true });
    }
  });

  it('walker-mode: does not emit "main missing standard/node_modules" when node_modules exist in a parent directory (CLV-37)', () => {
    // Reproduces the exact error message guard from AC #3.
    // walkerPath has no node_modules; its grandparent has them.
    const grandparent = mkdtempSync(join(tmpdir(), 'cl-prep-gp-'));
    try {
      mkdirSync(join(grandparent, 'standard', 'node_modules', 'x'), { recursive: true });
      writeFileSync(join(grandparent, 'standard', 'node_modules', 'x', 'package.json'), '{"name":"x"}');
      writeFileSync(
        join(grandparent, 'standard', 'package.json'),
        JSON.stringify({
          name: '@cloverleaf/standard',
          scripts: { build: 'mkdir -p dist && echo ok > dist/marker.txt' },
        }) + '\n',
      );
      mkdirSync(join(grandparent, 'reference-impl', 'node_modules', 'vitest'), { recursive: true });
      writeFileSync(join(grandparent, 'reference-impl', 'node_modules', 'vitest', 'package.json'), '{"name":"vitest"}');
      writeFileSync(join(grandparent, 'reference-impl', 'package.json'), '{"name":"@cloverleaf/reference-impl"}');
      // Simulate an already-built dist/ (required by CLV-52 dist copy step).
      mkdirSync(join(grandparent, 'reference-impl', 'dist'), { recursive: true });
      writeFileSync(join(grandparent, 'reference-impl', 'dist', 'index.mjs'), '// index\n');

      const walkerPath = join(grandparent, 'child', 'grandchild');
      mkdirSync(join(walkerPath, 'standard'), { recursive: true });
      writeFileSync(
        join(walkerPath, 'standard', 'package.json'),
        JSON.stringify({
          name: '@cloverleaf/standard',
          scripts: { build: 'mkdir -p dist && echo ok > dist/marker.txt' },
        }) + '\n',
      );
      mkdirSync(join(walkerPath, 'reference-impl'), { recursive: true });
      writeFileSync(join(walkerPath, 'reference-impl', 'package.json'), '{"name":"@cloverleaf/reference-impl"}');

      const targetWt = mkdtempSync(join(tmpdir(), 'cl-prep-tw-'));
      try {
        mkdirSync(join(targetWt, 'standard'), { recursive: true });
        writeFileSync(
          join(targetWt, 'standard', 'package.json'),
          JSON.stringify({
            name: '@cloverleaf/standard',
            scripts: { build: 'mkdir -p dist && echo ok > dist/marker.txt' },
          }) + '\n',
        );
        mkdirSync(join(targetWt, 'reference-impl'), { recursive: true });
        writeFileSync(join(targetWt, 'reference-impl', 'package.json'), '{"name":"@cloverleaf/reference-impl"}');

        // Must NOT throw "main missing standard/node_modules".
        let thrown: Error | undefined;
        try {
          prepWorktree(walkerPath, targetWt);
        } catch (e) {
          thrown = e as Error;
        }
        expect(thrown?.message ?? '').not.toMatch(/main missing standard\/node_modules/);
      } finally {
        rmSync(targetWt, { recursive: true, force: true });
      }
    } finally {
      rmSync(grandparent, { recursive: true, force: true });
    }
  });

  it('findPrimaryRoot diagnostic: reports missing reference-impl/node_modules when standard/node_modules exists but reference-impl/node_modules does not (CLV-37)', () => {
    // standard/node_modules is present but reference-impl/node_modules is absent.
    // The error should name reference-impl/node_modules specifically.
    const root = mkdtempSync(join(tmpdir(), 'cl-prep-diag-std-'));
    try {
      mkdirSync(join(root, 'standard', 'node_modules'), { recursive: true });
      writeFileSync(join(root, 'standard', 'node_modules', 'marker'), 'x');
      // reference-impl/ dir exists but has no node_modules/
      mkdirSync(join(root, 'reference-impl'), { recursive: true });
      writeFileSync(join(root, 'reference-impl', 'package.json'), '{"name":"@cloverleaf/reference-impl"}');

      const wtDir = mkdtempSync(join(tmpdir(), 'cl-prep-diag-wt-'));
      try {
        mkdirSync(join(wtDir, 'standard'), { recursive: true });
        writeFileSync(
          join(wtDir, 'standard', 'package.json'),
          JSON.stringify({ name: '@cloverleaf/standard', scripts: { build: 'mkdir -p dist' } }) + '\n',
        );
        mkdirSync(join(wtDir, 'reference-impl'), { recursive: true });
        writeFileSync(join(wtDir, 'reference-impl', 'package.json'), '{"name":"@cloverleaf/reference-impl"}');

        expect(() => prepWorktree(root, wtDir)).toThrowError(/main missing reference-impl\/node_modules/);
        expect(() => prepWorktree(root, wtDir)).not.toThrowError(/main missing standard\/node_modules/);
      } finally {
        rmSync(wtDir, { recursive: true, force: true });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('findPrimaryRoot diagnostic: reports missing standard/node_modules when reference-impl/node_modules exists but standard/node_modules does not (CLV-37)', () => {
    // reference-impl/node_modules is present but standard/node_modules is absent.
    // The error should name standard/node_modules specifically.
    const root = mkdtempSync(join(tmpdir(), 'cl-prep-diag-ri-'));
    try {
      mkdirSync(join(root, 'reference-impl', 'node_modules'), { recursive: true });
      writeFileSync(join(root, 'reference-impl', 'node_modules', 'marker'), 'x');
      writeFileSync(join(root, 'reference-impl', 'package.json'), '{"name":"@cloverleaf/reference-impl"}');
      // standard/ dir exists but has no node_modules/
      mkdirSync(join(root, 'standard'), { recursive: true });

      const wtDir = mkdtempSync(join(tmpdir(), 'cl-prep-diag-wt-'));
      try {
        mkdirSync(join(wtDir, 'standard'), { recursive: true });
        writeFileSync(
          join(wtDir, 'standard', 'package.json'),
          JSON.stringify({ name: '@cloverleaf/standard', scripts: { build: 'mkdir -p dist' } }) + '\n',
        );
        mkdirSync(join(wtDir, 'reference-impl'), { recursive: true });
        writeFileSync(join(wtDir, 'reference-impl', 'package.json'), '{"name":"@cloverleaf/reference-impl"}');

        expect(() => prepWorktree(root, wtDir)).toThrowError(/main missing standard\/node_modules/);
        expect(() => prepWorktree(root, wtDir)).not.toThrowError(/main missing reference-impl\/node_modules/);
      } finally {
        rmSync(wtDir, { recursive: true, force: true });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('findPrimaryRoot diagnostic: reports standard/node_modules error against mainRoot when neither directory is found anywhere (CLV-37)', () => {
    // Neither standard/node_modules nor reference-impl/node_modules exist anywhere.
    // Error should reference standard/node_modules at the original mainRoot argument.
    const emptyRoot = mkdtempSync(join(tmpdir(), 'cl-prep-diag-empty-'));
    try {
      // No node_modules anywhere under emptyRoot
      mkdirSync(join(emptyRoot, 'standard'), { recursive: true });
      mkdirSync(join(emptyRoot, 'reference-impl'), { recursive: true });
      writeFileSync(join(emptyRoot, 'reference-impl', 'package.json'), '{"name":"@cloverleaf/reference-impl"}');

      const wtDir = mkdtempSync(join(tmpdir(), 'cl-prep-diag-wt-'));
      try {
        mkdirSync(join(wtDir, 'standard'), { recursive: true });
        writeFileSync(
          join(wtDir, 'standard', 'package.json'),
          JSON.stringify({ name: '@cloverleaf/standard', scripts: { build: 'mkdir -p dist' } }) + '\n',
        );
        mkdirSync(join(wtDir, 'reference-impl'), { recursive: true });
        writeFileSync(join(wtDir, 'reference-impl', 'package.json'), '{"name":"@cloverleaf/reference-impl"}');

        // Should throw the standard/node_modules fallback error naming the original emptyRoot.
        expect(() => prepWorktree(emptyRoot, wtDir)).toThrowError(/main missing standard\/node_modules/);
        expect(() => prepWorktree(emptyRoot, wtDir)).toThrowError(new RegExp(emptyRoot.replace(/[/\\]/g, '[/\\\\]')));
      } finally {
        rmSync(wtDir, { recursive: true, force: true });
      }
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });
});
