import type { GateDecisionEvent, ValidationResult } from './types.js';

const ALLOWED: Record<GateDecisionEvent['gate'], Set<GateDecisionEvent['decision']>> = {
  rfc_strategy_gate: new Set(['approve', 'reject', 'revise', 'abandon']),
  task_batch_gate:   new Set(['approve', 'reject', 'revise', 'split']),
  per_task_plan_review: new Set(['approve', 'reject']),
  final_approval_gate: new Set(['approve', 'reject', 'escalate']),
  human_merge:       new Set(['approve', 'escalate'])
};

/**
 * Validator #7: Gate decision is valid for the gate type.
 */
export function validateGateDecisionValidity(event: GateDecisionEvent): ValidationResult {
  const allowed = ALLOWED[event.gate];
  if (!allowed.has(event.decision)) {
    return {
      ok: false,
      violations: [{
        rule: 'gate-decision-validity',
        message: `Decision '${event.decision}' is not valid for gate '${event.gate}'. Allowed: ${[...allowed].join(', ')}`,
        severity: 'error',
        workItemId: event.work_item_id
      }]
    };
  }
  return { ok: true };
}
