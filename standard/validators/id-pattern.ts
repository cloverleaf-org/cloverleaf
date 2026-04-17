import type { Project, ValidationResult, WorkItem } from './types.js';

/**
 * Validator #5: Work Item id matches the project's id_pattern.
 * Default pattern when project.id_pattern is absent: `^{project_key}-\d+$`.
 */
export function validateIdPattern(wi: WorkItem, project: Project): ValidationResult {
  if (wi.project !== project.key) {
    return {
      ok: false,
      violations: [{
        rule: 'id-pattern',
        message: `Work Item project '${wi.project}' does not match supplied project '${project.key}'`,
        severity: 'error',
        workItemId: { project: wi.project, id: wi.id }
      }]
    };
  }
  const pattern = project.id_pattern ?? `^${escapeRegex(project.key)}-\\d+$`;
  const regex = new RegExp(pattern);
  if (!regex.test(wi.id)) {
    return {
      ok: false,
      violations: [{
        rule: 'id-pattern',
        message: `Work Item id '${wi.id}' does not match project '${project.key}' pattern '${pattern}'`,
        severity: 'error',
        workItemId: { project: wi.project, id: wi.id }
      }]
    };
  }
  return { ok: true };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
