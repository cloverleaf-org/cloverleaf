import type { StatusTransitionEvent, StatusTransitions, Task, ValidationResult } from './types.js';

/**
 * Validator: Security-gate precondition on flagged transitions.
 *
 * When a transition carries `security_gate: true` and the task's
 * `security_class === "high"`, the transition is legal only if
 * `security_review_verdict === "pass"`.
 *
 * Early exits:
 *   - Non-task work items → ok (only tasks carry security_class).
 *   - Transition not found or not flagged → ok (nothing to enforce).
 *   - security_class !== "high" → ok (rule does not apply).
 */
export function validateSecurityGate(
  event: StatusTransitionEvent,
  stateMachine: StatusTransitions,
  workItem?: Task
): ValidationResult {
  // Non-task work items are not subject to the security gate.
  if (!workItem || workItem.type !== 'task') {
    return { ok: true };
  }

  // Find the matching transition in the state machine.
  const transition = stateMachine.transitions.find(
    (t) => t.from === event.from_status && t.to === event.to_status
  );

  // If transition is not found or not flagged with security_gate, nothing to enforce.
  if (!transition || !transition.security_gate) {
    return { ok: true };
  }

  // Only high-security tasks are subject to this rule.
  if (workItem.security_class !== 'high') {
    return { ok: true };
  }

  // Verdict must be "pass" for the transition to be allowed.
  const verdict = workItem.security_review_verdict ?? null;
  if (verdict === 'pass') {
    return { ok: true };
  }

  return {
    ok: false,
    violations: [{
      rule: 'security-gate',
      severity: 'error',
      message:
        `Transition ${event.from_status} → ${event.to_status} requires security_review_verdict="pass" ` +
        `(task.security_class is "high"; current verdict: ${verdict ?? 'null'}). ` +
        `Advance to security-review first.`,
      workItemId: event.work_item_id
    }]
  };
}
