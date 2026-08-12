import type { StatusTransitionEvent, StatusTransitions, Task, ValidationResult } from './types.js';

/**
 * Validator #8: Status transition is legal per the state machine for the Work Item type.
 *
 * `workItem` is accepted for signature symmetry with the sibling security-gate validator
 * and is not read by this rule. It previously resolved the transition's delivery-lane
 * `path` tag, which was retired with the collapsed task FSM in 0.8.0.
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

  const match = stateMachine.transitions.find((t) => {
    if (t.from !== event.from_status || t.to !== event.to_status) return false;
    if (t.allowed_actors && !t.allowed_actors.includes(event.actor.kind)) return false;
    return true;
  });

  if (!match) {
    return {
      ok: false,
      violations: [{
        rule: 'status-transition-legality',
        message: `Illegal transition for type '${event.work_item_type}': ${event.from_status} → ${event.to_status} by ${event.actor.kind}`,
        severity: 'error',
        workItemId: event.work_item_id
      }]
    };
  }
  return { ok: true };
}
