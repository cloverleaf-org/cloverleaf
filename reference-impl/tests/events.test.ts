import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitStatusTransition, emitGateDecision, formatReason } from '../lib/events.js';

describe('events', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'cloverleaf-events-'));
    mkdirSync(join(repoRoot, '.cloverleaf', 'events'), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('emits a status transition event with the correct filename', () => {
    const path = emitStatusTransition(repoRoot, {
      project: 'ACME',
      workItemType: 'task',
      workItemId: 'ACME-001',
      from: 'pending',
      to: 'tactical-plan',
      actor: 'agent',
    });
    // v0.6: filename is `<workItemId>-<NNN>-status.json` — scopes the counter
    // to the work item so parallel Delivery sessions don't collide on filename.
    expect(path).toMatch(/ACME-001-001-status\.json$/);
    const doc = JSON.parse(readFileSync(path, 'utf-8'));
    expect(doc.event_type).toBe('status_transition');
    expect(doc.work_item_id).toEqual({ project: 'ACME', id: 'ACME-001' });
    expect(doc.from_status).toBe('pending');
    expect(doc.to_status).toBe('tactical-plan');
    expect(doc.actor.kind).toBe('agent');
    expect(doc.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof doc.event_id).toBe('string');
  });

  it('emits sequential event IDs scoped per work item (v0.6)', () => {
    emitStatusTransition(repoRoot, {
      project: 'ACME', workItemType: 'task', workItemId: 'ACME-001',
      from: 'pending', to: 'tactical-plan', actor: 'agent',
    });
    const path2 = emitStatusTransition(repoRoot, {
      project: 'ACME', workItemType: 'task', workItemId: 'ACME-001',
      from: 'tactical-plan', to: 'implementing', actor: 'agent',
    });
    expect(path2).toMatch(/ACME-001-002-status\.json$/);
  });

  it('emits gate decision events with the -gate suffix', () => {
    const path = emitGateDecision(repoRoot, {
      project: 'ACME',
      workItemType: 'task',
      workItemId: 'ACME-001',
      gate: 'human_merge',
      decision: 'approve',
      actor: 'human',
    });
    expect(path).toMatch(/ACME-001-001-gate\.json$/);
    const doc = JSON.parse(readFileSync(path, 'utf-8'));
    expect(doc.event_type).toBe('gate_decision');
    expect(doc.gate).toBe('human_merge');
    expect(doc.decision).toBe('approve');
    expect(doc.approver.kind).toBe('human');
  });

  it('isolates counters per work item — sibling tasks do not share a counter (v0.6)', () => {
    emitStatusTransition(repoRoot, {
      project: 'ACME', workItemType: 'task', workItemId: 'ACME-001',
      from: 'pending', to: 'tactical-plan', actor: 'agent',
    });
    const path = emitStatusTransition(repoRoot, {
      project: 'ACME', workItemType: 'task', workItemId: 'ACME-002',
      from: 'pending', to: 'tactical-plan', actor: 'agent',
    });
    // ACME-002's first event is 001 — not 002 — because the counter is
    // scoped to the work item. This is what makes the v0.6 walker safe:
    // three parallel worktrees emitting events for tasks ACME-001, -002,
    // -003 produce filenames `ACME-001-001-…`, `ACME-002-001-…`,
    // `ACME-003-001-…` — no cross-task collision on merge.
    expect(path).toMatch(/ACME-002-001-status\.json$/);
  });

  it('does NOT collide when two sibling work items are emitted independently (v0.6 walker regression guard)', () => {
    // Regression for the walker-dogfood-2 bug: global per-project counter
    // produced add/add merge conflicts when parallel worktrees for ACC-2,
    // ACC-3, ACC-4 each generated events ACC-001..005 and tried to merge
    // back to main. With per-work-item scoping, each worktree's filenames
    // are unique from the others' by virtue of the workItemId prefix.
    emitStatusTransition(repoRoot, {
      project: 'ACC', workItemType: 'task', workItemId: 'ACC-2',
      from: 'pending', to: 'tactical-plan', actor: 'agent',
    });
    emitStatusTransition(repoRoot, {
      project: 'ACC', workItemType: 'task', workItemId: 'ACC-3',
      from: 'pending', to: 'tactical-plan', actor: 'agent',
    });
    const files = readdirSync(join(repoRoot, '.cloverleaf', 'events')).sort();
    expect(files).toEqual(['ACC-2-001-status.json', 'ACC-3-001-status.json']);
  });

  it('creates events directory if it does not exist', () => {
    rmSync(join(repoRoot, '.cloverleaf', 'events'), { recursive: true, force: true });
    const path = emitStatusTransition(repoRoot, {
      project: 'ACME', workItemType: 'task', workItemId: 'ACME-001',
      from: 'pending', to: 'tactical-plan', actor: 'agent',
    });
    expect(existsSync(path)).toBe(true);
  });

  it('formatReason handles all combinations', () => {
    expect(formatReason({})).toBeUndefined();
    expect(formatReason({ gate: 'human_merge' })).toBe('gate=human_merge');
    expect(formatReason({ path: 'fast_lane' })).toBe('path=fast_lane');
    expect(formatReason({ gate: 'human_merge', path: 'fast_lane' })).toBe('gate=human_merge; path=fast_lane');
  });
});
