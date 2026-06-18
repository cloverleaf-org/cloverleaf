import type { Verdict } from './feedback.js';

export type ThresholdRule =
  | 'any-veto'
  | 'unanimous'
  | 'majority'
  | 'weighted'
  | { quorum: number };

export interface MemberVerdict {
  member: string;
  verdict: Verdict; // 'pass' | 'bounce' | 'escalate'
  blocking?: boolean; // default true; advisory members (false) don't gate
  weight?: number; // default 1; only used by 'weighted'
}

export interface CouncilVerdict {
  verdict: Verdict;
  rule: ThresholdRule;
  rationale: string;
  members: MemberVerdict[];
}

export function aggregate(
  members: MemberVerdict[],
  rule: ThresholdRule,
  opts: { weightedThreshold?: number } = {},
): CouncilVerdict {
  // Safety invariant: any member that escalates short-circuits, regardless of
  // blocking flag or rule — a hard blocker cannot be out-voted.
  const escalators = members.filter((x) => x.verdict === 'escalate');
  if (escalators.length > 0) {
    return {
      verdict: 'escalate',
      rule,
      members,
      rationale: `escalated by ${escalators.map((x) => x.member).join(', ')}`,
    };
  }

  // Only blocking members gate the pass/bounce decision.
  const blocking = members.filter((x) => x.blocking !== false);
  if (blocking.length === 0) {
    return { verdict: 'pass', rule, members, rationale: 'no blocking members' };
  }

  const passes = blocking.filter((x) => x.verdict === 'pass');
  const passCount = passes.length;
  const total = blocking.length;

  let pass: boolean;
  let detail: string;

  if (rule === 'any-veto') {
    pass = passCount === total;
    detail = `any-veto: ${passCount}/${total} passed`;
  } else if (rule === 'unanimous') {
    // Currently identical to any-veto over blocking members. Kept as a distinct
    // named rule for clarity and possible future divergence; do not merge.
    pass = passCount === total;
    detail = `unanimous: ${passCount}/${total} passed`;
  } else if (rule === 'majority') {
    pass = passCount * 2 > total; // strict majority; ties → bounce
    detail = `majority: ${passCount}/${total} passed`;
  } else if (rule === 'weighted') {
    const totalWeight = blocking.reduce((s, x) => s + (x.weight ?? 1), 0);
    const passWeight = passes.reduce((s, x) => s + (x.weight ?? 1), 0);
    const threshold = opts.weightedThreshold;
    pass = threshold !== undefined ? passWeight >= threshold : passWeight * 2 > totalWeight;
    detail =
      `weighted: passWeight ${passWeight}/${totalWeight}` +
      (threshold !== undefined ? ` (threshold ${threshold})` : '');
  } else {
    const k = rule.quorum;
    pass = passCount >= k;
    detail = `quorum(${k}): ${passCount}/${total} passed`;
  }

  return {
    verdict: pass ? 'pass' : 'bounce',
    rule,
    members,
    rationale: `${pass ? 'pass' : 'bounce'} — ${detail}`,
  };
}
