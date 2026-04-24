import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  uiReviewStatePath,
  readUiReviewState,
  writeUiReviewState,
} from '../lib/ui-review-state.js';
import { uiReviewRunDir } from '../lib/paths.js';

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'clv-ui-review-state-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// uiReviewStatePath
// ---------------------------------------------------------------------------

describe('uiReviewStatePath', () => {
  it('returns the correct path for a given taskId', () => {
    const path = uiReviewStatePath('/repo', 'CLV-42');
    expect(path).toBe('/repo/.cloverleaf/runs/CLV-42/ui-review/state.json');
  });

  it('is co-located under .cloverleaf/runs/{taskId}/ui-review/', () => {
    const path = uiReviewStatePath('/repo', 'CLV-42');
    const dir = uiReviewRunDir('/repo', 'CLV-42');
    expect(path).toBe(join(dir, 'state.json'));
  });

  it('uses the taskId verbatim in the path', () => {
    const path = uiReviewStatePath('/myrepo', 'PROJ-007');
    expect(path).toContain('PROJ-007');
    expect(path).toContain('.cloverleaf/runs/PROJ-007/ui-review/state.json');
  });
});

// ---------------------------------------------------------------------------
// readUiReviewState — file absent
// ---------------------------------------------------------------------------

describe('readUiReviewState (file absent)', () => {
  it('returns baselines_pending: false when state.json does not exist', () => {
    const state = readUiReviewState(workDir, 'CLV-42');
    expect(state.baselines_pending).toBe(false);
  });

  it('does not throw when the runs directory does not exist', () => {
    expect(() => readUiReviewState(workDir, 'CLV-99')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// writeUiReviewState + readUiReviewState round-trip
// ---------------------------------------------------------------------------

describe('writeUiReviewState + readUiReviewState', () => {
  it('writes baselines_pending: true and reads it back', () => {
    writeUiReviewState(workDir, 'CLV-42', { baselines_pending: true });
    const state = readUiReviewState(workDir, 'CLV-42');
    expect(state.baselines_pending).toBe(true);
  });

  it('writes baselines_pending: false and reads it back', () => {
    writeUiReviewState(workDir, 'CLV-42', { baselines_pending: false });
    const state = readUiReviewState(workDir, 'CLV-42');
    expect(state.baselines_pending).toBe(false);
  });

  it('creates intermediate directories automatically', () => {
    const taskId = 'CLV-42';
    const stateFile = uiReviewStatePath(workDir, taskId);
    expect(existsSync(stateFile)).toBe(false);
    writeUiReviewState(workDir, taskId, { baselines_pending: true });
    expect(existsSync(stateFile)).toBe(true);
  });

  it('overwrites a prior true with false (approve-baselines scenario)', () => {
    writeUiReviewState(workDir, 'CLV-42', { baselines_pending: true });
    writeUiReviewState(workDir, 'CLV-42', { baselines_pending: false });
    const state = readUiReviewState(workDir, 'CLV-42');
    expect(state.baselines_pending).toBe(false);
  });

  it('writes valid JSON with the correct shape', () => {
    writeUiReviewState(workDir, 'CLV-42', { baselines_pending: true });
    const raw = JSON.parse(
      readFileSync(uiReviewStatePath(workDir, 'CLV-42'), 'utf-8'),
    ) as { baselines_pending: boolean };
    expect(raw).toHaveProperty('baselines_pending', true);
  });

  it('state file is at the canonical .cloverleaf/runs/{taskId}/ui-review/state.json path', () => {
    writeUiReviewState(workDir, 'CLV-42', { baselines_pending: true });
    const expected = join(workDir, '.cloverleaf', 'runs', 'CLV-42', 'ui-review', 'state.json');
    expect(existsSync(expected)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// paths helpers
// ---------------------------------------------------------------------------

describe('uiReviewRunDir', () => {
  it('returns .cloverleaf/runs/{taskId}/ui-review/', () => {
    const dir = uiReviewRunDir('/repo', 'CLV-42');
    expect(dir).toBe('/repo/.cloverleaf/runs/CLV-42/ui-review');
  });
});
