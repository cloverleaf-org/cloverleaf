import { execFileSync } from 'node:child_process';
import { loadCouncilConfig, type CouncilConfig, type GateBinding, type WhenPredicate } from './council-config.js';
import type { ThresholdRule } from './aggregation.js';
import { loadTask } from './task.js';
import { classifyTaskSecurity } from './security-classify.js';
import { loadAffectedRoutesConfig, computeAffectedRoutes } from './affected-routes.js';

export interface ResolvedMember {
  member: string;
  blocking: boolean;
  weight: number;
}

export interface CouncilPlan {
  gate: string;
  profile: string | null; // null → no council bound (today's behavior)
  mode: 'decisive' | 'advisory';
  rounds: ResolvedMember[][];
  aggregation: ThresholdRule;
  on_round_bounce: 'stop' | 'continue';
}

interface WhenContext {
  securityHigh: boolean;
  uiChanges: boolean;
}

export function evaluateWhen(predicate: WhenPredicate | undefined, ctx: WhenContext): boolean {
  switch (predicate) {
    case undefined:
    case 'always':
      return true;
    case 'security_class:high':
      return ctx.securityHigh;
    case 'ui_changes':
      return ctx.uiChanges;
    default:
      return false; // unknown predicate → inactive (fail-closed)
  }
}

export function resolveBinding(
  binding: GateBinding | undefined,
  task: Record<string, unknown>,
): { profile: string | null; mode: 'decisive' | 'advisory' } {
  if (binding === undefined) return { profile: null, mode: 'decisive' };
  if (typeof binding === 'string') return { profile: binding, mode: 'decisive' };
  if ('profile' in binding) return { profile: binding.profile, mode: binding.mode ?? 'decisive' };
  // conditional selector { by, map }
  const key = String(task[binding.by] ?? '');
  const selected = key in binding.map ? binding.map[key] : (binding.map['*'] ?? null);
  return { profile: selected, mode: 'decisive' };
}

/**
 * Resolve changed files for predicate evaluation. Callers should pass
 * `opts.changedFiles` (e.g. from a prior `git diff`); when omitted we run
 * `git diff main..cloverleaf/<taskId>` and fall back to [] on any git error.
 * Exported for direct testing of the (now orchestrator-live) git path.
 */
export function resolveChangedFiles(repoRoot: string, taskId: string, opts: { changedFiles?: string[] } = {}): string[] {
  if (opts.changedFiles !== undefined) return opts.changedFiles;
  try {
    const out = execFileSync('git', ['-C', repoRoot, 'diff', '--name-only', `main..cloverleaf/${taskId}`], { encoding: 'utf-8' });
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

export function resolveCouncilPlan(
  repoRoot: string,
  taskId: string,
  gateKey = 'task.review',
  opts: { changedFiles?: string[] } = {},
): CouncilPlan {
  const config: CouncilConfig = loadCouncilConfig(repoRoot);
  const task = loadTask(repoRoot, taskId) as unknown as Record<string, unknown>;

  const { profile: profileName, mode } = resolveBinding(config.gates[gateKey], task);
  const empty: CouncilPlan = {
    gate: gateKey,
    profile: null,
    mode,
    rounds: [],
    aggregation: 'any-veto',
    on_round_bounce: 'stop',
  };
  if (profileName === null) return empty;

  const profile = config.profiles[profileName];
  if (!profile) return empty; // unknown profile → fail toward today's behavior

  const changed = resolveChangedFiles(repoRoot, taskId, opts);
  const securityHigh = classifyTaskSecurity(repoRoot, taskId, { changedFiles: changed }).effective === 'high';
  const affected = computeAffectedRoutes(changed, loadAffectedRoutesConfig(repoRoot));
  const uiChanges = affected === 'all' || affected.length > 0;
  const ctx: WhenContext = { securityHigh, uiChanges };

  const rounds: ResolvedMember[][] = [];
  for (const round of profile.rounds) {
    const active = round
      .filter((member) => evaluateWhen(member.when, ctx))
      .map((member) => ({ member: member.member, blocking: member.blocking !== false, weight: member.weight ?? 1 }));
    if (active.length > 0) rounds.push(active);
  }

  return {
    gate: gateKey,
    profile: profileName,
    mode,
    rounds,
    aggregation: profile.aggregation,
    on_round_bounce: profile.on_round_bounce ?? 'stop',
  };
}
