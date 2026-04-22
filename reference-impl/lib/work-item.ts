import { randomUUID } from 'node:crypto';
import { emitStatusTransition, formatReason } from './events.js';
import { validateStatusTransitionLegality } from '@cloverleaf/standard/validators/index.js';
import type { StatusTransitions } from '@cloverleaf/standard/validators/index.js';

export interface AdvanceWorkItemParams<T> {
  repoRoot: string;
  workItemType: 'task' | 'rfc' | 'spike' | 'plan';
  project: string;
  id: string;
  from: string;
  to: string;
  actor: 'agent' | 'human';
  stateMachine: StatusTransitions;
  validateFixture: Record<string, unknown>;
  save: (proposed: T & { status: string }) => void;
  proposed: T;
  gate?: string;
  path?: 'fast_lane' | 'full_pipeline';
}

export interface AdvanceWorkItemResult {
  from: string;
  to: string;
}

export function advanceWorkItemStatus<T>(params: AdvanceWorkItemParams<T>): AdvanceWorkItemResult {
  const { repoRoot, workItemType, project, id, from, to, actor, stateMachine, validateFixture, save, gate, path } = params;

  const reason = formatReason({ gate, path });
  const event = {
    event_id: randomUUID(),
    event_type: 'status_transition' as const,
    occurred_at: new Date().toISOString(),
    work_item_id: { project, id },
    work_item_type: workItemType,
    from_status: from,
    to_status: to,
    actor: { kind: actor, id: actor },
    ...(reason ? { reason } : {}),
  };

  const result = validateStatusTransitionLegality(event, stateMachine, validateFixture as never);
  if (!result.ok) {
    const msgs = result.violations.map((v) => v.message).join('; ');
    throw new Error(`Illegal transition ${from} → ${to}: ${msgs}`);
  }

  const emittedPath = emitStatusTransition(repoRoot, {
    project,
    workItemType,
    workItemId: id,
    from,
    to,
    actor,
    gate,
    path,
  });

  try {
    save(params.proposed as T & { status: string });
  } catch (err) {
    const inner = err instanceof Error ? err.message : String(err);
    throw new Error(`orphan event written to ${emittedPath} but ${workItemType} save failed: ${inner}`);
  }

  return { from, to };
}
