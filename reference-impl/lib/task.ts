import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { tasksDir, projectsDir } from './paths.js';
import type { StatusTransitions, Task as SMTask } from '@cloverleaf/standard/validators/index.js';
import { validateOrThrow } from './validate.js';
import { advanceWorkItemStatus } from './work-item.js';

const req = createRequire(import.meta.url);

export interface TaskDoc {
  type: 'task';
  project: string;
  id: string;
  title: string;
  status: string;
  risk_class: 'low' | 'high';
  owner: { kind: 'agent' | 'human' | 'system'; id: string };
  acceptance_criteria: string[];
  definition_of_done: string[];
  context: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ProjectDoc {
  key: string;
  name: string;
  [key: string]: unknown;
}

export function loadTask(repoRoot: string, taskId: string): TaskDoc {
  const path = join(tasksDir(repoRoot), `${taskId}.json`);
  if (!existsSync(path)) throw new Error(`Task ${taskId} not found at ${path}`);
  return JSON.parse(readFileSync(path, 'utf-8')) as TaskDoc;
}

export function saveTask(repoRoot: string, task: TaskDoc): void {
  validateOrThrow('https://cloverleaf.example/schemas/task.schema.json', task);
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

  const riskClass: 'low' | 'high' =
    options.path === 'fast_lane' ? 'low'
    : options.path === 'full_pipeline' ? 'high'
    : (task.risk_class ?? 'low');

  const workItemForValidator: SMTask = {
    type: 'task',
    id: task.id,
    project: task.project,
    status: task.status,
    risk_class: riskClass,
    context: { rfc: { project: task.project, id: task.id } },
    definition_of_done: task.definition_of_done,
    acceptance_criteria: task.acceptance_criteria,
  };

  const proposed = { ...task, status: toStatus };
  advanceWorkItemStatus({
    repoRoot,
    workItemType: 'task',
    project: task.project,
    id: task.id,
    from,
    to: toStatus,
    actor,
    stateMachine: sm,
    validateFixture: workItemForValidator as unknown as Record<string, unknown>,
    save: (p) => saveTask(repoRoot, p as TaskDoc),
    proposed,
    gate: options.gate,
    path: options.path,
  });
  return proposed;
}
