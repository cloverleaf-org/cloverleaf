import { execFileSync } from 'node:child_process';
import { loadCouncilConfigWithSource, type CouncilConfig, type GateBinding, type WhenPredicate } from './council-config.js';
import type { ThresholdRule, CouncilVerdict } from './aggregation.js';
import { loadTask, saveTask, advanceStatus } from './task.js';
import { writeCouncilResult, type CouncilResult } from './council-result.js';
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
  source: 'consumer' | 'default';
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
    const out = execFileSync('git', ['-C', repoRoot, 'diff', '--name-only', `main..cloverleaf/${taskId}`], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
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
  const { config, source } = loadCouncilConfigWithSource(repoRoot);
  const task = loadTask(repoRoot, taskId) as unknown as Record<string, unknown>;

  const { profile: profileName, mode } = resolveBinding(config.gates[gateKey], task);
  const empty: CouncilPlan = {
    gate: gateKey, profile: null, mode, rounds: [],
    aggregation: 'any-veto', on_round_bounce: 'stop', source,
  };
  if (profileName === null) return empty;

  const profile = config.profiles[profileName];
  if (!profile) {
    if (source === 'consumer') {
      process.stderr.write(
        `cloverleaf-cli council-plan: profile '${profileName}' bound to gate '${gateKey}' not found in council.json; falling back to today's behavior.\n`,
      );
    }
    return empty; // unknown profile → fail toward today's behavior
  }

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
    source,
  };
}

/**
 * Drive the FSM transition implied by a council verdict (the runner's terminal step).
 * Council-authoritative: on a pass it records the council's gating verdict so the
 * v0.8.1 security precondition is satisfied for any high-security gated transition;
 * the per-member basis (incl. an omitted or out-voted `security` member) is written
 * to the result artifact. Walks the minimal legal path to the lane's pre-merge state.
 */
export function applyCouncilVerdict(
  repoRoot: string,
  taskId: string,
  gate: string,
  council: CouncilVerdict,
): CouncilResult {
  if (gate !== 'task.review') {
    throw new Error(
      `apply-council-verdict: gate '${gate}' is not supported yet — the FSM walk is hardcoded for the ` +
      `task.review → merge lane. Binding other gates needs a gate-aware walk (council Slice 3).`,
    );
  }
  const task = loadTask(repoRoot, taskId);
  if (task.status !== 'review') {
    throw new Error(`apply-council-verdict: task ${taskId} is '${task.status}', expected 'review'`);
  }
  const lane: 'fast' | 'full' = task.risk_class === 'high' ? 'full' : 'fast';
  const securityMember = council.members.find((m) => m.member === 'security');
  const walk: string[] = ['review'];

  if (council.verdict === 'escalate') {
    advanceStatus(repoRoot, taskId, 'escalated', 'agent');
    walk.push('escalated');
  } else if (council.verdict === 'bounce') {
    advanceStatus(repoRoot, taskId, 'implementing', 'agent');
    walk.push('implementing');
  } else {
    // pass — minimal legal walk; review→automated-gates resets the security verdict,
    // so set the council's gating verdict AFTER that transition.
    advanceStatus(repoRoot, taskId, 'automated-gates', 'agent');
    walk.push('automated-gates');
    const atGates = loadTask(repoRoot, taskId);
    atGates.security_review_verdict = 'pass';
    saveTask(repoRoot, atGates);
    if (lane === 'full') {
      advanceStatus(repoRoot, taskId, 'qa', 'agent', { path: 'full_pipeline' });
      walk.push('qa');
      advanceStatus(repoRoot, taskId, 'final-gate', 'agent', { path: 'full_pipeline' });
      walk.push('final-gate');
    }
  }

  const qaTraversedAdministratively =
    lane === 'full' && walk.includes('qa') && !council.members.some((m) => m.member === 'qa');

  const result: CouncilResult = {
    gate,
    final_verdict: council.verdict,
    rule: council.rule,
    rationale: council.rationale,
    members: council.members.map((m) => ({
      member: m.member,
      verdict: m.verdict,
      blocking: m.blocking !== false,
      weight: m.weight ?? 1,
    })),
    walk,
    ...(qaTraversedAdministratively
      ? { walk_note: 'qa state traversed administratively; no qa member ran' }
      : {}),
    security: {
      member_verdict: securityMember ? securityMember.verdict : 'absent',
      gating_verdict_set: council.verdict === 'pass' ? 'pass' : null,
      basis: !securityMember
        ? 'no security member configured; advanced under council authority'
        : securityMember.verdict === 'pass'
          ? 'security member passed'
          : `security member returned '${securityMember.verdict}'; council ${council.verdict} by rule ${JSON.stringify(council.rule)}`,
    },
  };
  writeCouncilResult(repoRoot, taskId, result);
  return result;
}
