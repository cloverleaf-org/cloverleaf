import type { Plan, ValidationResult, Violation } from './types.js';
import { refKey } from './types.js';

/**
 * Validator #2: Plan's tasks[].id set equals task_dag.nodes set.
 */
export function validatePlanTasksMatchDag(plan: Plan): ValidationResult {
  const taskKeys = new Set(
    plan.tasks.map((t) => refKey({ project: plan.project, id: t.id }))
  );
  const dagKeys = new Set(plan.task_dag.nodes.map(refKey));

  const violations: Violation[] = [];
  for (const key of taskKeys) {
    if (!dagKeys.has(key)) {
      violations.push({
        rule: 'plan-tasks-match-dag',
        message: `Task ${key} appears in tasks[] but not in task_dag.nodes`,
        severity: 'error'
      });
    }
  }
  for (const key of dagKeys) {
    if (!taskKeys.has(key)) {
      violations.push({
        rule: 'plan-tasks-match-dag',
        message: `Node ${key} appears in task_dag.nodes but not in tasks[]`,
        severity: 'error'
      });
    }
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}
