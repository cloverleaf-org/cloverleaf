import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
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

/**
 * `files` decides what lands in the tarball; `exports` decides what a consumer is
 * allowed to name. They are separate gates and only the first was covered above.
 * 0.8.1 packed the conformance corpus and the runner, and the export map — an
 * allowlist the moment it exists — then refused every subpath into either.
 *
 * Resolution runs in a child `node`, through the package's own name, so it is Node's
 * real export-map resolution rather than a re-reading of package.json here. Self
 * reference works because the package declares `exports`, which is the same field
 * under test.
 */
function resolveSubpath(subpath: string): { ok: boolean; err: string } {
  const r = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `import.meta.resolve('@cloverleaf/standard/${subpath}')`],
    { cwd: ROOT, encoding: 'utf-8' },
  );
  return { ok: r.status === 0, err: (r.stderr.match(/ERR_[A-Z_]+/) ?? [''])[0] };
}

describe('a consumer can address what the tarball ships', () => {
  it('resolves a subpath that was already exported', () => {
    // Discriminator, not a vacuity guard: it separates "self-reference does not work
    // in this environment" — which would fail every case below for an unrelated
    // reason — from "these particular subpaths are not exported".
    expect(resolveSubpath('schemas/task.schema.json')).toEqual({ ok: true, err: '' });
  });

  for (const subpath of ['examples/valid/task/minimal.json', 'conformance/runner.ts']) {
    it(`resolves ${subpath}`, () => {
      // docs/conformance.md reaches the runner by filesystem path, which works and is
      // why this went unnoticed; the package-subpath form is the idiomatic one.
      expect(resolveSubpath(subpath)).toEqual({ ok: true, err: '' });
    });
  }
});
