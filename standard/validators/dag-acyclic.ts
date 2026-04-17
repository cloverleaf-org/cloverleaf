import type { DependencyDAG, ValidationResult, Violation } from './types.js';
import { refKey } from './types.js';

/**
 * Validator #1: DAG acyclicity.
 *
 * Returns ok if the graph has no cycles; otherwise returns violations
 * identifying the cycle(s) found. Uses DFS with a recursion stack.
 */
export function validateDagAcyclic(dag: DependencyDAG): ValidationResult {
  const adjacency = new Map<string, string[]>();
  for (const node of dag.nodes) {
    adjacency.set(refKey(node), []);
  }
  for (const { from, to } of dag.edges) {
    const fromKey = refKey(from);
    const list = adjacency.get(fromKey);
    if (list) list.push(refKey(to));
  }

  const visited = new Set<string>();
  const stack = new Set<string>();
  const violations: Violation[] = [];

  function dfs(node: string, path: string[]): void {
    if (stack.has(node)) {
      const cycleStart = path.indexOf(node);
      const cycle = path.slice(cycleStart).concat(node).join(' → ');
      violations.push({
        rule: 'dag-acyclic',
        message: `Cycle detected: ${cycle}`,
        severity: 'error'
      });
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    stack.add(node);
    const neighbors = adjacency.get(node) ?? [];
    for (const next of neighbors) {
      dfs(next, [...path, node]);
    }
    stack.delete(node);
  }

  for (const nodeKey of adjacency.keys()) {
    if (!visited.has(nodeKey)) {
      dfs(nodeKey, []);
    }
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}
