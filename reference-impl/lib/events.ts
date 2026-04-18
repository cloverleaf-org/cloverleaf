import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eventsDir } from './paths.js';
import { nextEventId } from './ids.js';

export interface StatusTransitionParams {
  project: string;
  workItemType: 'task' | 'rfc' | 'spike' | 'plan';
  workItemId: string;
  from: string;
  to: string;
  actor: 'agent' | 'human' | 'system';
  gate?: string;
  path?: 'fast_lane' | 'full_pipeline';
}

export interface GateDecisionParams {
  project: string;
  workItemType: 'task' | 'rfc' | 'spike' | 'plan';
  workItemId: string;
  gate: string;
  decision: string;
  actor: 'agent' | 'human' | 'system';
  reasoning?: string;
}

function actorObject(kind: 'agent' | 'human' | 'system'): { kind: string; id: string } {
  const id = kind === 'agent' ? 'implementer' : kind === 'human' ? 'local-user' : 'system';
  return { kind, id };
}

/**
 * Emits a status-transition event to `.cloverleaf/events/`.
 * File name: `<PROJECT>-<NNN>-status.json` where NNN is the next per-project
 * sequential number derived from existing event files.
 *
 * Returns the absolute path of the written file.
 */
export function emitStatusTransition(repoRoot: string, params: StatusTransitionParams): string {
  const { project, workItemType, workItemId, from, to, actor, gate } = params;
  const seq = nextEventId(repoRoot, project);
  const seqStr = String(seq).padStart(3, '0');
  const filename = `${project}-${seqStr}-status.json`;
  const filePath = join(eventsDir(repoRoot), filename);

  const doc: Record<string, unknown> = {
    event_id: randomUUID(),
    event_type: 'status_transition',
    occurred_at: new Date().toISOString(),
    work_item_id: { project, id: workItemId },
    work_item_type: workItemType,
    from_status: from,
    to_status: to,
    actor: actorObject(actor),
  };
  if (gate !== undefined) {
    doc.reason = gate;
  }

  writeFileSync(filePath, JSON.stringify(doc, null, 2) + '\n');
  return filePath;
}

/**
 * Emits a gate-decision event to `.cloverleaf/events/`.
 * File name: `<PROJECT>-<NNN>-gate.json`.
 *
 * Returns the absolute path of the written file.
 */
export function emitGateDecision(repoRoot: string, params: GateDecisionParams): string {
  const { project, workItemType, workItemId, gate, decision, actor, reasoning } = params;
  const seq = nextEventId(repoRoot, project);
  const seqStr = String(seq).padStart(3, '0');
  const filename = `${project}-${seqStr}-gate.json`;
  const filePath = join(eventsDir(repoRoot), filename);

  const doc: Record<string, unknown> = {
    event_id: randomUUID(),
    event_type: 'gate_decision',
    occurred_at: new Date().toISOString(),
    work_item_id: { project, id: workItemId },
    work_item_type: workItemType,
    gate,
    decision,
    actor: actorObject(actor),
  };
  if (reasoning !== undefined) {
    doc.reasoning = reasoning;
  }

  writeFileSync(filePath, JSON.stringify(doc, null, 2) + '\n');
  return filePath;
}
