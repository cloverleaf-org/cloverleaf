/**
 * Shared types for Cloverleaf reference invariant validators.
 */

export interface WorkItemRef {
  project: string;
  id: string;
}

export type WorkItemType = 'rfc' | 'spike' | 'plan' | 'task';

export interface WorkItem {
  id: string;
  type: WorkItemType;
  status: string;
  project: string;
  parent?: WorkItemRef | null;
  relationships?: Relationship[];
  [extra: string]: unknown;
}

export interface Relationship {
  type: RelationshipType;
  target: WorkItemRef;
}

export type RelationshipType =
  | 'blocks' | 'is_blocked_by'
  | 'duplicates' | 'duplicate_of'
  | 'supersedes' | 'superseded_by'
  | 'split_from' | 'split_to'
  | 'relates_to';

export interface DependencyDAG {
  nodes: WorkItemRef[];
  edges: Array<{ from: WorkItemRef; to: WorkItemRef }>;
}

export interface Plan extends WorkItem {
  type: 'plan';
  parent_rfc: WorkItemRef;
  task_dag: DependencyDAG;
  tasks: Task[];
}

export interface Task extends WorkItem {
  type: 'task';
  context: { rfc: WorkItemRef; spikes?: WorkItemRef[] };
  definition_of_done: string[];
  acceptance_criteria: string[];
  risk_class: 'low' | 'high';
}

export interface Project {
  key: string;
  name: string;
  description?: string;
  id_pattern?: string;
  extensions?: Record<string, unknown>;
}

export interface StatusTransitionEvent {
  event_id: string;
  event_type: 'status_transition';
  occurred_at: string;
  work_item_id: WorkItemRef;
  work_item_type: WorkItemType;
  from_status: string;
  to_status: string;
  actor: { kind: 'human' | 'agent' | 'system'; id: string };
  reason?: string;
}

export interface GateDecisionEvent {
  event_id: string;
  event_type: 'gate_decision';
  occurred_at: string;
  gate: 'rfc_strategy_gate' | 'task_batch_gate' | 'per_task_plan_review' | 'final_approval_gate' | 'human_merge';
  work_item_id: WorkItemRef;
  decision: 'approve' | 'reject' | 'revise' | 'split' | 'abandon' | 'escalate';
  approver: { kind: 'human' | 'agent' | 'system'; id: string };
  comment?: string;
}

export interface StatusTransitions {
  type: WorkItemType;
  states: { initial: string[]; terminal: string[]; all: string[] };
  transitions: Array<{
    from: string;
    to: string;
    allowed_actors?: Array<'human' | 'agent' | 'system'>;
    gate?: string;
    path?: 'fast_lane' | 'full_pipeline';
    description?: string;
  }>;
}

export interface Violation {
  rule: string;
  message: string;
  path?: string;
  workItemId?: WorkItemRef;
  severity: 'error' | 'warning';
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; violations: Violation[] };

/** Helper: compare two workItemRefs for equality. */
export function refsEqual(a: WorkItemRef, b: WorkItemRef): boolean {
  return a.project === b.project && a.id === b.id;
}

/** Helper: stringify a ref for stable identity comparisons. */
export function refKey(ref: WorkItemRef): string {
  return `${ref.project}::${ref.id}`;
}
