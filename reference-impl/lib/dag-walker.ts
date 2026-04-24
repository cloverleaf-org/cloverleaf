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

/**
 * Returns `null` if the Plan's task_dag is acyclic. If a cycle is present, returns
 * `{ cycle: string[] }` naming the task IDs involved in one cycle (order is the
 * traversal order, which is a valid witness of the cycle).
 *
 * Uses Tarjan-style DFS with a white/grey/black colouring.
 */
export function detectCycle(plan: PlanDoc): { cycle: string[] } | null {
  const adj: Record<string, string[]> = {};
  for (const node of plan.task_dag.nodes) adj[node.id] = [];
  for (const edge of plan.task_dag.edges) {
    const from = edge.from.id;
    if (!adj[from]) adj[from] = [];
    adj[from].push(edge.to.id);
  }

  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color: Record<string, number> = {};
  for (const id of Object.keys(adj)) color[id] = WHITE;

  const path: string[] = [];

  function dfs(id: string): string[] | null {
    color[id] = GREY;
    path.push(id);
    for (const next of adj[id] ?? []) {
      if (color[next] === GREY) {
        const start = path.indexOf(next);
        return path.slice(start);
      }
      if (color[next] === WHITE) {
        const cycle = dfs(next);
        if (cycle) return cycle;
      }
    }
    color[id] = BLACK;
    path.pop();
    return null;
  }

  for (const id of Object.keys(adj)) {
    if (color[id] === WHITE) {
      const cycle = dfs(id);
      if (cycle) return { cycle };
    }
  }
  return null;
}
