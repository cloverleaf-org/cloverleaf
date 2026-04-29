import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { plansDir, tasksDir } from './paths.js';
import { validateOrThrow } from './validate.js';
import { advanceWorkItemStatus, loadStateMachine } from './work-item.js';
import { computeOverlapEdges, getFirstSharedFile } from './dag-overlap.js';
import type { TaskDoc } from './task.js';

export interface WorkItemRef {
  project: string;
  id: string;
}

export interface TaskDag {
  nodes: WorkItemRef[];
  edges: Array<{ from: WorkItemRef; to: WorkItemRef }>;
}

export interface PlanDoc {
  type: 'plan';
  project: string;
  id: string;
  status: string;
  owner: { kind: 'agent' | 'human' | 'system'; id: string };
  parent_rfc: WorkItemRef;
  task_dag: TaskDag;
  tasks: Array<Record<string, unknown>>;
  path_reviewer_map?: Array<{ pattern: string; role: string }>;
  [key: string]: unknown;
}

export function loadPlan(repoRoot: string, id: string): PlanDoc {
  const path = join(plansDir(repoRoot), `${id}.json`);
  if (!existsSync(path)) throw new Error(`Plan ${id} not found at ${path}`);
  return JSON.parse(readFileSync(path, 'utf-8')) as PlanDoc;
}

export function savePlan(repoRoot: string, plan: PlanDoc): void {
  // 1. Schema validation.
  validateOrThrow('https://cloverleaf.example/schemas/plan.schema.json', plan);

  // 2. Compute overlap-inferred edges from task scope.files_touched and
  //    merge them into task_dag.edges via set-union (idempotent).
  const tasks = plan.tasks as unknown as TaskDoc[];
  const overlapEdges = computeOverlapEdges(tasks);
  if (overlapEdges.length > 0) {
    const existingKeys = new Set(
      plan.task_dag.edges.map(e => `${e.from.id}|${e.to.id}`)
    );
    const newEdges = overlapEdges.filter(
      e => !existingKeys.has(`${e.from.id}|${e.to.id}`)
    );
    if (newEdges.length > 0) {
      plan = {
        ...plan,
        task_dag: {
          ...plan.task_dag,
          edges: [...plan.task_dag.edges, ...newEdges],
        },
      };
    }
  }

  // 3. Cycle detection on the augmented DAG. Only triggered when overlap
  //    edges are present — if computeOverlapEdges emitted any edges, we
  //    must verify the merged graph is acyclic. Report which pair and which
  //    file caused the cycle.
  if (overlapEdges.length > 0) {
    const cycleNodeId = detectCycle(plan.task_dag);
    if (cycleNodeId !== null) {
      // Find the two tasks involved in the cycle that share a file.
      const taskMap = new Map<string, TaskDoc>();
      for (const t of tasks) taskMap.set(t.id, t);
      let errorMsg = `file overlap creates cycle: ${cycleNodeId} ↔ (unknown) via (unknown)`;
      // Try to find a concrete overlap pair that touches the cycle node.
      outer: for (const edge of overlapEdges) {
        const tFrom = taskMap.get(edge.from.id);
        const tTo = taskMap.get(edge.to.id);
        if (!tFrom || !tTo) continue;
        if (edge.from.id !== cycleNodeId && edge.to.id !== cycleNodeId) continue;
        const sharedFile = getFirstSharedFile(tFrom, tTo);
        if (sharedFile) {
          errorMsg = `file overlap creates cycle: ${edge.from.id} ↔ ${edge.to.id} via ${sharedFile}`;
          break outer;
        }
      }
      throw new Error(errorMsg);
    }
  }

  // 4. Write to disk.
  mkdirSync(plansDir(repoRoot), { recursive: true });
  const path = join(plansDir(repoRoot), `${plan.id}.json`);
  writeFileSync(path, JSON.stringify(plan, null, 2) + '\n');
}

export function advancePlanStatus(
  repoRoot: string,
  id: string,
  toStatus: string,
  actor: 'agent' | 'human',
  options: { gate?: string } = {}
): PlanDoc {
  const plan = loadPlan(repoRoot, id);
  const from = plan.status;
  const sm = loadStateMachine('plan');
  const fixture = { type: 'plan', id: plan.id, project: plan.project, status: plan.status };

  const proposed = { ...plan, status: toStatus };
  advanceWorkItemStatus({
    repoRoot,
    workItemType: 'plan',
    project: plan.project,
    id: plan.id,
    from,
    to: toStatus,
    actor,
    stateMachine: sm,
    validateFixture: fixture,
    save: (p) => savePlan(repoRoot, p as PlanDoc),
    proposed,
    gate: options.gate,
  });
  return proposed;
}

/**
 * Build a directed graph from the DAG's edges and detect any cycle.
 * Returns the first node id involved in a cycle, or null.
 */
function detectCycle(dag: TaskDag): string | null {
  // Build adjacency: for each node, list of node ids it points TO.
  const adj = new Map<string, string[]>();
  for (const n of dag.nodes) adj.set(n.id, []);
  for (const e of dag.edges) {
    const from = e.from.id;
    const to = e.to.id;
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from)!.push(to);
  }

  const state = new Map<string, 'white' | 'grey' | 'black'>();
  for (const n of dag.nodes) state.set(n.id, 'white');

  const visit = (id: string): boolean => {
    const s = state.get(id);
    if (s === 'grey') return true; // back-edge → cycle
    if (s === 'black') return false;
    state.set(id, 'grey');
    for (const next of adj.get(id) ?? []) {
      if (visit(next)) return true;
    }
    state.set(id, 'black');
    return false;
  };

  for (const n of dag.nodes) {
    if (visit(n.id)) return n.id;
  }
  return null;
}

/**
 * Materialise all inline tasks from an approved Plan onto disk as
 * .cloverleaf/tasks/<id>.json. Atomic: pre-validates every task before
 * any file write. Throws on cycle in task_dag or AJV failure — no
 * partial materialisation on failure. Returns the ordered list of
 * materialised task IDs.
 *
 * If a task file already exists at the target path, it is OVERWRITTEN.
 * Callers responsible for Delivery state consistency should not invoke
 * this on a Plan whose tasks are already materialised and in-flight.
 *
 * Called by /cloverleaf-discover after a human approves the Plan at
 * task_batch_gate. The gate ensures this function is invoked at most
 * once per Plan in normal operation.
 */
export function materialiseTasksFromPlan(repoRoot: string, plan: PlanDoc): string[] {
  // 1. Cycle check on edges.
  const cycleAt = detectCycle(plan.task_dag);
  if (cycleAt) throw new Error(`Plan task_dag contains a cycle involving ${cycleAt}`);

  // 2. Pre-validate every task before ANY file write.
  for (const task of plan.tasks) {
    validateOrThrow('https://cloverleaf.example/schemas/task.schema.json', task);
  }

  // 3. Ensure the tasks directory exists (no-op on fresh repos that haven't
  //    initialised .cloverleaf/tasks/ yet). Placed after cycle-check and
  //    validation so those fast-path shorts-circuit without any FS side-effect.
  mkdirSync(tasksDir(repoRoot), { recursive: true });

  // 4. Write all task files.
  const ids: string[] = [];
  for (const task of plan.tasks) {
    const id = String(task['id']);
    const path = join(tasksDir(repoRoot), `${id}.json`);
    writeFileSync(path, JSON.stringify(task, null, 2) + '\n');
    ids.push(id);
  }
  return ids;
}
