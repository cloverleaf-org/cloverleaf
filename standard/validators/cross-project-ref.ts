import type { Project, ValidationResult, WorkItemRef } from './types.js';

/**
 * Validator #6: workItemRef.project points to a project declared in the registry.
 */
export function validateCrossProjectRef(
  ref: WorkItemRef,
  projects: Project[]
): ValidationResult {
  const known = new Set(projects.map((p) => p.key));
  if (!known.has(ref.project)) {
    return {
      ok: false,
      violations: [{
        rule: 'cross-project-ref',
        message: `Reference targets unknown project '${ref.project}'. Known projects: ${[...known].join(', ') || '(none)'}`,
        severity: 'error',
        workItemId: ref
      }]
    };
  }
  return { ok: true };
}
