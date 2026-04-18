import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitStatusTransition, emitGateDecision } from '../lib/events.js';

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
    expect(path).toMatch(/ACME-001-status\.json$/);
    const doc = JSON.parse(readFileSync(path, 'utf-8'));
    expect(doc.event_type).toBe('status_transition');
    expect(doc.work_item_id).toEqual({ project: 'ACME', id: 'ACME-001' });
    expect(doc.from_status).toBe('pending');
    expect(doc.to_status).toBe('tactical-plan');
    expect(doc.actor.kind).toBe('agent');
    expect(doc.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof doc.event_id).toBe('string');
  });

  it('emits sequential event IDs per project', () => {
    emitStatusTransition(repoRoot, {
      project: 'ACME', workItemType: 'task', workItemId: 'ACME-001',
      from: 'pending', to: 'tactical-plan', actor: 'agent',
    });
    const path2 = emitStatusTransition(repoRoot, {
      project: 'ACME', workItemType: 'task', workItemId: 'ACME-001',
      from: 'tactical-plan', to: 'implementing', actor: 'agent',
    });
    expect(path2).toMatch(/ACME-002-status\.json$/);
  });

  it('emits gate decision events with the -gate suffix', () => {
    const path = emitGateDecision(repoRoot, {
      project: 'ACME',
      workItemType: 'task',
      workItemId: 'ACME-001',
      gate: 'human_merge',
      decision: 'approved',
      actor: 'human',
    });
    expect(path).toMatch(/ACME-001-gate\.json$/);
    const doc = JSON.parse(readFileSync(path, 'utf-8'));
    expect(doc.event_type).toBe('gate_decision');
    expect(doc.gate).toBe('human_merge');
    expect(doc.decision).toBe('approved');
    expect(doc.actor.kind).toBe('human');
  });

  it('isolates per-project counters', () => {
    emitStatusTransition(repoRoot, {
      project: 'ACME', workItemType: 'task', workItemId: 'ACME-001',
      from: 'pending', to: 'tactical-plan', actor: 'agent',
    });
    const path = emitStatusTransition(repoRoot, {
      project: 'FOO', workItemType: 'task', workItemId: 'FOO-001',
      from: 'pending', to: 'tactical-plan', actor: 'agent',
    });
    expect(path).toMatch(/FOO-001-status\.json$/);
  });
});
