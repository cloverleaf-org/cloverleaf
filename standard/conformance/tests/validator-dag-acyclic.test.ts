import { describe, it, expect } from 'vitest';
import { validateDagAcyclic } from '../../validators/dag-acyclic.js';
import type { DependencyDAG } from '../../validators/types.js';

describe('validator: dag-acyclic', () => {
  const ref = (id: string) => ({ project: 'ACME', id });

  it('accepts a diamond DAG', () => {
    const dag: DependencyDAG = {
      nodes: [ref('ACME-1'), ref('ACME-2'), ref('ACME-3'), ref('ACME-4')],
      edges: [
        { from: ref('ACME-1'), to: ref('ACME-2') },
        { from: ref('ACME-1'), to: ref('ACME-3') },
        { from: ref('ACME-2'), to: ref('ACME-4') },
        { from: ref('ACME-3'), to: ref('ACME-4') }
      ]
    };
    expect(validateDagAcyclic(dag)).toEqual({ ok: true });
  });

  it('rejects a 2-cycle', () => {
    const dag: DependencyDAG = {
      nodes: [ref('ACME-1'), ref('ACME-2')],
      edges: [
        { from: ref('ACME-1'), to: ref('ACME-2') },
        { from: ref('ACME-2'), to: ref('ACME-1') }
      ]
    };
    const result = validateDagAcyclic(dag);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations[0].rule).toBe('dag-acyclic');
    }
  });

  it('rejects a 3-cycle', () => {
    const dag: DependencyDAG = {
      nodes: [ref('ACME-1'), ref('ACME-2'), ref('ACME-3')],
      edges: [
        { from: ref('ACME-1'), to: ref('ACME-2') },
        { from: ref('ACME-2'), to: ref('ACME-3') },
        { from: ref('ACME-3'), to: ref('ACME-1') }
      ]
    };
    expect(validateDagAcyclic(dag).ok).toBe(false);
  });
});
