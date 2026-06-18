import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeCouncilResult, readCouncilResult, councilResultPath, type CouncilResult } from '../lib/council-result.js';

const sample: CouncilResult = {
  gate: 'task.review',
  final_verdict: 'pass',
  rule: 'any-veto',
  rationale: 'pass — any-veto: 1/1 passed',
  members: [{ member: 'reviewer', verdict: 'pass', blocking: true, weight: 1 }],
  walk: ['review', 'automated-gates'],
  security: { member_verdict: 'absent', gating_verdict_set: 'pass', basis: 'no security member configured; advanced under council authority' },
};

describe('council-result', () => {
  it('writes to .cloverleaf/runs/<taskId>/council/<gate>.json and round-trips', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'clv-cr-'));
    const path = writeCouncilResult(repoRoot, 'DEMO-001', sample);
    expect(path).toBe(councilResultPath(repoRoot, 'DEMO-001', 'task.review'));
    expect(path.endsWith(join('.cloverleaf', 'runs', 'DEMO-001', 'council', 'task.review.json'))).toBe(true);
    expect(readCouncilResult(repoRoot, 'DEMO-001', 'task.review')).toEqual(sample);
  });
  it('readCouncilResult returns null when absent', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'clv-cr-'));
    expect(readCouncilResult(repoRoot, 'DEMO-001', 'task.review')).toBeNull();
  });
});
