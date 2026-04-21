import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DIST = resolve(__dirname, '..', '..', 'dist');

describe('build output', () => {
  it('emits dist/validators/index.js and index.d.ts', () => {
    expect(existsSync(resolve(DIST, 'validators', 'index.js'))).toBe(true);
    expect(existsSync(resolve(DIST, 'validators', 'index.d.ts'))).toBe(true);
  });

  it('re-exports the public validator surface from index.js', () => {
    const indexJs = readFileSync(resolve(DIST, 'validators', 'index.js'), 'utf-8');
    expect(indexJs).toMatch(/validateStatusTransitionLegality/);
    expect(indexJs).toMatch(/validateCrossProjectRef/);
    expect(indexJs).toMatch(/validateDagAcyclic/);
  });

  it('emits per-module .js files for each validator', () => {
    const expected = [
      'cross-project-ref.js',
      'dag-acyclic.js',
      'gate-decision-validity.js',
      'id-pattern.js',
      'plan-tasks-match-dag.js',
      'relationship-mirror.js',
      'status-by-type.js',
      'status-transition-legality.js',
      'types.js',
    ];
    for (const f of expected) {
      expect(existsSync(resolve(DIST, 'validators', f))).toBe(true);
    }
  });
});
