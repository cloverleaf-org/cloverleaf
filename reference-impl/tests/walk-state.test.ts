import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWalkState, writeWalkState, walkStatePath } from '../lib/walk-state.js';
import type { WalkState } from '../lib/dag-walker.js';

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'cl-walkstate-'));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

function sampleState(): WalkState {
  return {
    plan_id: 'CLV-15',
    started: '2026-04-24T21:30:00Z',
    max_concurrent: 3,
    tasks: {
      'CLV-17': { state: 'pending' },
    },
  };
}

describe('walk-state', () => {
  it('walkStatePath returns the conventional .cloverleaf/runs/plan/<id>/walk-state.json path', () => {
    expect(walkStatePath(repoRoot, 'CLV-15')).toBe(
      join(repoRoot, '.cloverleaf', 'runs', 'plan', 'CLV-15', 'walk-state.json'),
    );
  });

  it('readWalkState returns null when file does not exist', () => {
    expect(readWalkState(repoRoot, 'CLV-15')).toBe(null);
  });

  it('writeWalkState creates parent dirs and persists JSON', () => {
    writeWalkState(repoRoot, sampleState());
    const path = walkStatePath(repoRoot, 'CLV-15');
    expect(existsSync(path)).toBe(true);
    const content = JSON.parse(readFileSync(path, 'utf-8'));
    expect(content.plan_id).toBe('CLV-15');
    expect(content.max_concurrent).toBe(3);
    expect(content.tasks['CLV-17'].state).toBe('pending');
  });

  it('readWalkState round-trips the value written by writeWalkState', () => {
    writeWalkState(repoRoot, sampleState());
    const read = readWalkState(repoRoot, 'CLV-15');
    expect(read).toEqual(sampleState());
  });

  it('writeWalkState is atomic — tmp file is removed after successful rename', () => {
    writeWalkState(repoRoot, sampleState());
    const dir = join(repoRoot, '.cloverleaf', 'runs', 'plan', 'CLV-15');
    const leftover = require('node:fs').readdirSync(dir).filter((f: string) =>
      f.startsWith('walk-state.json.tmp-'),
    );
    expect(leftover).toEqual([]);
  });

  it('writeWalkState overwrites existing file', () => {
    writeWalkState(repoRoot, sampleState());
    const updated = { ...sampleState(), max_concurrent: 5 };
    writeWalkState(repoRoot, updated);
    const read = readWalkState(repoRoot, 'CLV-15');
    expect(read!.max_concurrent).toBe(5);
  });

  it('readWalkState throws on malformed JSON rather than returning null', () => {
    const path = walkStatePath(repoRoot, 'CLV-15');
    require('node:fs').mkdirSync(require('node:path').dirname(path), { recursive: true });
    writeFileSync(path, '{ not json');
    expect(() => readWalkState(repoRoot, 'CLV-15')).toThrow();
  });
});
