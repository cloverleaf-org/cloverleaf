import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readSidecar, walkExamples } from './_helpers.js';

const STANDARD_ROOT = resolve(__dirname, '..', '..', '..');

describe('readSidecar', () => {
  it('returns parsed Sidecar for a fixture with a sidecar', () => {
    // project/basic.json is a known L1 fixture with a sidecar
    const jsonPath = resolve(STANDARD_ROOT, 'examples', 'valid', 'project', 'basic.json');
    const meta = readSidecar(jsonPath);
    expect(meta).not.toBeNull();
    expect(Array.isArray(meta!.levels)).toBe(true);
    expect(meta!.levels.length).toBeGreaterThan(0);
    expect(typeof meta!.fixture_of).toBe('string');
  });

  it('returns null for a nonexistent fixture path', () => {
    expect(readSidecar('/nonexistent/fake-fixture.json')).toBeNull();
  });
});

describe('walkExamples', () => {
  it('returns entries for all valid examples', () => {
    const entries = walkExamples(resolve(STANDARD_ROOT, 'examples', 'valid'));
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(typeof e.schemaName).toBe('string');
      expect(typeof e.jsonPath).toBe('string');
      // sidecar may be null if no .meta.json present
    }
  });

  it('entries include schemaName, jsonPath, and sidecar fields', () => {
    const entries = walkExamples(resolve(STANDARD_ROOT, 'examples', 'valid'));
    const projectEntry = entries.find((e) => e.schemaName === 'project');
    expect(projectEntry).toBeDefined();
    expect(projectEntry!.sidecar).not.toBeNull();
    expect(projectEntry!.sidecar!.levels).toContain('L1');
  });

  it('returns empty array for nonexistent root', () => {
    const entries = walkExamples('/nonexistent/path');
    expect(entries).toEqual([]);
  });

  it('invalid examples directory also returns entries', () => {
    const entries = walkExamples(resolve(STANDARD_ROOT, 'examples', 'invalid'));
    expect(entries.length).toBeGreaterThan(0);
  });
});
