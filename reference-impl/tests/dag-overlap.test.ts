/**
 * dag-overlap.test.ts — 12 test cases for computeOverlapEdges.
 *
 * Covers all scenarios from the CLV-78 design spec:
 *  1. empty list
 *  2. single task
 *  3. no overlap
 *  4. one overlap
 *  5. multiple overlapping files (one edge per pair, not one per file)
 *  6. three-task chain
 *  7. path normalization (strip leading ./)
 *  8. absent field (task has no scope)
 *  9. empty array (scope.files_touched: [])
 * 10. triangle (three tasks all sharing a common file → 3 edges)
 * 11. determinism (shuffled input yields identical output)
 * 12. UTF-8 filenames
 */

import { describe, it, expect } from 'vitest';
import { computeOverlapEdges } from '../lib/dag-overlap.js';
import type { TaskDoc } from '../lib/task.js';

function makeTask(id: string, files?: string[]): TaskDoc {
  const base: TaskDoc = {
    type: 'task',
    project: 'CLV',
    id,
    title: `Task ${id}`,
    status: 'pending',
    risk_class: 'low',
    owner: { kind: 'agent', id: 'implementer' },
    acceptance_criteria: ['ac'],
    definition_of_done: ['dod'],
    context: { rfc: { project: 'CLV', id: 'CLV-001' } },
  };
  if (files !== undefined) {
    (base as Record<string, unknown>)['scope'] = { files_touched: files };
  }
  return base;
}

describe('computeOverlapEdges', () => {
  // 1. Empty list → []
  it('returns [] for an empty task list', () => {
    expect(computeOverlapEdges([])).toEqual([]);
  });

  // 2. Single task → []
  it('returns [] for a single task (no pair to compare)', () => {
    const t = makeTask('CLV-001', ['lib/foo.ts']);
    expect(computeOverlapEdges([t])).toEqual([]);
  });

  // 3. No overlap → []
  it('returns [] when two tasks share no files', () => {
    const a = makeTask('CLV-001', ['lib/foo.ts']);
    const b = makeTask('CLV-002', ['lib/bar.ts']);
    expect(computeOverlapEdges([a, b])).toEqual([]);
  });

  // 4. One overlap → exactly one edge, lower id first
  it('returns exactly one edge when two tasks share one file', () => {
    const a = makeTask('CLV-001', ['lib/shared.ts']);
    const b = makeTask('CLV-002', ['lib/shared.ts', 'lib/other.ts']);
    const edges = computeOverlapEdges([a, b]);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toEqual({
      from: { project: 'CLV', id: 'CLV-001' },
      to: { project: 'CLV', id: 'CLV-002' },
    });
  });

  // 5. Multiple overlapping files → still one edge per (from, to) pair
  it('emits one edge per task pair regardless of how many files they share', () => {
    const a = makeTask('CLV-001', ['lib/a.ts', 'lib/b.ts', 'lib/c.ts']);
    const b = makeTask('CLV-002', ['lib/a.ts', 'lib/b.ts']);
    const edges = computeOverlapEdges([a, b]);
    expect(edges).toHaveLength(1);
    expect(edges[0].from.id).toBe('CLV-001');
    expect(edges[0].to.id).toBe('CLV-002');
  });

  // 6. Three-task chain: A-B share a file, B-C share a different file
  //    → edges A→B and B→C (but NOT A→C since they don't share a file)
  it('emits chain edges when tasks share files pairwise', () => {
    const a = makeTask('CLV-001', ['lib/ab.ts']);
    const b = makeTask('CLV-002', ['lib/ab.ts', 'lib/bc.ts']);
    const c = makeTask('CLV-003', ['lib/bc.ts']);
    const edges = computeOverlapEdges([a, b, c]);
    expect(edges).toHaveLength(2);
    const fromIds = edges.map(e => e.from.id);
    const toIds = edges.map(e => e.to.id);
    expect(fromIds).toContain('CLV-001');
    expect(toIds).toContain('CLV-002');
    expect(fromIds).toContain('CLV-002');
    expect(toIds).toContain('CLV-003');
    // Verify A→C edge is NOT present (they don't share a file)
    expect(edges.some(e => e.from.id === 'CLV-001' && e.to.id === 'CLV-003')).toBe(false);
  });

  // 7. Path normalization: ./reference-impl/lib/cli.ts and
  //    reference-impl/lib/cli.ts are the same → exactly one edge
  it('treats ./prefix and no-prefix paths as identical (path normalization)', () => {
    const a = makeTask('CLV-001', ['./reference-impl/lib/cli.ts']);
    const b = makeTask('CLV-002', ['reference-impl/lib/cli.ts']);
    const edges = computeOverlapEdges([a, b]);
    expect(edges).toHaveLength(1);
  });

  // 8. Absent field (task has no scope at all) → zero overlap contribution
  it('contributes zero edges from tasks with no scope field', () => {
    const a = makeTask('CLV-001'); // no scope
    const b = makeTask('CLV-002', ['lib/foo.ts']);
    expect(computeOverlapEdges([a, b])).toEqual([]);
  });

  // 9. Empty array (scope.files_touched: []) → zero overlap contribution
  it('contributes zero edges from tasks with empty files_touched array', () => {
    const a = makeTask('CLV-001', []);
    const b = makeTask('CLV-002', []);
    expect(computeOverlapEdges([a, b])).toEqual([]);
  });

  // 10. Triangle: three tasks all sharing the same file → 3 edges
  it('emits 3 edges when 3 tasks all share a common file (triangle)', () => {
    const a = makeTask('CLV-001', ['shared/config.ts']);
    const b = makeTask('CLV-002', ['shared/config.ts']);
    const c = makeTask('CLV-003', ['shared/config.ts']);
    const edges = computeOverlapEdges([a, b, c]);
    expect(edges).toHaveLength(3);
    // All pairwise combinations should be present
    expect(edges.some(e => e.from.id === 'CLV-001' && e.to.id === 'CLV-002')).toBe(true);
    expect(edges.some(e => e.from.id === 'CLV-001' && e.to.id === 'CLV-003')).toBe(true);
    expect(edges.some(e => e.from.id === 'CLV-002' && e.to.id === 'CLV-003')).toBe(true);
  });

  // 11. Determinism: shuffling the input array yields identical output edges
  it('produces identical output regardless of input task array order (determinism)', () => {
    const a = makeTask('CLV-001', ['lib/shared.ts']);
    const b = makeTask('CLV-002', ['lib/shared.ts']);
    const c = makeTask('CLV-003', ['lib/shared.ts']);

    const order1 = computeOverlapEdges([a, b, c]);
    const order2 = computeOverlapEdges([c, a, b]);
    const order3 = computeOverlapEdges([b, c, a]);
    const order4 = computeOverlapEdges([c, b, a]);

    expect(order1).toEqual(order2);
    expect(order1).toEqual(order3);
    expect(order1).toEqual(order4);
  });

  // 12. UTF-8 filenames are handled correctly
  it('handles UTF-8 filenames correctly', () => {
    const a = makeTask('CLV-001', ['lib/héros.ts', 'lib/日本語.ts']);
    const b = makeTask('CLV-002', ['lib/héros.ts', 'lib/日本語.ts']);
    const edges = computeOverlapEdges([a, b]);
    expect(edges).toHaveLength(1);
    expect(edges[0].from.id).toBe('CLV-001');
    expect(edges[0].to.id).toBe('CLV-002');
  });
});
