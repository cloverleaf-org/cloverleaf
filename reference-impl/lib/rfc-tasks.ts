import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { plansDir, tasksDir, rfcsDir } from './paths.js';
import type { TaskDoc } from './task.js';

/**
 * A task is "standalone" (RFC-direct) iff it has no parent (absent or null)
 * AND it has a non-empty context.rfc.id. See
 * docs/superpowers/specs/2026-05-12-rfc-direct-tasks-design.md §"Discriminator".
 */
export function isStandaloneTask(task: TaskDoc): boolean {
  const parent = (task as Record<string, unknown>).parent;
  if (parent != null) return false;
  const ctx = task.context as Record<string, unknown> | undefined;
  const rfc = ctx?.rfc as { project?: string; id?: string } | undefined;
  return !!(rfc && typeof rfc.id === 'string' && rfc.id.length > 0);
}

export interface RfcSummary {
  inflight_plans: number;
  inflight_standalone: number;
  delivered_plans: number;
  delivered_standalone: number;
  can_auto_advance_rfc: boolean;
}

export interface RfcTasksView {
  rfc: { project: string; id: string; status: string };
  plans: Array<{
    project: string;
    id: string;
    status: string;
    tasks: Array<{ id: string; status: string }>;
  }>;
  standalone_tasks: Array<{ id: string; status: string }>;
  summary: RfcSummary;
}

const PLAN_INFLIGHT = new Set(['drafting', 'gate-pending', 'approved']);
const TASK_TERMINAL = new Set(['merged', 'rejected', 'escalated']);

export function computeRfcTasksView(repoRoot: string, rfcId: string): RfcTasksView {
  const rfcPath = join(rfcsDir(repoRoot), `${rfcId}.json`);
  if (!existsSync(rfcPath)) {
    throw new Error(`rfc ${rfcId} not found at ${rfcPath}`);
  }
  const rfc = JSON.parse(readFileSync(rfcPath, 'utf-8')) as {
    project: string; id: string; status: string;
  };

  // Load all plans of this RFC + their child task statuses
  const plans: RfcTasksView['plans'] = [];
  const plansDirPath = plansDir(repoRoot);
  if (existsSync(plansDirPath)) {
    for (const f of readdirSync(plansDirPath)) {
      if (!f.endsWith('.json')) continue;
      const plan = JSON.parse(readFileSync(join(plansDirPath, f), 'utf-8')) as {
        project: string; id: string; status: string;
        parent_rfc?: { project: string; id: string };
        task_dag?: { nodes?: Array<{ project: string; id: string }> };
      };
      if (plan.parent_rfc?.project !== rfc.project || plan.parent_rfc.id !== rfc.id) continue;

      const tasks: Array<{ id: string; status: string }> = [];
      for (const node of plan.task_dag?.nodes ?? []) {
        const taskPath = join(tasksDir(repoRoot), `${node.id}.json`);
        if (!existsSync(taskPath)) continue;
        const t = JSON.parse(readFileSync(taskPath, 'utf-8')) as { id: string; status: string };
        tasks.push({ id: t.id, status: t.status });
      }
      plans.push({ project: plan.project, id: plan.id, status: plan.status, tasks });
    }
  }

  // Load standalone tasks: parent absent/null AND context.rfc matches
  const standalone: Array<{ id: string; status: string }> = [];
  const tasksDirPath = tasksDir(repoRoot);
  if (existsSync(tasksDirPath)) {
    for (const f of readdirSync(tasksDirPath)) {
      if (!f.endsWith('.json')) continue;
      const t = JSON.parse(readFileSync(join(tasksDirPath, f), 'utf-8')) as TaskDoc;
      if (!isStandaloneTask(t)) continue;
      const ctxRfc = (t.context as Record<string, unknown>).rfc as {
        project?: string; id?: string;
      };
      if (ctxRfc.project !== rfc.project || ctxRfc.id !== rfc.id) continue;
      standalone.push({ id: t.id, status: t.status });
    }
  }
  standalone.sort((a, b) => a.id.localeCompare(b.id));

  const inflight_plans = plans.filter(p => PLAN_INFLIGHT.has(p.status)).length;
  const inflight_standalone = standalone.filter(t => !TASK_TERMINAL.has(t.status)).length;
  const delivered_plans = plans.filter(p => p.status === 'completed').length;
  const delivered_standalone = standalone.filter(t => t.status === 'merged').length;

  const can_auto_advance_rfc =
    rfc.status === 'approved' &&
    inflight_plans + inflight_standalone === 0 &&
    delivered_plans + delivered_standalone > 0;

  return {
    rfc: { project: rfc.project, id: rfc.id, status: rfc.status },
    plans,
    standalone_tasks: standalone,
    summary: {
      inflight_plans,
      inflight_standalone,
      delivered_plans,
      delivered_standalone,
      can_auto_advance_rfc,
    },
  };
}
