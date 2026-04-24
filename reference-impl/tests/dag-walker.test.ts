import { describe, it, expect } from 'vitest';
import { computeReadyTasks, type WalkState } from '../lib/dag-walker.js';
import type { PlanDoc } from '../lib/plan.js';

function plan(edges: Array<[string, string]>, taskIds: string[]): PlanDoc {
  const nodes = taskIds.map((id) => ({ project: 'CLV', id }));
  const mappedEdges = edges.map(([from, to]) => ({
    from: { project: 'CLV', id: from },
    to: { project: 'CLV', id: to },
  }));
  return {
    type: 'plan',
    project: 'CLV',
    id: 'CLV-TEST',
    status: 'gate-approved',
    owner: { kind: 'agent', id: 'plan' },
    parent_rfc: { project: 'CLV', id: 'CLV-0' },
    task_dag: { nodes, edges: mappedEdges },
    tasks: [],
  };
}

function walkState(tasks: Record<string, WalkState['tasks'][string]>): WalkState {
  return {
    plan_id: 'CLV-TEST',
    started: '2026-04-24T00:00:00Z',
    max_concurrent: 3,
    tasks,
  };
}

describe('computeReadyTasks', () => {
  it('returns all roots when nothing has run yet', () => {
    const p = plan([], ['CLV-17', 'CLV-18', 'CLV-19']);
    const ws = walkState({});
    expect(computeReadyTasks(p, ws, 3)).toEqual(['CLV-17', 'CLV-18', 'CLV-19']);
  });

  it('respects maxConcurrent slot accounting (subtracts currently running)', () => {
    const p = plan([], ['CLV-17', 'CLV-18', 'CLV-19']);
    const ws = walkState({
      'CLV-17': { state: 'running', session_id: 's1', started_at: 't', last_seq: 0 },
    } as unknown as WalkState['tasks']);
    expect(computeReadyTasks(p, ws, 3)).toEqual(['CLV-18', 'CLV-19']);
  });

  it('caps returned tasks to maxConcurrent - running slots', () => {
    const p = plan([], ['CLV-17', 'CLV-18', 'CLV-19', 'CLV-20']);
    const ws = walkState({});
    expect(computeReadyTasks(p, ws, 2)).toEqual(['CLV-17', 'CLV-18']);
  });

  it('does not return a task whose ancestor is not merged', () => {
    const p = plan([['CLV-17', 'CLV-20']], ['CLV-17', 'CLV-20']);
    const ws = walkState({
      'CLV-17': { state: 'running', session_id: 's1', started_at: 't', last_seq: 0 },
    } as unknown as WalkState['tasks']);
    expect(computeReadyTasks(p, ws, 3)).toEqual([]);
  });

  it('returns a descendant once its ancestor is merged', () => {
    const p = plan([['CLV-17', 'CLV-20']], ['CLV-17', 'CLV-20']);
    const ws = walkState({
      'CLV-17': { state: 'merged', session_id: 's1', merged_at: 't', merge_commit: 'abc' },
    } as unknown as WalkState['tasks']);
    expect(computeReadyTasks(p, ws, 3)).toEqual(['CLV-20']);
  });

  it('does NOT return a descendant of an escalated ancestor (unreachable)', () => {
    const p = plan([['CLV-17', 'CLV-20']], ['CLV-17', 'CLV-20']);
    const ws = walkState({
      'CLV-17': { state: 'escalated', session_id: 's1', escalated_at: 't', reason: 'qa' },
    } as unknown as WalkState['tasks']);
    expect(computeReadyTasks(p, ws, 3)).toEqual([]);
  });

  it('fan-in join: returns join task only when ALL ancestors are merged', () => {
    const p = plan(
      [
        ['CLV-17', 'CLV-20'],
        ['CLV-18', 'CLV-20'],
        ['CLV-19', 'CLV-20'],
      ],
      ['CLV-17', 'CLV-18', 'CLV-19', 'CLV-20'],
    );
    const allMergedExceptJoin = walkState({
      'CLV-17': { state: 'merged', session_id: 's1', merged_at: 't', merge_commit: 'a' },
      'CLV-18': { state: 'merged', session_id: 's2', merged_at: 't', merge_commit: 'b' },
      'CLV-19': { state: 'merged', session_id: 's3', merged_at: 't', merge_commit: 'c' },
    } as unknown as WalkState['tasks']);
    expect(computeReadyTasks(p, allMergedExceptJoin, 3)).toEqual(['CLV-20']);

    const oneStillRunning = walkState({
      'CLV-17': { state: 'merged', session_id: 's1', merged_at: 't', merge_commit: 'a' },
      'CLV-18': { state: 'merged', session_id: 's2', merged_at: 't', merge_commit: 'b' },
      'CLV-19': { state: 'running', session_id: 's3', started_at: 't', last_seq: 0 },
    } as unknown as WalkState['tasks']);
    expect(computeReadyTasks(p, oneStillRunning, 3)).toEqual([]);
  });

  it('returns nothing when every task is already merged', () => {
    const p = plan([], ['CLV-17', 'CLV-18']);
    const ws = walkState({
      'CLV-17': { state: 'merged', session_id: 's1', merged_at: 't', merge_commit: 'a' },
      'CLV-18': { state: 'merged', session_id: 's2', merged_at: 't', merge_commit: 'b' },
    } as unknown as WalkState['tasks']);
    expect(computeReadyTasks(p, ws, 3)).toEqual([]);
  });

  it('returns deterministic task-id order (lexicographic)', () => {
    const p = plan([], ['CLV-19', 'CLV-17', 'CLV-18']);
    const ws = walkState({});
    expect(computeReadyTasks(p, ws, 3)).toEqual(['CLV-17', 'CLV-18', 'CLV-19']);
  });
});
