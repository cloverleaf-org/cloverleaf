import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '..', 'scripts', 'check-standard-prepped.mjs');

/**
 * Run the script from `cwd`, returning { exitCode, stdout, stderr }.
 */
function run(cwd: string): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd,
    encoding: 'utf-8',
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('check-standard-prepped.mjs', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'clv-check-prep-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // Failure cases
  // ---------------------------------------------------------------------------

  it('exits 1 and prints actionable error when standard/dist/ is absent', () => {
    // Set up: standard/package.json + standard/node_modules/ but NO standard/dist/
    mkdirSync(join(tmp, 'standard', 'node_modules'), { recursive: true });
    writeFileSync(join(tmp, 'standard', 'package.json'), JSON.stringify({ name: '@cloverleaf/standard' }));

    const { exitCode, stderr } = run(tmp);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('ERROR: standard/ is not prepped in this environment.');
    // Must mention at least one remediation command.
    expect(stderr).toMatch(/prep-worktree|npm ci/);
  });

  it('exits 1 and prints actionable error when standard/node_modules/ is absent', () => {
    // Set up: standard/package.json + standard/dist/ but NO standard/node_modules/
    mkdirSync(join(tmp, 'standard', 'dist'), { recursive: true });
    writeFileSync(join(tmp, 'standard', 'package.json'), JSON.stringify({ name: '@cloverleaf/standard' }));

    const { exitCode, stderr } = run(tmp);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('ERROR: standard/ is not prepped in this environment.');
    expect(stderr).toMatch(/prep-worktree|npm ci/);
  });

  it('exits 1 when both standard/dist/ and standard/node_modules/ are absent', () => {
    mkdirSync(join(tmp, 'standard'), { recursive: true });
    writeFileSync(join(tmp, 'standard', 'package.json'), JSON.stringify({ name: '@cloverleaf/standard' }));

    const { exitCode, stderr } = run(tmp);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('ERROR: standard/ is not prepped in this environment.');
    expect(stderr).toContain('cloverleaf-cli prep-worktree <primaryRoot> <worktreeRoot>');
    expect(stderr).toContain('(cd ../standard && npm ci && npm run build)');
  });

  it('exits 1 when standard/package.json is not found anywhere up the tree', () => {
    // tmp has no standard/ at all — simulate a completely unrelated directory.
    const orphan = mkdtempSync(join(tmpdir(), 'clv-orphan-'));
    try {
      const { exitCode, stderr } = run(orphan);
      expect(exitCode).toBe(1);
      expect(stderr).toContain('ERROR: standard/ is not prepped in this environment.');
    } finally {
      rmSync(orphan, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------------------
  // Success case
  // ---------------------------------------------------------------------------

  it('exits 0 with no output when both standard/dist/ and standard/node_modules/ are present', () => {
    mkdirSync(join(tmp, 'standard', 'dist'), { recursive: true });
    mkdirSync(join(tmp, 'standard', 'node_modules'), { recursive: true });
    writeFileSync(join(tmp, 'standard', 'package.json'), JSON.stringify({ name: '@cloverleaf/standard' }));

    const { exitCode, stdout, stderr } = run(tmp);

    expect(exitCode).toBe(0);
    expect(stdout).toBe('');
    expect(stderr).toBe('');
  });

  // ---------------------------------------------------------------------------
  // Root discovery: invoked from a subdirectory
  // ---------------------------------------------------------------------------

  it('resolves the repo root correctly when invoked from a subdirectory (e.g., reference-impl/scripts/)', () => {
    // Build: tmp/standard/{package.json,dist/,node_modules/}
    //        tmp/reference-impl/scripts/   ← cwd
    mkdirSync(join(tmp, 'standard', 'dist'), { recursive: true });
    mkdirSync(join(tmp, 'standard', 'node_modules'), { recursive: true });
    writeFileSync(join(tmp, 'standard', 'package.json'), JSON.stringify({ name: '@cloverleaf/standard' }));

    const subdir = join(tmp, 'reference-impl', 'scripts');
    mkdirSync(subdir, { recursive: true });

    const { exitCode, stdout, stderr } = run(subdir);

    expect(exitCode).toBe(0);
    expect(stdout).toBe('');
    expect(stderr).toBe('');
  });

  it('resolves the repo root correctly when invoked from reference-impl/tests/', () => {
    mkdirSync(join(tmp, 'standard', 'dist'), { recursive: true });
    mkdirSync(join(tmp, 'standard', 'node_modules'), { recursive: true });
    writeFileSync(join(tmp, 'standard', 'package.json'), JSON.stringify({ name: '@cloverleaf/standard' }));

    const subdir = join(tmp, 'reference-impl', 'tests');
    mkdirSync(subdir, { recursive: true });

    const { exitCode } = run(subdir);
    expect(exitCode).toBe(0);
  });

  it('fails with correct error when invoked from a subdirectory that has no prepped standard/', () => {
    // standard/package.json exists but dist/ and node_modules/ are missing.
    mkdirSync(join(tmp, 'standard'), { recursive: true });
    writeFileSync(join(tmp, 'standard', 'package.json'), JSON.stringify({ name: '@cloverleaf/standard' }));

    const subdir = join(tmp, 'reference-impl', 'scripts');
    mkdirSync(subdir, { recursive: true });

    const { exitCode, stderr } = run(subdir);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('ERROR: standard/ is not prepped in this environment.');
  });
});
