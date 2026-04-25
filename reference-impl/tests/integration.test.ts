import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, cpSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  loadTask,
  advanceStatus,
  writeFeedback,
  emitGateDecision,
  latestFeedback,
} from '../lib/index.js';

const TOY_REPO = resolve(__dirname, '..', 'examples', 'toy-repo');

function setupFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cloverleaf-int-'));
  cpSync(join(TOY_REPO, '.cloverleaf'), join(dir, '.cloverleaf'), { recursive: true });
  // Ensure runtime dirs exist (not present in fixture, created on first write).
  mkdirSync(join(dir, '.cloverleaf', 'events'), { recursive: true });
  mkdirSync(join(dir, '.cloverleaf', 'feedback'), { recursive: true });
  return dir;
}

describe('integration: tight-loop pass case', () => {
  let repoRoot: string;
  beforeEach(() => { repoRoot = setupFixture(); });
  afterEach(() => { rmSync(repoRoot, { recursive: true, force: true }); });

  it('walks pending → automated-gates with 5 events and no feedback', () => {
    advanceStatus(repoRoot, 'DEMO-001', 'tactical-plan', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'implementing', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'documenting', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'review', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'automated-gates', 'agent');

    const task = loadTask(repoRoot, 'DEMO-001');
    expect(task.status).toBe('automated-gates');

    const events = readdirSync(join(repoRoot, '.cloverleaf', 'events')).sort();
    // v0.6: event filenames are `<workItemId>-<NNN>-<type>.json` (per-work-item counter)
    // so parallel Delivery worktrees don't collide on filename at merge time.
    expect(events).toEqual([
      'DEMO-001-001-status.json',
      'DEMO-001-002-status.json',
      'DEMO-001-003-status.json',
      'DEMO-001-004-status.json',
      'DEMO-001-005-status.json',
    ]);

    const firstEvent = JSON.parse(readFileSync(join(repoRoot, '.cloverleaf', 'events', 'DEMO-001-001-status.json'), 'utf-8'));
    expect(firstEvent.from_status).toBe('pending');
    expect(firstEvent.to_status).toBe('tactical-plan');
  });

  it('completes the merge gate on human approval', () => {
    advanceStatus(repoRoot, 'DEMO-001', 'tactical-plan', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'implementing', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'documenting', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'review', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'automated-gates', 'agent');
    emitGateDecision(repoRoot, {
      project: 'DEMO',
      workItemType: 'task',
      workItemId: 'DEMO-001',
      gate: 'human_merge',
      decision: 'approve',
      actor: 'human',
    });
    advanceStatus(repoRoot, 'DEMO-001', 'merged', 'human', { gate: 'human_merge', path: 'fast_lane' });
    expect(loadTask(repoRoot, 'DEMO-001').status).toBe('merged');
  });
});

describe('integration: bounce then pass', () => {
  let repoRoot: string;
  beforeEach(() => { repoRoot = setupFixture(); });
  afterEach(() => { rmSync(repoRoot, { recursive: true, force: true }); });

  it('writes an r1 feedback and loops back to implementing', () => {
    advanceStatus(repoRoot, 'DEMO-001', 'tactical-plan', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'implementing', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'documenting', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'review', 'agent');
    writeFeedback(repoRoot, {
      project: 'DEMO',
      taskId: 'DEMO-001',
      envelope: {
        verdict: 'bounce',
        summary: 'missing test for zero input',
        findings: [{ severity: 'error', message: 'Add zero-input test case' }],
      },
    });
    advanceStatus(repoRoot, 'DEMO-001', 'implementing', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'documenting', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'review', 'agent');
    advanceStatus(repoRoot, 'DEMO-001', 'automated-gates', 'agent');

    expect(loadTask(repoRoot, 'DEMO-001').status).toBe('automated-gates');
    const feedback = latestFeedback(repoRoot, 'DEMO-001');
    expect(feedback?.verdict).toBe('bounce');
    const fbFiles = readdirSync(join(repoRoot, '.cloverleaf', 'feedback'));
    expect(fbFiles).toEqual(['DEMO-001-r1.json']);
  });
});

describe('integration: max bounces → escalated', () => {
  let repoRoot: string;
  beforeEach(() => { repoRoot = setupFixture(); });
  afterEach(() => { rmSync(repoRoot, { recursive: true, force: true }); });

  it('escalates after 3 bounces', () => {
    for (let i = 1; i <= 3; i++) {
      if (i === 1) {
        advanceStatus(repoRoot, 'DEMO-001', 'tactical-plan', 'agent');
        advanceStatus(repoRoot, 'DEMO-001', 'implementing', 'agent');
      }
      advanceStatus(repoRoot, 'DEMO-001', 'documenting', 'agent');
      advanceStatus(repoRoot, 'DEMO-001', 'review', 'agent');
      writeFeedback(repoRoot, {
        project: 'DEMO',
        taskId: 'DEMO-001',
        envelope: {
          verdict: 'bounce',
          summary: `bounce ${i}`,
          findings: [{ severity: 'error', message: `still failing on iteration ${i}` }],
        },
      });
      advanceStatus(repoRoot, 'DEMO-001', 'implementing', 'agent');
    }
    advanceStatus(repoRoot, 'DEMO-001', 'escalated', 'agent');
    expect(loadTask(repoRoot, 'DEMO-001').status).toBe('escalated');
    const fbs = readdirSync(join(repoRoot, '.cloverleaf', 'feedback')).sort();
    expect(fbs).toEqual(['DEMO-001-r1.json', 'DEMO-001-r2.json', 'DEMO-001-r3.json']);
  });
});
