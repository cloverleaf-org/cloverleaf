import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveRfc, advanceRfcStatus } from '../lib/rfc.js';
import { saveSpike, advanceSpikeStatus } from '../lib/spike.js';
import { savePlan, advancePlanStatus, materialiseTasksFromPlan } from '../lib/plan.js';
import { loadTask } from '../lib/task.js';
import { emitGateDecision } from '../lib/events.js';

describe('discovery orchestrator — end-to-end substrate', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cl-disc-'));
    for (const d of ['rfcs', 'spikes', 'plans', 'tasks', 'events', 'feedback']) {
      mkdirSync(join(tmp, '.cloverleaf', d), { recursive: true });
    }
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('drives a full Discovery cycle: RFC → spike → Plan → approve → materialise', () => {
    // Step 1: Create the RFC (status=drafting), seeded by /cloverleaf-new-rfc.
    saveRfc(tmp, {
      type: 'rfc', project: 'CLV', id: 'CLV-009', status: 'drafting',
      owner: { kind: 'agent', id: 'researcher' },
      title: 'Cross-browser UI review',
      problem: 'Chromium-only today.',
      solution: 'TBD — to be populated by /cloverleaf-draft-rfc.',
      unknowns: [],
      acceptance_criteria: ['RFC body populated'],
      out_of_scope: [],
    } as never);

    // Step 2: Researcher draftRfc populates RFC body + 1 unknown.
    saveRfc(tmp, {
      type: 'rfc', project: 'CLV', id: 'CLV-009', status: 'drafting',
      owner: { kind: 'agent', id: 'researcher' },
      title: 'Cross-browser UI review',
      problem: 'Chromium-only today.',
      solution: 'Add webkit and firefox browsers to the UI reviewer, with per-browser baselines.',
      unknowns: ['What is the webkit install size and cost?'],
      acceptance_criteria: ['webkit runs on CI', 'firefox runs on CI'],
      out_of_scope: [],
    } as never);
    advanceRfcStatus(tmp, 'CLV-009', 'spike-in-flight', 'agent');

    // Step 3: Orchestrator creates a Spike for the unknown.
    saveSpike(tmp, {
      type: 'spike', project: 'CLV', id: 'CLV-010', status: 'pending',
      owner: { kind: 'agent', id: 'researcher' },
      title: 'Webkit install cost',
      parent_rfc: { project: 'CLV', id: 'CLV-009' },
      question: 'What is the webkit install size and cost?',
      method: 'research',
    } as never);

    // Step 4: Run the spike.
    advanceSpikeStatus(tmp, 'CLV-010', 'running', 'agent');
    saveSpike(tmp, {
      type: 'spike', project: 'CLV', id: 'CLV-010', status: 'running',
      owner: { kind: 'agent', id: 'researcher' },
      title: 'Webkit install cost',
      parent_rfc: { project: 'CLV', id: 'CLV-009' },
      question: 'What is the webkit install size and cost?',
      method: 'research',
      findings: 'Webkit bundle is 180MB; install takes ~45s.',
      recommendation: 'Cache at PLAYWRIGHT_BROWSERS_PATH to avoid repeat downloads.',
    } as never);
    advanceSpikeStatus(tmp, 'CLV-010', 'completed', 'agent');

    // Step 5: Post-spike — transition spike-in-flight → drafting, re-draft (unchanged for this test), transition → planning.
    advanceRfcStatus(tmp, 'CLV-009', 'drafting', 'agent');
    // Re-save the RFC (Researcher re-drafted; same body acceptable here).
    // The RFC status is now 'drafting', next transition to 'planning' is legal.
    advanceRfcStatus(tmp, 'CLV-009', 'planning', 'agent');

    // Step 6: RFC → gate-pending; human approves via rfc_strategy_gate.
    advanceRfcStatus(tmp, 'CLV-009', 'gate-pending', 'agent', { gate: 'rfc_strategy_gate' });
    emitGateDecision(tmp, {
      project: 'CLV', workItemType: 'rfc', workItemId: 'CLV-009',
      gate: 'rfc_strategy_gate', decision: 'approve', actor: 'human',
    });
    advanceRfcStatus(tmp, 'CLV-009', 'approved', 'human', { gate: 'rfc_strategy_gate' });

    // Step 7: Plan agent breakdown produces a Plan with 2 inline tasks and an edge.
    const plan = {
      type: 'plan', project: 'CLV', id: 'CLV-011', status: 'drafting',
      owner: { kind: 'agent', id: 'plan' },
      parent_rfc: { project: 'CLV', id: 'CLV-009' },
      task_dag: {
        nodes: [
          { project: 'CLV', id: 'CLV-012' },
          { project: 'CLV', id: 'CLV-013' },
        ],
        edges: [
          { from: { project: 'CLV', id: 'CLV-012' }, to: { project: 'CLV', id: 'CLV-013' } },
        ],
      },
      tasks: [
        {
          type: 'task', project: 'CLV', id: 'CLV-012', title: 'Install webkit',
          status: 'pending', risk_class: 'high',
          owner: { kind: 'agent', id: 'implementer' },
          acceptance_criteria: ['webkit installed'],
          definition_of_done: ['playwright.config uses webkit'],
          context: { rfc: { project: 'CLV', id: 'CLV-009' } },
        },
        {
          type: 'task', project: 'CLV', id: 'CLV-013', title: 'Extend ui-review config',
          status: 'pending', risk_class: 'high',
          owner: { kind: 'agent', id: 'implementer' },
          acceptance_criteria: ['config supports webkit'],
          definition_of_done: ['ui-review.json schema validated'],
          context: { rfc: { project: 'CLV', id: 'CLV-009' } },
        },
      ],
    };
    savePlan(tmp, plan as never);
    advancePlanStatus(tmp, 'CLV-011', 'gate-pending', 'agent', { gate: 'task_batch_gate' });

    // Step 8: Human approves Plan via task_batch_gate.
    emitGateDecision(tmp, {
      project: 'CLV', workItemType: 'plan', workItemId: 'CLV-011',
      gate: 'task_batch_gate', decision: 'approve', actor: 'human',
    });
    advancePlanStatus(tmp, 'CLV-011', 'approved', 'human', { gate: 'task_batch_gate' });

    // Step 9: Materialise tasks.
    const ids = materialiseTasksFromPlan(tmp, plan as never);
    expect(ids).toEqual(['CLV-012', 'CLV-013']);
    expect(loadTask(tmp, 'CLV-012').status).toBe('pending');
    expect(loadTask(tmp, 'CLV-013').status).toBe('pending');

    // Step 10: Check event log shape.
    const events = readdirSync(join(tmp, '.cloverleaf', 'events'));
    const statusEvents = events.filter(f => f.endsWith('-status.json'));
    const gateEvents = events.filter(f => f.endsWith('-gate.json'));
    // Status transitions: RFC has 5 (drafting → spike-in-flight → drafting → planning → gate-pending → approved),
    // spike has 2 (pending → running → completed), plan has 2 (drafting → gate-pending → approved) = 9 total
    expect(statusEvents.length).toBeGreaterThanOrEqual(8);
    expect(gateEvents).toHaveLength(2);
  });

  it('aborts atomically when materialisation hits an invalid task', () => {
    // Build a plan whose tasks array contains an invalid task (missing definition_of_done).
    // savePlan would reject this because it validates tasks[] via $ref — so don't call savePlan.
    // We only pass the corrupted plan to materialiseTasksFromPlan directly.
    const plan = {
      type: 'plan', project: 'CLV', id: 'CLV-011', status: 'drafting',
      owner: { kind: 'agent', id: 'plan' },
      parent_rfc: { project: 'CLV', id: 'CLV-009' },
      task_dag: {
        nodes: [{ project: 'CLV', id: 'CLV-012' }],
        edges: [],
      },
      tasks: [
        // Missing required definition_of_done — will fail AJV.
        {
          type: 'task', project: 'CLV', id: 'CLV-012', title: 'x',
          status: 'pending', risk_class: 'high',
          owner: { kind: 'agent', id: 'implementer' },
          acceptance_criteria: ['a'],
          context: { rfc: { project: 'CLV', id: 'CLV-009' } },
        },
      ],
    };
    // Don't savePlan; go straight to materialise.
    expect(() => materialiseTasksFromPlan(tmp, plan as never)).toThrow();
    // Verify no task files were written.
    expect(readdirSync(join(tmp, '.cloverleaf', 'tasks'))).toHaveLength(0);
  });

  it('rejects cycles in task_dag edges', () => {
    const plan = {
      type: 'plan', project: 'CLV', id: 'CLV-011', status: 'drafting',
      owner: { kind: 'agent', id: 'plan' },
      parent_rfc: { project: 'CLV', id: 'CLV-009' },
      task_dag: {
        nodes: [
          { project: 'CLV', id: 'CLV-012' },
          { project: 'CLV', id: 'CLV-013' },
        ],
        edges: [
          { from: { project: 'CLV', id: 'CLV-012' }, to: { project: 'CLV', id: 'CLV-013' } },
          { from: { project: 'CLV', id: 'CLV-013' }, to: { project: 'CLV', id: 'CLV-012' } },
        ],
      },
      tasks: [
        {
          type: 'task', project: 'CLV', id: 'CLV-012', title: 't1',
          status: 'pending', risk_class: 'high',
          owner: { kind: 'agent', id: 'implementer' },
          acceptance_criteria: ['a'],
          definition_of_done: ['d'],
          context: { rfc: { project: 'CLV', id: 'CLV-009' } },
        },
        {
          type: 'task', project: 'CLV', id: 'CLV-013', title: 't2',
          status: 'pending', risk_class: 'high',
          owner: { kind: 'agent', id: 'implementer' },
          acceptance_criteria: ['a'],
          definition_of_done: ['d'],
          context: { rfc: { project: 'CLV', id: 'CLV-009' } },
        },
      ],
    };
    savePlan(tmp, plan as never);
    expect(() => materialiseTasksFromPlan(tmp, plan as never)).toThrow(/cycle/i);
  });
});
