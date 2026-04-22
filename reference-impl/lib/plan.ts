import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { plansDir } from './paths.js';
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
