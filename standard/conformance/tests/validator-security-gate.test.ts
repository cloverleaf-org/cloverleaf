import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSecurityGate } from '../../validators/security-gate.js';
import type { StatusTransitionEvent, StatusTransitions, Task } from '../../validators/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const taskMachine = JSON.parse(
  readFileSync(resolve(__dirname, '..', '..', 'state-machines', 'task.json'), 'utf-8')
) as StatusTransitions;

// ────────────────────────────────────────────────────────────────────────────
// Helpers

function evt(
  from: string,
  to: string,
  actor: 'human' | 'agent' | 'system' = 'agent'
): StatusTransitionEvent {
  return {
    event_id: 'e-sg-1',
    event_type: 'status_transition',
    occurred_at: '2026-05-26T10:00:00Z',
    work_item_id: { project: 'CLV', id: 'CLV-999' },
    work_item_type: 'task',
    from_status: from,
    to_status: to,
    actor: { kind: actor, id: 'orchestrator' }
  };
}

function makeTask(
  securityClass: 'low' | 'high' | undefined,
  verdict: 'pass' | 'bounce' | 'escalate' | null | undefined
): Task {
  const t: Task = {
    id: 'CLV-999',
    type: 'task',
    status: 'automated-gates',
    project: 'CLV',
    context: { rfc: { project: 'CLV', id: 'CLV-1' } },
    definition_of_done: ['x'],
    acceptance_criteria: ['y'],
    risk_class: 'low'
  };
  if (securityClass !== undefined) t.security_class = securityClass;
  if (verdict !== undefined) t.security_review_verdict = verdict;
  return t;
}

// ────────────────────────────────────────────────────────────────────────────
// Flagged transitions (the three edges with security_gate: true)

const FLAGGED_TRANSITIONS: Array<{ from: string; to: string; actor: 'human' | 'agent' }> = [
  { from: 'automated-gates', to: 'ui-review', actor: 'agent' },
  { from: 'automated-gates', to: 'qa', actor: 'agent' },
  { from: 'automated-gates', to: 'merged', actor: 'human' }
];

describe('validator: security-gate — flagged transitions', () => {
  for (const { from, to, actor } of FLAGGED_TRANSITIONS) {
    const transition = `${from} → ${to}`;

    describe(`${transition}`, () => {
      // 2×4 matrix: security_class × verdict

      // low × * → always legal (rule does not apply to low-security tasks)
      it(`[low × null] ${transition} is legal`, () => {
        const result = validateSecurityGate(evt(from, to, actor), taskMachine, makeTask('low', null));
        expect(result.ok).toBe(true);
      });

      it(`[low × pass] ${transition} is legal`, () => {
        const result = validateSecurityGate(evt(from, to, actor), taskMachine, makeTask('low', 'pass'));
        expect(result.ok).toBe(true);
      });

      it(`[low × bounce] ${transition} is legal`, () => {
        const result = validateSecurityGate(evt(from, to, actor), taskMachine, makeTask('low', 'bounce'));
        expect(result.ok).toBe(true);
      });

      it(`[low × escalate] ${transition} is legal`, () => {
        const result = validateSecurityGate(evt(from, to, actor), taskMachine, makeTask('low', 'escalate'));
        expect(result.ok).toBe(true);
      });

      // high × null → illegal
      it(`[high × null] ${transition} is illegal`, () => {
        const result = validateSecurityGate(evt(from, to, actor), taskMachine, makeTask('high', null));
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.violations).toHaveLength(1);
          expect(result.violations[0].rule).toBe('security-gate');
          expect(result.violations[0].severity).toBe('error');
          expect(result.violations[0].message).toMatch(/security_review_verdict.*pass/);
          expect(result.violations[0].message).toMatch(/security_class.*high/);
          expect(result.violations[0].message).toMatch(/Advance to security-review first/);
        }
      });

      // high × pass → legal
      it(`[high × pass] ${transition} is legal`, () => {
        const result = validateSecurityGate(evt(from, to, actor), taskMachine, makeTask('high', 'pass'));
        expect(result.ok).toBe(true);
      });

      // high × bounce → illegal
      it(`[high × bounce] ${transition} is illegal`, () => {
        const result = validateSecurityGate(evt(from, to, actor), taskMachine, makeTask('high', 'bounce'));
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.violations[0].rule).toBe('security-gate');
          expect(result.violations[0].message).toMatch(/security_review_verdict.*pass/);
          expect(result.violations[0].message).toMatch(/security_class.*high/);
          expect(result.violations[0].message).toMatch(/Advance to security-review first/);
        }
      });

      // high × escalate → illegal
      it(`[high × escalate] ${transition} is illegal`, () => {
        const result = validateSecurityGate(evt(from, to, actor), taskMachine, makeTask('high', 'escalate'));
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.violations[0].rule).toBe('security-gate');
          expect(result.violations[0].message).toMatch(/security_review_verdict.*pass/);
          expect(result.violations[0].message).toMatch(/security_class.*high/);
          expect(result.violations[0].message).toMatch(/Advance to security-review first/);
        }
      });
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Control: non-flagged transitions — guard must not fire regardless of verdict

describe('validator: security-gate — non-flagged transitions (control)', () => {
  const NON_FLAGGED: Array<{ from: string; to: string; actor: 'human' | 'agent' }> = [
    { from: 'automated-gates', to: 'implementing', actor: 'agent' },
    { from: 'automated-gates', to: 'escalated', actor: 'agent' },
    { from: 'automated-gates', to: 'security-review', actor: 'agent' }
  ];

  for (const { from, to, actor } of NON_FLAGGED) {
    const transition = `${from} → ${to}`;

    it(`[high × null] ${transition} is legal (non-flagged, guard must not fire)`, () => {
      const result = validateSecurityGate(evt(from, to, actor), taskMachine, makeTask('high', null));
      expect(result.ok).toBe(true);
    });

    it(`[high × pass] ${transition} is legal (non-flagged)`, () => {
      const result = validateSecurityGate(evt(from, to, actor), taskMachine, makeTask('high', 'pass'));
      expect(result.ok).toBe(true);
    });

    it(`[high × bounce] ${transition} is legal (non-flagged)`, () => {
      const result = validateSecurityGate(evt(from, to, actor), taskMachine, makeTask('high', 'bounce'));
      expect(result.ok).toBe(true);
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Edge cases

describe('validator: security-gate — edge cases', () => {
  it('non-task work item is always legal (no security_class)', () => {
    const nonTaskItem = {
      id: 'CLV-1',
      type: 'rfc' as const,
      status: 'drafting',
      project: 'CLV'
    };
    // Cast as Task to satisfy the overload — the validator checks type at runtime
    const result = validateSecurityGate(
      evt('automated-gates', 'merged', 'human'),
      taskMachine,
      nonTaskItem as unknown as Task
    );
    expect(result.ok).toBe(true);
  });

  it('missing workItem argument is legal (early exit)', () => {
    const result = validateSecurityGate(
      evt('automated-gates', 'merged', 'human'),
      taskMachine,
      undefined
    );
    expect(result.ok).toBe(true);
  });

  it('transition not found in state machine is legal (no flagging)', () => {
    const result = validateSecurityGate(
      evt('merged', 'pending'),  // no such transition
      taskMachine,
      makeTask('high', null)
    );
    expect(result.ok).toBe(true);
  });

  it('task with no security_class set is legal on flagged transition (undefined treated as non-high)', () => {
    const result = validateSecurityGate(
      evt('automated-gates', 'qa', 'agent'),
      taskMachine,
      makeTask(undefined, undefined)
    );
    expect(result.ok).toBe(true);
  });

  it('violation workItemId matches the event work_item_id', () => {
    const result = validateSecurityGate(
      evt('automated-gates', 'qa', 'agent'),
      taskMachine,
      makeTask('high', null)
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations[0].workItemId).toEqual({ project: 'CLV', id: 'CLV-999' });
    }
  });
});
