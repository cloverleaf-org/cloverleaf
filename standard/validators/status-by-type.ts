import type { WorkItem, ValidationResult, WorkItemType } from './types.js';

const ALLOWED: Record<WorkItemType, Set<string>> = {
  rfc: new Set(['drafting', 'spike-in-flight', 'planning', 'gate-pending', 'approved', 'rejected', 'abandoned']),
  spike: new Set(['pending', 'running', 'completed', 'abandoned']),
  plan: new Set(['drafting', 'gate-pending', 'approved', 'rejected']),
  task: new Set([
    'pending', 'tactical-plan', 'implementing', 'documenting',
    'review', 'automated-gates', 'ui-review', 'qa', 'final-gate',
    'merged', 'rejected', 'escalated'
  ])
};

/**
 * Validator #3: Work Item status is in the allowed enum for its type.
 */
export function validateStatusByType(wi: WorkItem): ValidationResult {
  const allowed = ALLOWED[wi.type];
  if (!allowed) {
    return {
      ok: false,
      violations: [{ rule: 'status-by-type', message: `Unknown type: ${wi.type}`, severity: 'error' }]
    };
  }
  if (!allowed.has(wi.status)) {
    return {
      ok: false,
      violations: [{
        rule: 'status-by-type',
        message: `Status '${wi.status}' is not valid for type '${wi.type}'. Allowed: ${[...allowed].join(', ')}`,
        severity: 'error',
        workItemId: { project: wi.project, id: wi.id }
      }]
    };
  }
  return { ok: true };
}
