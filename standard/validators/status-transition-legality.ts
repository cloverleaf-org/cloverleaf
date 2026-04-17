import type { StatusTransitionEvent, StatusTransitions, Task, ValidationResult } from './types.js';

/**
 * Validator #8: Status transition is legal per the state machine for the Work Item type.
 * For Task, also checks the transition's `path` tag against the work item's risk_class.
 */
export function validateStatusTransitionLegality(
  event: StatusTransitionEvent,
  stateMachine: StatusTransitions,
  workItem?: Task
): ValidationResult {
  if (event.work_item_type !== stateMachine.type) {
    return {
      ok: false,
      violations: [{
        rule: 'status-transition-legality',
        message: `Event work_item_type '${event.work_item_type}' does not match state machine type '${stateMachine.type}'`,
        severity: 'error',
        workItemId: event.work_item_id
      }]
    };
  }

  const itemPath = workItem && workItem.type === 'task'
    ? (workItem.risk_class === 'low' ? 'fast_lane' : 'full_pipeline')
    : undefined;

  const match = stateMachine.transitions.find((t) => {
    if (t.from !== event.from_status || t.to !== event.to_status) return false;
    if (t.path && t.path !== itemPath) return false;
    if (t.allowed_actors && !t.allowed_actors.includes(event.actor.kind)) return false;
    return true;
  });

  if (!match) {
    return {
      ok: false,
      violations: [{
        rule: 'status-transition-legality',
        message: `Illegal transition for type '${event.work_item_type}': ${event.from_status} → ${event.to_status}${itemPath ? ` (path=${itemPath})` : ''} by ${event.actor.kind}`,
        severity: 'error',
        workItemId: event.work_item_id
      }]
    };
  }
  return { ok: true };
}
