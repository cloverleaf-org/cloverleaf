import type { PlanDoc } from './plan.js';

export interface WalkState {
  plan_id: string;
  started: string;
  max_concurrent: number;
  tasks: Record<
    string,
    | { state: 'pending' }
    | { state: 'running'; session_id: string; started_at: string; last_seq: number }
    | {
        state: 'awaiting_final_gate';
        session_id: string;
        started_at: string;
        last_seq: number;
      }
    | {
        state: 'merged';
        session_id: string;
        merged_at: string;
        merge_commit: string;
      }
    | {
        state: 'escalated';
        session_id: string;
        escalated_at: string;
        reason: string;
      }
  >;
}

/**
 * Scheduler for the DAG walker. Given a Plan and the current walk state, returns the
 * task IDs that are safe to spawn a Session B for right now:
 *
 *   1. Status is effectively `pending` (no state recorded, or recorded as `pending`).
 *   2. Every ancestor in the task_dag has recorded state === 'merged'.
 *   3. The count of returned IDs is capped at `maxConcurrent - currentlyRunning`.
 *
 * Order is deterministic (sorted ascending by task id) so callers can be reproducible.
 */
export function computeReadyTasks(
  plan: PlanDoc,
  walkState: WalkState,
  maxConcurrent: number,
): string[] {
  const running = Object.values(walkState.tasks).filter(
    (t) => t.state === 'running' || t.state === 'awaiting_final_gate',
  ).length;

  const slots = Math.max(0, maxConcurrent - running);
  if (slots === 0) return [];

  const parents: Record<string, string[]> = {};
  for (const node of plan.task_dag.nodes) {
    parents[node.id] = [];
  }
  for (const edge of plan.task_dag.edges) {
    const to = edge.to.id;
    const from = edge.from.id;
    if (!parents[to]) parents[to] = [];
    parents[to].push(from);
  }

  const ready: string[] = [];
  const allIds = plan.task_dag.nodes.map((n) => n.id).sort();
  for (const id of allIds) {
    const current = walkState.tasks[id];
    const isPending = !current || current.state === 'pending';
    if (!isPending) continue;

    const ancestorsMerged = (parents[id] ?? []).every(
      (p) => walkState.tasks[p]?.state === 'merged',
    );
    if (!ancestorsMerged) continue;

    ready.push(id);
    if (ready.length >= slots) break;
  }

  return ready;
}
