import { writeFileSync, mkdirSync } from 'node:fs';
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
  decision: 'approve' | 'reject' | 'revise' | 'split' | 'abandon' | 'escalate';
  actor: 'agent' | 'human' | 'system';
  reasoning?: string;
}

function actorObject(kind: 'agent' | 'human' | 'system'): { kind: string; id: string } {
  const id = kind === 'agent' ? 'implementer' : kind === 'human' ? 'local-user' : 'system';
  return { kind, id };
}

export function formatReason(opts: { gate?: string; path?: string }): string | undefined {
  const parts: string[] = [];
  if (opts.gate) parts.push(`gate=${opts.gate}`);
  if (opts.path) parts.push(`path=${opts.path}`);
  return parts.length > 0 ? parts.join('; ') : undefined;
}

/**
 * Emits a status-transition event to `.cloverleaf/events/`.
 * File name: `<PROJECT>-<NNN>-status.json` where NNN is the next per-project
 * sequential number derived from existing event files.
 *
 * Returns the absolute path of the written file.
 */
export function emitStatusTransition(repoRoot: string, params: StatusTransitionParams): string {
  const { project, workItemType, workItemId, from, to, actor } = params;
  const seq = nextEventId(repoRoot, project);
  const seqStr = String(seq).padStart(3, '0');
  const filename = `${project}-${seqStr}-status.json`;
  const filePath = join(eventsDir(repoRoot), filename);

  // Build reason from gate and/or path if provided (schema only allows reason, not gate/path at top level).
  const reason = formatReason({ gate: params.gate, path: params.path });

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
  if (reason !== undefined) {
    doc.reason = reason;
  }

  mkdirSync(eventsDir(repoRoot), { recursive: true });
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
  const { project, workItemId, gate, decision, actor, reasoning } = params;
  const seq = nextEventId(repoRoot, project);
  const seqStr = String(seq).padStart(3, '0');
  const filename = `${project}-${seqStr}-gate.json`;
  const filePath = join(eventsDir(repoRoot), filename);

  const doc: Record<string, unknown> = {
    event_id: randomUUID(),
    event_type: 'gate_decision',
    occurred_at: new Date().toISOString(),
    gate,
    work_item_id: { project, id: workItemId },
    decision,
    approver: actorObject(actor),
  };
  if (reasoning !== undefined) {
    doc.comment = reasoning;
  }

  mkdirSync(eventsDir(repoRoot), { recursive: true });
  writeFileSync(filePath, JSON.stringify(doc, null, 2) + '\n');
  return filePath;
}
