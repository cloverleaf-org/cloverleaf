import { describe, it, expect } from 'vitest';
import { validateRelationshipMirror } from '../../validators/relationship-mirror.js';
import type { WorkItem } from '../../validators/types.js';

function wi(id: string, rels: WorkItem['relationships']): WorkItem {
  return {
    id, type: 'task', status: 'pending', project: 'ACME',
    owner: { kind: 'agent', id: 'a' },
    relationships: rels
  } as WorkItem;
}

describe('validator: relationship-mirror', () => {
  it('accepts when blocks/is_blocked_by mirror', () => {
    const a = wi('A', [{ type: 'blocks', target: { project: 'ACME', id: 'B' } }]);
    const b = wi('B', [{ type: 'is_blocked_by', target: { project: 'ACME', id: 'A' } }]);
    const registry = new Map<string, WorkItem>([['ACME::A', a], ['ACME::B', b]]);
    expect(validateRelationshipMirror(a, registry).ok).toBe(true);
  });

  it('rejects unmirrored blocks', () => {
    const a = wi('A', [{ type: 'blocks', target: { project: 'ACME', id: 'B' } }]);
    const b = wi('B', []);
    const registry = new Map<string, WorkItem>([['ACME::A', a], ['ACME::B', b]]);
    const r = validateRelationshipMirror(a, registry);
    expect(r.ok).toBe(false);
  });

  it('accepts symmetric relates_to', () => {
    const a = wi('A', [{ type: 'relates_to', target: { project: 'ACME', id: 'B' } }]);
    const b = wi('B', [{ type: 'relates_to', target: { project: 'ACME', id: 'A' } }]);
    const registry = new Map<string, WorkItem>([['ACME::A', a], ['ACME::B', b]]);
    expect(validateRelationshipMirror(a, registry).ok).toBe(true);
  });
});
