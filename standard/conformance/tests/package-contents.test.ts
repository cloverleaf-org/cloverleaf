import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');

/**
 * `conformance/runner.ts` resolves three fixture roots under `examples/`. The package
 * shipped the runner and every by-level suite but not the corpus they read, so the
 * published runner reported "8 checks, 0 failures" and exited 0 while eighty-two checks
 * silently did not happen — and `docs/conformance.md` names that run as the evidence for
 * a conformance claim. These assertions pin what actually gets packed, which is the only
 * place the omission is visible: in-repo the corpus is present and everything passes.
 *
 * `packedPaths()` runs in the `describe` body rather than inside a hook or an `it`, so a
 * throw there — npm missing, npm failing, a non-JSON response — happens during test
 * collection and this file reports as zero tests, not five failing ones. That is still
 * loud and correct, but a reader watching the suite's test count should know why this
 * file's tests vanish rather than fail.
 */
function packedPaths(): string[] {
  // --dry-run writes no tarball. `standard/package.json` defines no `prepack`, and
  // `prepublishOnly` runs on `npm publish` only, so this cannot re-enter the suite.
  // stderr is piped rather than ignored so a real npm failure — read-only HOME, EACCES
  // on _cacache, a proxy/registry error — surfaces in the thrown error's message instead
  // of being discarded; stdout stays a separate pipe, so the parsed JSON is unaffected.
  const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: ROOT,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(raw) as Array<{ files: Array<{ path: string }> }>;
  return parsed[0].files.map((f) => f.path);
}

describe('the published tarball carries everything the conformance runner reads', () => {
  const packed = packedPaths();

  it('packs a non-empty file list containing a known-shipping control', () => {
    // Not a vacuity guard — an empty `packed` would fail every assertion below, not pass
    // it. It is a discriminator: it separates "packing itself is broken" (this test also
    // fails) from "packing works but the corpus is missing" (only the tests below fail).
    expect(packed.length).toBeGreaterThan(50);
    expect(packed).toContain('schemas/task.schema.json');
  });

  for (const corpus of ['examples/valid', 'examples/invalid', 'examples/scenarios']) {
    it(`packs at least one fixture under ${corpus}/`, () => {
      expect(packed.filter((p) => p.startsWith(`${corpus}/`)).length).toBeGreaterThan(0);
    });
  }

  it('packs the worked example docs/validators.md points a reader at', () => {
    expect(packed).toContain('examples/valid/status-transitions/security-gate.json');
  });
});
