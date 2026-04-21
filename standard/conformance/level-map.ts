// Single source of truth for Cloverleaf conformance levels.
// Every schema, validator, agent contract, state machine, and scenario
// belongs to exactly one level. Levels are strict supersets: L2 includes L1,
// L3 includes L2.

export type Level = 'L1' | 'L2' | 'L3';

export const LEVELS: readonly Level[] = ['L1', 'L2', 'L3'] as const;

// Union of a specific level or the sentinel 'all' (used for --level= CLI arg).
export type LevelArg = Level | 'all';

// Type guard: narrows LevelArg to Level by excluding 'all'.
export function isSpecificLevel(arg: LevelArg): arg is Level {
  return arg !== 'all';
}

// Schema name → level. Names match `examples/valid/<name>/` and `<name>.schema.json`.
export const SCHEMA_LEVEL: Readonly<Record<string, Level>> = {
  // L1 — Producer
  project: 'L1',
  'work-item': 'L1',
  rfc: 'L1',
  spike: 'L1',
  plan: 'L1',
  task: 'L1',
  // L2 — Exchange
  feedback: 'L2',
  problem: 'L2',
  'status-transition-event': 'L2',
  'status-transitions': 'L2',
  'dependency-dag': 'L2',
  // L3 — Host
  'gate-decision-event': 'L3',
  extensions: 'L3',
  'path-rules': 'L3',
  'risk-classifier-rules': 'L3',
};

// Validator name (function name sans "validate" prefix, kebab-case) → level.
export const VALIDATOR_LEVEL: Readonly<Record<string, Level>> = {
  // L1
  'id-pattern': 'L1',
  // L2
  'cross-project-ref': 'L2',
  'dag-acyclic': 'L2',
  'plan-tasks-match-dag': 'L2',
  'relationship-mirror': 'L2',
  'status-by-type': 'L2',
  'status-transition-legality': 'L2',
  // L3
  'gate-decision-validity': 'L3',
};

// Agent contract file name (sans `.openapi.yaml`) → level.
// All 7 agents are L3 (full methodology orchestration).
export const CONTRACT_LEVEL: Readonly<Record<string, Level>> = {
  researcher: 'L3',
  plan: 'L3',
  implementer: 'L3',
  documenter: 'L3',
  reviewer: 'L3',
  'ui-reviewer': 'L3',
  qa: 'L3',
};

// State machine file name (sans `.json`) → level.
// State machines formalize the Exchange tier; all 4 are L2.
export const STATE_MACHINE_LEVEL: Readonly<Record<string, Level>> = {
  rfc: 'L2',
  spike: 'L2',
  plan: 'L2',
  task: 'L2',
};

// Scenario directory name → set of levels the scenario exercises.
// A scenario may span levels; when running at --level=N the runner only
// validates files from that scenario whose schema belongs to level ≤ N.
export const SCENARIO_LEVELS: Readonly<Record<string, readonly Level[]>> = {
  'oauth-rollout': ['L1', 'L2', 'L3'],
};

// Ordered comparison: L1 < L2 < L3.
export function includesLevel(included: Level, target: Level): boolean {
  const order: Record<Level, number> = { L1: 1, L2: 2, L3: 3 };
  return order[included] <= order[target];
}

// Parse --level=<value> argv value. Accepts "1", "2", "3", "all".
export function parseLevelArg(value: string): Level | 'all' | null {
  if (value === 'all') return 'all';
  if (value === '1') return 'L1';
  if (value === '2') return 'L2';
  if (value === '3') return 'L3';
  return null;
}
