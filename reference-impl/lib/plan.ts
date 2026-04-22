import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { plansDir, tasksDir } from './paths.js';
import { validateOrThrow } from './validate.js';
import { advanceWorkItemStatus, loadStateMachine } from './work-item.js';

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
  validateOrThrow('https://cloverleaf.example/schemas/plan.schema.json', plan);
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
 */
export function materialiseTasksFromPlan(repoRoot: string, plan: PlanDoc): string[] {
  // 1. Cycle check on edges.
  const cycleAt = detectCycle(plan.task_dag);
  if (cycleAt) throw new Error(`Plan task_dag contains a cycle involving ${cycleAt}`);

  // 2. Pre-validate every task before ANY file write.
  for (const task of plan.tasks) {
    validateOrThrow('https://cloverleaf.example/schemas/task.schema.json', task);
  }

  // 3. Write all task files.
  const ids: string[] = [];
  for (const task of plan.tasks) {
    const id = String(task['id']);
    const path = join(tasksDir(repoRoot), `${id}.json`);
    writeFileSync(path, JSON.stringify(task, null, 2) + '\n');
    ids.push(id);
  }
  return ids;
}
