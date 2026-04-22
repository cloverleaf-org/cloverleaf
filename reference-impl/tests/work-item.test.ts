import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { advanceWorkItemStatus } from '../lib/work-item.js';
import type { StatusTransitions } from '@cloverleaf/standard/validators/index.js';

function makeFakeStateMachine(): StatusTransitions {
  return {
    type: 'rfc',
    states: {
      initial: ['drafting'],
      terminal: ['approved'],
      all: ['drafting', 'gate-pending', 'approved'],
    },
    transitions: [
      { from: 'drafting', to: 'gate-pending', allowed_actors: ['agent'] },
      { from: 'gate-pending', to: 'approved', allowed_actors: ['human'] },
    ],
  } as unknown as StatusTransitions;
}

describe('advanceWorkItemStatus', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cl-workitem-'));
    mkdirSync(join(tmp, '.cloverleaf', 'events'), { recursive: true });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('emits the status_transition event before saving', () => {
    const sm = makeFakeStateMachine();
    const saves: unknown[] = [];
    const saveFn = (next: { status: string }) => { saves.push(next); };

    const result = advanceWorkItemStatus({
      repoRoot: tmp,
      workItemType: 'rfc',
      project: 'CLV',
      id: 'CLV-009',
      from: 'drafting',
      to: 'gate-pending',
      actor: 'agent',
      stateMachine: sm,
      validateFixture: { type: 'rfc', id: 'CLV-009', project: 'CLV', status: 'drafting' },
      save: saveFn,
    });

    expect(result.to).toBe('gate-pending');
    const events = readdirSync(join(tmp, '.cloverleaf', 'events'));
    expect(events).toHaveLength(1);
    expect(saves).toHaveLength(1);
  });

  it('throws if the transition is not in the state machine', () => {
    const sm = makeFakeStateMachine();
    const saveFn = () => { /* unused */ };
    expect(() =>
      advanceWorkItemStatus({
        repoRoot: tmp,
        workItemType: 'rfc',
        project: 'CLV',
        id: 'CLV-009',
        from: 'drafting',
        to: 'approved',
        actor: 'agent',
        stateMachine: sm,
        validateFixture: { type: 'rfc', id: 'CLV-009', project: 'CLV', status: 'drafting' },
        save: saveFn,
      })
    ).toThrow(/Illegal transition/);
  });

  it('reports orphan event if save fails after emit', () => {
    const sm = makeFakeStateMachine();
    const saveFn = () => { throw new Error('disk full'); };
    expect(() =>
      advanceWorkItemStatus({
        repoRoot: tmp,
        workItemType: 'rfc',
        project: 'CLV',
        id: 'CLV-009',
        from: 'drafting',
        to: 'gate-pending',
        actor: 'agent',
        stateMachine: sm,
        validateFixture: { type: 'rfc', id: 'CLV-009', project: 'CLV', status: 'drafting' },
        save: saveFn,
      })
    ).toThrow(/orphan event written to .* but .* save failed: disk full/);
  });
});
