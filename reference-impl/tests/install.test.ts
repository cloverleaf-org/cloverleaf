/**
 * CLV-46: install.sh --with-cross-browser flag regression test.
 *
 * Covers both flag-present and flag-absent code paths without any external
 * network access.  `npx`, `claude`, and `uname` are replaced by shell stubs
 * that log every invocation to a file on disk so the test can assert exactly
 * which commands ran.
 *
 * Acceptance criteria covered:
 *  AC1 — install.sh --with-cross-browser on Linux runs `install-deps webkit firefox`
 *  AC2 — install.sh without the flag runs `install-deps webkit` only and prints the note
 *  AC3 — test passes without external network access and is runnable in CI
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
  existsSync,
} from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Absolute path to the install.sh being tested.
const INSTALL_SH = resolve(__dirname, '..', 'install.sh');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal fake repo directory that satisfies install.sh's pre-flight:
 *   - <fakeRoot>/.claude-plugin/marketplace.json   (existence check)
 *
 * install.sh derives REPO_ROOT as the parent of SCRIPT_DIR (i.e. the parent
 * of the directory that contains install.sh).  When we run the *real*
 * install.sh from its actual location, SCRIPT_DIR=reference-impl/ and
 * REPO_ROOT=<repo root>/.  That means it looks for
 * <repo root>/.claude-plugin/marketplace.json which already exists in the
 * real checkout.  We do NOT need to reproduce the full tree — we only need
 * the env to produce exit 0 past the early guards.
 *
 * Because REPO_ROOT is resolved relative to SCRIPT_DIR (the dir containing
 * install.sh), and install.sh lives at reference-impl/install.sh, the real
 * .claude-plugin/marketplace.json at the repo root will be found automatically
 * when the test runs inside the actual git checkout.  This is fine for CI.
 */
function readInvocationLog(logFile: string): string[] {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Write a bash stub script to `dest` that appends its full argument list
 * to `logFile` and exits 0.
 */
function writeStub(dest: string, logFile: string): void {
  writeFileSync(
    dest,
    `#!/usr/bin/env bash\necho "$0 $*" >> "${logFile}"\n`,
  );
  chmodSync(dest, 0o755);
}

/**
 * Write a `uname` stub that always prints `Linux` (regardless of the real OS),
 * so the Linux branch in install.sh is always exercised.
 */
function writeUnameStub(dest: string): void {
  writeFileSync(dest, '#!/usr/bin/env bash\necho "Linux"\n');
  chmodSync(dest, 0o755);
}

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Execute install.sh in a subprocess with a custom PATH that puts the stub
 * binaries first.  Returns stdout, stderr, and exit code.
 *
 * @param binDir  Directory containing stub executables (prepended to PATH).
 * @param args    Arguments to pass to install.sh.
 */
function runInstallSh(binDir: string, args: string[] = []): RunResult {
  const argStr = args.map((a) => JSON.stringify(a)).join(' ');
  try {
    const stdout = execSync(`bash "${INSTALL_SH}" ${argStr}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin'}`,
      },
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
      exitCode: e.status ?? 1,
    };
  }
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

let tmpDir: string;
let binDir: string;
let logFile: string;

beforeEach(() => {
  tmpDir  = mkdtempSync(join(tmpdir(), 'clv-install-test-'));
  binDir  = join(tmpDir, 'bin');
  logFile = join(tmpDir, 'invocations.log');
  mkdirSync(binDir, { recursive: true });

  // Stub: claude — does nothing, exits 0.
  writeStub(join(binDir, 'claude'), logFile);

  // Stub: npx — records all args, exits 0.
  writeStub(join(binDir, 'npx'), logFile);

  // Stub: uname — always prints "Linux" so the Linux branch is always hit.
  writeUnameStub(join(binDir, 'uname'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('install.sh --with-cross-browser flag', () => {
  // -------------------------------------------------------------------------
  // AC2: flag absent — webkit only + informational note
  // -------------------------------------------------------------------------

  it('without --with-cross-browser: invokes install-deps webkit (not firefox)', () => {
    const result = runInstallSh(binDir);

    // Script must succeed.
    expect(result.exitCode, `install.sh exited ${result.exitCode}. stderr: ${result.stderr}`).toBe(0);

    const lines = readInvocationLog(logFile);

    // Must have called `npx playwright install-deps webkit`.
    const installDepsLines = lines.filter((l) => l.includes('playwright install-deps'));
    expect(installDepsLines.length, 'expected exactly one install-deps invocation').toBe(1);
    expect(installDepsLines[0]).toContain('webkit');
    expect(installDepsLines[0]).not.toContain('firefox');
  });

  it('without --with-cross-browser: stdout contains the informational note about --with-cross-browser', () => {
    const result = runInstallSh(binDir);

    expect(result.exitCode, `install.sh exited ${result.exitCode}. stderr: ${result.stderr}`).toBe(0);

    // The note must explain how to enable cross-browser support.
    expect(result.stdout).toMatch(/--with-cross-browser/);
    expect(result.stdout.toLowerCase()).toMatch(/cross.browser|firefox/);
  });

  // -------------------------------------------------------------------------
  // AC1: flag present — webkit + firefox
  // -------------------------------------------------------------------------

  it('with --with-cross-browser: invokes install-deps webkit firefox', () => {
    const result = runInstallSh(binDir, ['--with-cross-browser']);

    expect(result.exitCode, `install.sh exited ${result.exitCode}. stderr: ${result.stderr}`).toBe(0);

    const lines = readInvocationLog(logFile);

    // Must have called `npx playwright install-deps webkit firefox`.
    const installDepsLines = lines.filter((l) => l.includes('playwright install-deps'));
    expect(installDepsLines.length, 'expected exactly one install-deps invocation').toBe(1);
    expect(installDepsLines[0]).toContain('webkit');
    expect(installDepsLines[0]).toContain('firefox');
  });

  it('with --with-cross-browser: stdout does NOT contain the webkit-only informational note', () => {
    // When the flag is present the informational note is redundant and must not
    // be printed (the user already opted in to cross-browser).
    const result = runInstallSh(binDir, ['--with-cross-browser']);

    expect(result.exitCode, `install.sh exited ${result.exitCode}. stderr: ${result.stderr}`).toBe(0);

    // The "re-run with --with-cross-browser" advisory should NOT appear when the
    // flag is already active.
    expect(result.stdout).not.toMatch(/re-run with.*--with-cross-browser/);
  });

  // -------------------------------------------------------------------------
  // Invariants: behaviour that must be the same in both modes
  // -------------------------------------------------------------------------

  it('always installs chromium, webkit, and firefox browsers (npx playwright install)', () => {
    // The `npx playwright install chromium webkit firefox` call is unconditional
    // and must appear in both flag-present and flag-absent runs.
    for (const args of [[], ['--with-cross-browser']]) {
      // Reset log between sub-runs.
      rmSync(logFile, { force: true });

      const result = runInstallSh(binDir, args);
      expect(result.exitCode, `install.sh exited ${result.exitCode} for args ${args.join(' ')}`).toBe(0);

      const lines = readInvocationLog(logFile);
      const installLines = lines.filter(
        (l) => l.includes('playwright install') && !l.includes('install-deps'),
      );
      expect(installLines.length, `expected playwright install call for args ${args.join(' ')}`).toBeGreaterThan(0);
      expect(installLines.some((l) => l.includes('chromium') && l.includes('webkit') && l.includes('firefox'))).toBe(true);
    }
  });

  it('install-deps is only invoked once per run in both modes', () => {
    for (const args of [[], ['--with-cross-browser']]) {
      rmSync(logFile, { force: true });

      const result = runInstallSh(binDir, args);
      expect(result.exitCode, `install.sh exited ${result.exitCode} for args ${args.join(' ')}`).toBe(0);

      const lines = readInvocationLog(logFile);
      const installDepsLines = lines.filter((l) => l.includes('playwright install-deps'));
      expect(installDepsLines.length, `install-deps must be called exactly once (args: ${args.join(' ')})`).toBe(1);
    }
  });
});
