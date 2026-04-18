import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { tasksDir, projectsDir } from './paths.js';
import { emitStatusTransition } from './events.js';

// Import validator from @cloverleaf/standard.
// The standard package ships TypeScript source only with no exports map.
// Vitest (via vite-node) resolves .js → .ts for workspace symlinked packages,
// so the .js convention works here. If it ever fails with "module not found",
// switch the specifier to '@cloverleaf/standard/validators/index.ts'.
import { validateStatusTransitionLegality } from '@cloverleaf/standard/validators/index.js';
import type { StatusTransitions, Task as SMTask } from '@cloverleaf/standard/validators/index.js';

const req = createRequire(import.meta.url);

export interface TaskDoc {
  type: 'task';
  project: string;
  id: string;
  title: string;
  status: string;
  path?: 'fast_lane' | 'full_pipeline';
  acceptance_criteria: string[];
  definition_of_done: string;
  context: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ProjectDoc {
  project: string;
  id_pattern?: string;
  [key: string]: unknown;
}

export function loadTask(repoRoot: string, taskId: string): TaskDoc {
  const path = join(tasksDir(repoRoot), `${taskId}.json`);
  if (!existsSync(path)) throw new Error(`Task ${taskId} not found at ${path}`);
  return JSON.parse(readFileSync(path, 'utf-8')) as TaskDoc;
}

export function saveTask(repoRoot: string, task: TaskDoc): void {
  const path = join(tasksDir(repoRoot), `${task.id}.json`);
  writeFileSync(path, JSON.stringify(task, null, 2) + '\n');
}

export function loadProject(repoRoot: string, projectId: string): ProjectDoc {
  const path = join(projectsDir(repoRoot), `${projectId}.json`);
  if (!existsSync(path)) throw new Error(`Project ${projectId} not found at ${path}`);
  return JSON.parse(readFileSync(path, 'utf-8')) as ProjectDoc;
}

function loadTaskStateMachine(): StatusTransitions {
  // state-machines/task.json is a static JSON asset. Navigate from standard's
  // package.json — no exports map support needed.
  const pkgPath = req.resolve('@cloverleaf/standard/package.json');
  const pkgDir = pkgPath.replace(/\/package\.json$/, '');
  return JSON.parse(readFileSync(`${pkgDir}/state-machines/task.json`, 'utf-8')) as StatusTransitions;
}

export function advanceStatus(
  repoRoot: string,
  taskId: string,
  toStatus: string,
  actor: 'agent' | 'human',
  options: { gate?: string; path?: 'fast_lane' | 'full_pipeline' } = {}
): TaskDoc {
  const task = loadTask(repoRoot, taskId);
  const from = task.status;
  const sm = loadTaskStateMachine();

  // Derive risk_class from task.path so the validator can match path-tagged transitions.
  // The validator derives itemPath from workItem.risk_class: low → fast_lane, else full_pipeline.
  const taskPath = options.path ?? task.path;
  const riskClass: 'low' | 'high' = taskPath === 'fast_lane' ? 'low' : 'high';

  // Build a minimal Task-shaped object so the validator can resolve path-tagged transitions.
  const workItemForValidator: SMTask = {
    type: 'task',
    id: task.id,
    project: task.project,
    status: task.status,
    risk_class: riskClass,
    context: { rfc: { project: task.project, id: task.id } },
    definition_of_done: Array.isArray(task.definition_of_done)
      ? task.definition_of_done
      : [task.definition_of_done],
    acceptance_criteria: task.acceptance_criteria,
  };

  const event = {
    event_id: randomUUID(),
    event_type: 'status_transition' as const,
    occurred_at: new Date().toISOString(),
    work_item_id: { project: task.project, id: task.id },
    work_item_type: 'task' as const,
    from_status: from,
    to_status: toStatus,
    actor: { kind: actor, id: actor },
    ...(options.gate ? { reason: options.gate } : {}),
  };

  const result = validateStatusTransitionLegality(event, sm, workItemForValidator);
  if (!result.ok) {
    const msgs = result.violations.map((v) => v.message).join('; ');
    throw new Error(`Illegal transition ${from} → ${toStatus}: ${msgs}`);
  }

  task.status = toStatus;
  saveTask(repoRoot, task);
  emitStatusTransition(repoRoot, {
    project: task.project,
    workItemType: 'task',
    workItemId: task.id,
    from,
    to: toStatus,
    actor,
    gate: options.gate,
    path: options.path,
  });
  return task;
}
