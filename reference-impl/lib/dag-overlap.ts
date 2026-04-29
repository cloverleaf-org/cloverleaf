/**
 * dag-overlap.ts — reference-impl v0.7.0
 *
 * Infers TaskDag serialization edges from shared `scope.files_touched` paths.
 * Two tasks that touch the same file must be serialized to avoid merge conflicts.
 *
 * Algorithm:
 *  1. For each task, extract `scope?.files_touched` (absent / empty → zero contribution).
 *  2. Normalize each path: strip leading `./`, collapse multiple leading `./`, strip
 *     trailing `/`, canonicalize separators to forward-slash.
 *  3. Enumerate all (i, j) pairs where i < j (by task index). For each pair, compute
 *     the intersection of their normalized file sets.
 *  4. For each intersecting pair, emit one edge: lower-id (lexicographic) → higher-id.
 *  5. Deduplicate edges by (from.id, to.id) — a pair can share multiple files, but
 *     only one edge is emitted per unique (from, to) combination.
 *  6. Sort output by (from.id, to.id) for deterministic ordering.
 */

import type { TaskDoc } from './task.js';

// Re-export the shape used in plan.ts so callers can use one import.
export interface TaskDagEdgeRef {
  project: string;
  id: string;
}

export interface TaskDagEdge {
  from: TaskDagEdgeRef;
  to: TaskDagEdgeRef;
}

/**
 * Normalize a raw file path from `scope.files_touched`.
 *
 * Rules (applied in order):
 *  - Trim whitespace
 *  - Replace backslashes with forward-slashes
 *  - Strip any number of leading `./` sequences
 *  - Strip trailing `/`
 *  - Return the resulting string (may be empty for degenerate inputs; caller filters)
 */
function normalizePath(p: string): string {
  let s = p.trim().replace(/\\/g, '/');
  // Strip leading `./` repeatedly
  while (s.startsWith('./')) {
    s = s.slice(2);
  }
  // Strip trailing `/`
  while (s.endsWith('/') && s.length > 1) {
    s = s.slice(0, -1);
  }
  return s;
}

/**
 * Extract and normalize `scope.files_touched` from a task document.
 * Returns an empty array if the field is absent, null, or empty.
 */
function getFiles(task: TaskDoc): string[] {
  const scope = task['scope'] as Record<string, unknown> | undefined;
  if (!scope) return [];
  const files = scope['files_touched'];
  if (!Array.isArray(files)) return [];
  const normalized: string[] = [];
  for (const f of files) {
    if (typeof f !== 'string') continue;
    const n = normalizePath(f);
    if (n.length > 0) normalized.push(n);
  }
  return normalized;
}

/**
 * Compute the canonical overlap edge (from → to) for a pair of tasks.
 * The edge always points from the lexicographically lower id to the higher id.
 */
function makeEdgeRef(
  projectA: string, idA: string,
  projectB: string, idB: string
): { from: TaskDagEdgeRef; to: TaskDagEdgeRef } {
  if (idA <= idB) {
    return { from: { project: projectA, id: idA }, to: { project: projectB, id: idB } };
  }
  return { from: { project: projectB, id: idB }, to: { project: projectA, id: idA } };
}

/**
 * Compute overlap-inferred DAG edges from a list of task documents.
 *
 * Returns a deterministically ordered, deduplicated list of `TaskDagEdge`
 * values — one edge per (from.id, to.id) pair that shares at least one
 * normalized file path.
 *
 * Input order is irrelevant; output order is sorted by (from.id, to.id).
 */
export function computeOverlapEdges(tasks: TaskDoc[]): TaskDagEdge[] {
  if (tasks.length < 2) return [];

  // Build a map: taskIndex → normalized file set
  const fileSets: Array<Set<string>> = tasks.map(t => new Set(getFiles(t)));

  // Collect edges using a map keyed by "fromId|toId" for deduplication
  const edgeMap = new Map<string, TaskDagEdge>();

  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const setA = fileSets[i];
      const setB = fileSets[j];
      if (setA.size === 0 || setB.size === 0) continue;

      // Check intersection
      let hasOverlap = false;
      for (const f of setA) {
        if (setB.has(f)) {
          hasOverlap = true;
          break;
        }
      }
      if (!hasOverlap) continue;

      const taskA = tasks[i];
      const taskB = tasks[j];
      const edge = makeEdgeRef(
        taskA.project, taskA.id,
        taskB.project, taskB.id
      );
      const key = `${edge.from.id}|${edge.to.id}`;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, edge);
      }
    }
  }

  // Sort for determinism: by from.id, then to.id
  const edges = Array.from(edgeMap.values());
  edges.sort((a, b) => {
    const c = a.from.id.localeCompare(b.from.id);
    return c !== 0 ? c : a.to.id.localeCompare(b.to.id);
  });

  return edges;
}

/**
 * Return true if task A and task B share at least one normalized file path.
 * Used by savePlan to report which file caused the cycle.
 */
export function getFirstSharedFile(taskA: TaskDoc, taskB: TaskDoc): string | null {
  const setA = new Set(getFiles(taskA));
  const filesB = getFiles(taskB);
  for (const f of filesB) {
    if (setA.has(f)) return f;
  }
  return null;
}
