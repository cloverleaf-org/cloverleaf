import type { RelationshipType, ValidationResult, Violation, WorkItem, WorkItemRef } from './types.js';
import { refKey, refsEqual } from './types.js';

const INVERSE: Record<RelationshipType, RelationshipType> = {
  blocks: 'is_blocked_by',
  is_blocked_by: 'blocks',
  duplicates: 'duplicate_of',
  duplicate_of: 'duplicates',
  supersedes: 'superseded_by',
  superseded_by: 'supersedes',
  split_from: 'split_to',
  split_to: 'split_from',
  relates_to: 'relates_to'
};

/**
 * Validator #4: relationship mirror consistency.
 *
 * For every relationship on `item`, check that the target carries the
 * inverse relationship pointing back at `item`.
 */
export function validateRelationshipMirror(
  item: WorkItem,
  registry: Map<string, WorkItem>
): ValidationResult {
  const violations: Violation[] = [];
  const itemRef: WorkItemRef = { project: item.project, id: item.id };
  for (const rel of item.relationships ?? []) {
    const inverse = INVERSE[rel.type];
    const target = registry.get(refKey(rel.target));
    if (!target) {
      continue; // cross-project-ref validator (#6) flags missing targets
    }
    const hasMirror = (target.relationships ?? []).some(
      (r) => r.type === inverse && refsEqual(r.target, itemRef)
    );
    if (!hasMirror) {
      violations.push({
        rule: 'relationship-mirror',
        message: `Missing inverse relationship: ${refKey(itemRef)} has '${rel.type}' → ${refKey(rel.target)}, but target is missing '${inverse}' back-reference`,
        severity: 'error',
        workItemId: itemRef
      });
    }
  }
  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}
