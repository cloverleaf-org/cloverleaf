import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tasksDir, projectsDir } from './paths.js';
import type { Task as SMTask } from '@cloverleaf/standard/validators/index.js';
import { validateOrThrow } from './validate.js';
import { advanceWorkItemStatus, loadStateMachine } from './work-item.js';
import { classifyTaskSecurity } from './security-classify.js';

export interface TaskDoc {
  type: 'task';
  project: string;
  id: string;
  title: string;
  status: string;
  risk_class: 'low' | 'high';
  security_class?: 'low' | 'high';
  security_review_verdict?: 'pass' | 'bounce' | 'escalate' | null;
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
  mkdirSync(tasksDir(repoRoot), { recursive: true });
  const path = join(tasksDir(repoRoot), `${task.id}.json`);
  writeFileSync(path, JSON.stringify(task, null, 2) + '\n');
}

export function loadProject(repoRoot: string, projectId: string): ProjectDoc {
  const path = join(projectsDir(repoRoot), `${projectId}.json`);
  if (!existsSync(path)) throw new Error(`Project ${projectId} not found at ${path}`);
  return JSON.parse(readFileSync(path, 'utf-8')) as ProjectDoc;
}

export function advanceStatus(
  repoRoot: string,
  taskId: string,
  toStatus: string,
  actor: 'agent' | 'human',
  options: { gate?: string; path?: 'fast_lane' | 'full_pipeline' } = {}
): TaskDoc {
  let task = loadTask(repoRoot, taskId);
  const from = task.status;
  const sm = loadStateMachine('task');

  const targetTransition = sm.transitions.find((t) => t.from === from && t.to === toStatus);

  // Security classification at council entry: a declared-low task whose diff touches a
  // sensitive path is upgraded to security_class:high so the delivery council runs its
  // blocking security member. (v0.8.0: replaces the retired security_gate FSM annotation.)
  if (from === 'documenting' && toStatus === 'council') {
    let classification;
    try {
      classification = classifyTaskSecurity(repoRoot, taskId);
    } catch (err) {
      process.stderr.write(
        `cloverleaf-cli advance-status: classify-security errored (${err instanceof Error ? err.message : String(err)}); treating effective security_class as "high".\n`
      );
      classification = {
        declared: (task.security_class === 'high' ? 'high' : 'low') as 'low' | 'high',
        diff_detected: true,
        effective: 'high' as const,
        matched_paths: [],
      };
    }
    if (classification.declared === 'low' && classification.effective === 'high') {
      const upgraded: TaskDoc = { ...task, security_class: 'high' };
      saveTask(repoRoot, upgraded);
      const taskFilePath = join(tasksDir(repoRoot), `${taskId}.json`);
      try {
        execFileSync('git', ['-C', repoRoot, 'add', taskFilePath], { stdio: 'pipe' });
        execFileSync(
          'git',
          ['-C', repoRoot, 'commit', '-m', `cloverleaf: ${taskId} security_class → high (diff-detected)`],
          { stdio: 'pipe' }
        );
      } catch {
        // No-op: commit is best-effort when running outside a git repo (e.g., test environments).
      }
      // Mutate in-memory so the validator sees the upgraded value.
      task = { ...upgraded };
    }
  }

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
    security_class: task.security_class,
    security_review_verdict: task.security_review_verdict,
    context: { rfc: { project: task.project, id: task.id } },
    definition_of_done: task.definition_of_done,
    acceptance_criteria: task.acceptance_criteria,
  };

  const resetsVerdict = targetTransition?.resets_security_verdict === true;
  const proposed: TaskDoc = {
    ...task,
    status: toStatus,
    ...(resetsVerdict ? { security_review_verdict: null } : {}),
  };

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

  // After a successful status change + verdict reset, emit a single commit covering both.
  if (resetsVerdict) {
    const taskFilePath = join(tasksDir(repoRoot), `${taskId}.json`);
    try {
      execFileSync('git', ['-C', repoRoot, 'add', taskFilePath], { stdio: 'pipe' });
      execFileSync(
        'git',
        ['-C', repoRoot, 'commit', '-m', `cloverleaf: ${taskId} status ${from} → ${toStatus}; security_review_verdict → null (rework)`],
        { stdio: 'pipe' }
      );
    } catch {
      // No-op: commit is best-effort when running outside a git repo (e.g., test environments).
    }
  }

  return proposed;
}
