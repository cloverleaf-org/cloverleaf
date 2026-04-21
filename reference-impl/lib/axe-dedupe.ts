import type { Finding, FindingSeverity } from './feedback.js';

export type AxeImpact = 'critical' | 'serious' | 'moderate' | 'minor';

export interface RawAxeFinding {
  viewport: string;
  ruleId: string;
  target: string;
  impact: AxeImpact;
  message: string;
  helpUrl?: string;
}

export type DedupeKey = 'ruleId' | 'target';

const SEVERITY_MAP: Record<AxeImpact, FindingSeverity> = {
  critical: 'blocker',
  serious:  'error',
  moderate: 'warning',
  minor:    'info',
};

function dedupeKeyOf(raw: RawAxeFinding, keys: DedupeKey[]): string {
  return keys.map((k) => raw[k]).join('||');
}

export function dedupeAxeFindings(raws: RawAxeFinding[], keys: DedupeKey[]): Finding[] {
  const groups = new Map<string, { first: RawAxeFinding; viewports: string[] }>();
  for (const raw of raws) {
    const key = dedupeKeyOf(raw, keys);
    const existing = groups.get(key);
    if (existing) {
      if (!existing.viewports.includes(raw.viewport)) existing.viewports.push(raw.viewport);
    } else {
      groups.set(key, { first: raw, viewports: [raw.viewport] });
    }
  }
  const out: Finding[] = [];
  for (const { first, viewports } of groups.values()) {
    out.push({
      severity: SEVERITY_MAP[first.impact],
      message: first.message,
      rule: first.ruleId,
      metadata: {
        target: first.target,
        impact: first.impact,
        viewports,
        ...(first.helpUrl ? { helpUrl: first.helpUrl } : {}),
      },
    });
  }
  return out;
}
