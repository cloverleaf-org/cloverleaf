import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadCouncilConfigWithSource, type CouncilConfig, type GateBinding, type WhenPredicate, type CouncilMember } from './council-config.js';
import type { ThresholdRule, CouncilVerdict } from './aggregation.js';
import { loadTask, saveTask, advanceStatus } from './task.js';
import { loadPlan } from './plan.js';
import { loadRfc } from './rfc.js';
import { writeCouncilResult, type CouncilResult } from './council-result.js';
import { resolveChairPrompt } from './chair.js';
import { classifyTaskSecurity } from './security-classify.js';
import { writeFeedback } from './feedback.js';
import { loadAffectedRoutesConfig, computeAffectedRoutes } from './affected-routes.js';
import { loadQaRulesDocument } from './qa-rules.js';
import { loadUiReviewConfig } from './ui-review-config.js';
import { getPluginRoot } from './plugin-path.js';

export interface ResolvedMember {
  member: string;
  blocking: boolean;
  weight: number;
  promptPath: string;
  /**
   * Tokens this member's prompt declares beyond the five the runner always supplies
   * (task, branch, base_branch, repo_root, diff), resolved here rather than described
   * in skill prose. Values are the literal strings to substitute. Empty for members
   * whose prompt needs nothing extra, and for any token planning cannot resolve
   * without side effects (see MEMBER_TOKENS).
   */
  substitutions: Record<string, string>;
}

export interface CouncilPlan {
  gate: string;
  profile: string | null; // null → no council bound (today's behavior)
  mode: 'decisive' | 'advisory';
  rounds: ResolvedMember[][];
  aggregation: ThresholdRule | 'chair';
  chair?: { promptPath: string }; // resolved iff aggregation === 'chair'
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

const BUILTIN_PROMPTS: Record<string, string> = {
  reviewer: 'reviewer.md',
  security: 'security-reviewer.md',
  ui: 'ui-reviewer.md',
  qa: 'qa.md',
};

interface GateDescriptor {
  state: string; // the work-item status a gate's council runs at
  advisoryOnly: boolean; // true when the gate's only legal transitions are human-driven
  kind?: 'code' | 'rfc' | 'plan'; // artifact kind the gate reviews; default 'code'
}

/**
 * Council gate → FSM binding. `task.review` is the collapsed delivery council
 * (decisive); `task.plan_review` is decisive-capable (agent bounce to pending);
 * `task.final_gate` and the two discovery gates are advisory (post-only, human
 * drives the transition). Advisory-only gates route to postAdvisoryVerdict.
 */
export const GATE_DESCRIPTORS: Record<string, GateDescriptor> = {
  'task.review': { state: 'council', advisoryOnly: false },
  'task.plan_review': { state: 'tactical-plan', advisoryOnly: false },
  'task.final_gate': { state: 'final-gate', advisoryOnly: true },
  'plan.task_batch': { state: 'task_batch_gate', advisoryOnly: true, kind: 'plan' },
  'rfc.strategy_gate': { state: 'rfc_strategy_gate', advisoryOnly: true, kind: 'rfc' },
};

// Load any work item's status/doc by the gate's "type." prefix (task | plan | rfc).
function workItemTypeOf(gate: string): 'task' | 'plan' | 'rfc' {
  const t = gate.split('.')[0];
  if (t === 'task' || t === 'plan' || t === 'rfc') return t;
  throw new Error(`council: gate '${gate}' has no task/plan/rfc type prefix`);
}
function loadWorkItemDoc(repoRoot: string, type: 'task' | 'plan' | 'rfc', id: string): Record<string, unknown> {
  if (type === 'plan') return loadPlan(repoRoot, id) as unknown as Record<string, unknown>;
  if (type === 'rfc') return loadRfc(repoRoot, id) as unknown as Record<string, unknown>;
  return loadTask(repoRoot, id) as unknown as Record<string, unknown>;
}

/**
 * Resolve a council member to the absolute path of its prompt. A member with a
 * `prompt` field is a custom role → <repoRoot>/.cloverleaf/prompts/<file> (exist-checked,
 * since it is user-authored and easily mistyped); a bare built-in id → the shipped prompt
 * under the plugin root, deliberately NOT exist-checked (built-ins ship with the plugin, so
 * a missing one is a broken install that surfaces at prompt read-time, not user error).
 */
export function resolveMemberPrompt(member: CouncilMember, repoRoot: string): string {
  if (member.prompt !== undefined) {
    const p = join(repoRoot, '.cloverleaf', 'prompts', member.prompt);
    if (!existsSync(p)) {
      throw new Error(`council: custom member '${member.member}' prompt not found at ${p}`);
    }
    return p;
  }
  const builtin = BUILTIN_PROMPTS[member.member];
  if (builtin === undefined) {
    throw new Error(`council: unknown member '${member.member}' (no built-in prompt and no 'prompt' field)`);
  }
  return join(getPluginRoot(), 'prompts', builtin);
}

/**
 * Extra tokens each built-in member's prompt declares, beyond the five the runner
 * always supplies. Kept adjacent to the resolver so a prompt gaining a token is a
 * one-line change in TS with a test behind it, rather than silent drift in skill prose.
 *
 * `preview_port` is listed because `ui-reviewer.md` genuinely declares it — but it is
 * deliberately not resolved (see `resolveSubstitutions`). This map is the prompts'
 * contract; the resolver is the subset planning can answer honestly.
 */
const MEMBER_TOKENS: Record<string, readonly string[]> = {
  reviewer: ['test_rules'],
  security: [],
  qa: ['qa_rules'],
  ui: ['affected_routes', 'preview_port', 'ui_review_config'],
};

interface SubstitutionContext {
  /**
   * Routes this work item's diff affects, in the same `string[] | 'all'` encoding
   * `cloverleaf-cli affected-routes` prints. Undefined for the discovery gates
   * (plan/rfc), where no code diff is in scope.
   */
  affectedRoutes?: string[] | 'all';
}

/**
 * Resolve a member's extra prompt tokens. Side-effect free by contract: it reads
 * config and reuses values the plan already computed, and never allocates, writes,
 * or starts anything — `council-plan` is a query, and callers re-run it freely.
 *
 * A token that cannot be answered honestly at planning time is **omitted** rather
 * than filled with a placeholder. An absent key leaves a visible `{{token}}` for
 * whoever dispatches the member; a fabricated value is silently wrong, which is the
 * exact failure mode this map exists to prevent.
 */
function resolveSubstitutions(
  memberId: string,
  repoRoot: string,
  ctx: SubstitutionContext,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const token of MEMBER_TOKENS[memberId] ?? []) {
    switch (token) {
      // Both carry the qa-rules *document* (`{ rules: [...] }`) — the shape
      // reviewer.md and qa.md document — not loadQaRulesConfig()'s bare array.
      case 'test_rules':
      case 'qa_rules':
        out[token] = JSON.stringify(loadQaRulesDocument(repoRoot));
        break;
      case 'ui_review_config':
        out[token] = JSON.stringify(loadUiReviewConfig(repoRoot));
        break;
      case 'affected_routes':
        // Diff-dependent, so available only on a code gate; the plan already
        // computed it to evaluate the `ui_changes` predicate.
        if (ctx.affectedRoutes !== undefined) out[token] = JSON.stringify(ctx.affectedRoutes);
        break;
      case 'preview_port':
        // Deliberately unresolved: there is no configured preview port and no
        // side-effect-free way to derive one — lib/ports.ts offers only
        // getFreePort(), which *allocates*. Whoever dispatches the ui member
        // allocates it there, as the standalone ui-review skill does.
        break;
    }
  }
  return out;
}

export function resolveCouncilPlan(
  repoRoot: string,
  workItemId: string,
  gateKey = 'task.review',
  opts: { changedFiles?: string[] } = {},
): CouncilPlan {
  const { config, source } = loadCouncilConfigWithSource(repoRoot);
  const type = workItemTypeOf(gateKey);
  const doc = loadWorkItemDoc(repoRoot, type, workItemId);

  const binding = resolveBinding(config.gates[gateKey], doc);
  const profileName = binding.profile;
  const mode: 'decisive' | 'advisory' =
    GATE_DESCRIPTORS[gateKey]?.advisoryOnly ? 'advisory' : binding.mode;
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

  // The when-context (security/ui) is a code-kind (task delivery) concern only.
  // `affectedRoutes` outlives the predicate: the ui member's {{affected_routes}}
  // token is the same value, so it is computed once and threaded to both.
  let ctx: WhenContext = { securityHigh: false, uiChanges: false };
  let affectedRoutes: string[] | 'all' | undefined;
  if (type === 'task') {
    const changed = resolveChangedFiles(repoRoot, workItemId, opts);
    const securityHigh = classifyTaskSecurity(repoRoot, workItemId, { changedFiles: changed }).effective === 'high';
    affectedRoutes = computeAffectedRoutes(changed, loadAffectedRoutesConfig(repoRoot));
    ctx = { securityHigh, uiChanges: affectedRoutes === 'all' || affectedRoutes.length > 0 };
  }

  const rounds: ResolvedMember[][] = [];
  for (const round of profile.rounds) {
    const active = round
      .filter((member) => evaluateWhen(member.when, ctx))
      .map((member) => ({
        member: member.member,
        blocking: member.blocking !== false,
        weight: member.weight ?? 1,
        promptPath: resolveMemberPrompt(member, repoRoot),
        substitutions: resolveSubstitutions(member.member, repoRoot, { affectedRoutes }),
      }));
    if (active.length > 0) rounds.push(active);
  }

  const plan: CouncilPlan = {
    gate: gateKey,
    profile: profileName,
    mode,
    rounds,
    aggregation: profile.aggregation,
    on_round_bounce: profile.on_round_bounce ?? 'stop',
    source,
  };
  if (profile.aggregation === 'chair') {
    plan.chair = { promptPath: resolveChairPrompt(profile.chair, repoRoot) };
  }
  return plan;
}

/**
 * Drive the FSM transition implied by a council verdict (the runner's terminal step).
 * Routes by gate: `task.review` → the collapsed decisive delivery council; the
 * decisive `task.plan_review` → the plan-review council; advisory-only gates
 * (task.final_gate and the two discovery gates) → postAdvisoryVerdict, which
 * records the verdict and drives no transition.
 */
export function applyCouncilVerdict(
  repoRoot: string,
  workItemId: string,
  gate: string,
  council: CouncilVerdict,
): CouncilResult {
  const desc = GATE_DESCRIPTORS[gate];
  if (!desc) {
    throw new Error(
      `apply-council-verdict: gate '${gate}' is not supported; supported gates: ${Object.keys(GATE_DESCRIPTORS).join(', ')}.`,
    );
  }
  if (desc.advisoryOnly) {
    return postAdvisoryVerdict(repoRoot, workItemId, gate, desc.state, council);
  }
  if (gate === 'task.plan_review') {
    return applyDecisivePlanReview(repoRoot, workItemId, gate, council);
  }
  return applyDeliveryCouncil(repoRoot, workItemId, gate, council); // task.review — collapsed council phase
}

/** Decisive delivery council (task.review at the collapsed `council` state). */
function applyDeliveryCouncil(repoRoot: string, taskId: string, gate: string, council: CouncilVerdict): CouncilResult {
  const task = loadTask(repoRoot, taskId);
  if (task.status !== 'council') {
    throw new Error(`apply-council-verdict: task ${taskId} is '${task.status}', expected 'council'`);
  }
  const securityMember = council.members.find((m) => m.member === 'security');
  const highSecurity = task.security_class === 'high';
  const walk: string[] = ['council'];

  if (council.verdict === 'escalate') {
    advanceStatus(repoRoot, taskId, 'escalated', 'agent');
    walk.push('escalated');
  } else if (council.verdict === 'bounce') {
    advanceStatus(repoRoot, taskId, 'implementing', 'agent');
    walk.push('implementing');
  } else {
    // pass → council → final-gate; record the council's authoritative security verdict for high tasks
    // (the v0.8.1 guarantee's backstop, now that the FSM no longer enforces it mechanically).
    advanceStatus(repoRoot, taskId, 'final-gate', 'agent');
    walk.push('final-gate');
    if (highSecurity) {
      const atGate = loadTask(repoRoot, taskId);
      atGate.security_review_verdict = 'pass';
      saveTask(repoRoot, atGate);
    }
  }

  const result: CouncilResult = {
    gate,
    final_verdict: council.verdict,
    rule: council.rule,
    rationale: council.rationale,
    members: council.members.map((m) => ({ member: m.member, verdict: m.verdict, blocking: m.blocking !== false, weight: m.weight ?? 1 })),
    walk,
    ...(council.forward !== undefined ? { forward: council.forward } : {}),
    security: {
      member_verdict: securityMember ? securityMember.verdict : 'absent',
      gating_verdict_set: council.verdict === 'pass' && highSecurity ? 'pass' : null,
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

/** Decisive plan-review council (task.plan_review at tactical-plan). */
function applyDecisivePlanReview(repoRoot: string, taskId: string, gate: string, council: CouncilVerdict): CouncilResult {
  const task = loadTask(repoRoot, taskId);
  if (task.status !== 'tactical-plan') {
    throw new Error(`apply-council-verdict: task ${taskId} is '${task.status}', expected 'tactical-plan' for gate '${gate}'`);
  }
  const walk: string[] = ['tactical-plan'];
  if (council.verdict === 'escalate') {
    advanceStatus(repoRoot, taskId, 'escalated', 'agent');
    walk.push('escalated');
  } else if (council.verdict === 'bounce') {
    advanceStatus(repoRoot, taskId, 'pending', 'agent', { gate: 'per_task_plan_review' });
    walk.push('pending');
  } else {
    advanceStatus(repoRoot, taskId, 'implementing', 'agent');
    walk.push('implementing');
  }
  const result: CouncilResult = {
    gate,
    final_verdict: council.verdict,
    rule: council.rule,
    rationale: council.rationale,
    members: council.members.map((m) => ({ member: m.member, verdict: m.verdict, blocking: m.blocking !== false, weight: m.weight ?? 1 })),
    walk,
    ...(council.forward !== undefined ? { forward: council.forward } : {}),
  };
  writeCouncilResult(repoRoot, taskId, result);
  return result;
}

/**
 * Advisory-gate terminal step: record the council verdict + post a feedback
 * envelope, and drive NO transition — the human owns every transition at an
 * advisory gate. The verdict (including an escalate) is recorded verbatim;
 * because nothing is transitioned, the un-lowerable-escalate invariant holds
 * trivially. Generalized over work-item kind: the gate's `type.` prefix selects
 * task | plan | rfc. Used for task.final_gate (final-gate) and the discovery
 * gates plan.task_batch (task_batch_gate) / rfc.strategy_gate (rfc_strategy_gate).
 */
export function postAdvisoryVerdict(
  repoRoot: string,
  workItemId: string,
  gate: string,
  expectedState: string,
  council: CouncilVerdict,
): CouncilResult {
  const type = workItemTypeOf(gate);
  const status = String(loadWorkItemDoc(repoRoot, type, workItemId).status ?? '');
  if (status !== expectedState) {
    throw new Error(
      `apply-council-verdict: ${type} ${workItemId} is '${status}', expected '${expectedState}' for advisory gate '${gate}'`,
    );
  }
  const m = workItemId.match(/^(.+)-(\d+)$/);
  if (!m) throw new Error(`apply-council-verdict: invalid work-item id '${workItemId}'`);
  const project = m[1];
  writeFeedback(repoRoot, {
    project,
    taskId: workItemId,
    prefix: 'c',
    envelope: { verdict: council.verdict, summary: council.rationale, findings: [] },
  });
  const result: CouncilResult = {
    gate,
    mode: 'advisory',
    final_verdict: council.verdict,
    rule: council.rule,
    rationale: council.rationale,
    members: council.members.map((mm) => ({
      member: mm.member,
      verdict: mm.verdict,
      blocking: mm.blocking !== false,
      weight: mm.weight ?? 1,
    })),
    walk: [expectedState],
    walk_note: 'advisory: verdict posted; human drives the transition',
    ...(council.forward !== undefined ? { forward: council.forward } : {}),
  };
  writeCouncilResult(repoRoot, workItemId, result);
  return result;
}
