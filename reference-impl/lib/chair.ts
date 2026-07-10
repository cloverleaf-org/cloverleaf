import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getPluginRoot } from './plugin-path.js';
import type { Verdict } from './feedback.js';
import type { MemberVerdict, CouncilVerdict } from './aggregation.js';

export interface ChairRawVerdict {
  verdict: Verdict;
  rationale: string;
  forward?: string[]; // member ids whose feedback to forward (bounce only)
}

export interface ChairMemberInput {
  member: string;
  verdict: Verdict;
  blocking?: boolean;
  weight?: number;
  envelope?: {
    summary?: string;
    findings?: Array<{ severity?: string; message?: string; location?: { file?: string; line?: number } }>;
  };
}

/**
 * Resolve the chair prompt to an absolute path. A profile `chair.prompt` points at
 * a custom prompt under <repoRoot>/.cloverleaf/prompts/ (exist-checked); omitted →
 * the shipped built-in prompts/chair.md.
 */
export function resolveChairPrompt(chair: { prompt?: string } | undefined, repoRoot: string): string {
  if (chair?.prompt !== undefined) {
    const p = join(repoRoot, '.cloverleaf', 'prompts', chair.prompt);
    if (!existsSync(p)) {
      throw new Error(`council: chair prompt not found at ${p}`);
    }
    return p;
  }
  return join(getPluginRoot(), 'prompts', 'chair.md');
}

/**
 * Render a readable deliberation packet from the member verdicts + their feedback
 * envelopes (supplied inline by the orchestrator) for the chair prompt's
 * {{member_verdicts}} placeholder. Pure — no disk read.
 */
export function buildChairContext(members: ChairMemberInput[]): string {
  return members
    .map((m) => {
      const tags = [m.blocking === false ? 'advisory' : 'blocking', `weight ${m.weight ?? 1}`].join(', ');
      const lines: string[] = [`### ${m.member} — ${m.verdict} (${tags})`];
      if (m.envelope?.summary) lines.push(m.envelope.summary);
      for (const f of m.envelope?.findings ?? []) {
        const loc = f.location?.file ? ` [${f.location.file}${f.location.line ? `:${f.location.line}` : ''}]` : '';
        lines.push(`- (${f.severity ?? 'info'}) ${f.message ?? ''}${loc}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

/**
 * Normalize the chair agent's raw output into a CouncilVerdict. Fail-closed on a
 * malformed shape. Re-asserts the escalate invariant: a member `escalate` forces the
 * council verdict to `escalate` regardless of the chair's output (the chair may raise
 * a bounce to escalate but can never lower an escalate).
 */
export function finalizeChairVerdict(raw: ChairRawVerdict, members: MemberVerdict[]): CouncilVerdict {
  const escalators = members.filter((m) => m.verdict === 'escalate');
  if (escalators.length > 0) {
    return {
      verdict: 'escalate',
      rule: 'chair',
      members,
      rationale: `escalated by ${escalators.map((m) => m.member).join(', ')} (chair cannot lower an escalate)`,
    };
  }
  if (raw === null || typeof raw !== 'object') {
    throw new Error('chair-verdict: chair output is not an object');
  }
  if (raw.verdict !== 'pass' && raw.verdict !== 'bounce' && raw.verdict !== 'escalate') {
    throw new Error(`chair-verdict: invalid verdict '${String(raw.verdict)}'`);
  }
  const ids = new Set(members.map((m) => m.member));
  const forward = (raw.forward ?? []).filter((f): f is string => typeof f === 'string');
  for (const f of forward) {
    if (!ids.has(f)) throw new Error(`chair-verdict: forward names unknown member '${f}'`);
  }
  return {
    verdict: raw.verdict,
    rule: 'chair',
    members,
    rationale: typeof raw.rationale === 'string' ? raw.rationale : '',
    ...(raw.verdict === 'bounce' ? { forward } : {}),
  };
}
