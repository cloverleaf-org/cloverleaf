import type { ValidationResult, Violation } from './types.js';

type Kind = 'code' | 'rfc' | 'plan';
interface Member { member: string; kind?: Kind; when?: string; blocking?: boolean; weight?: number; prompt?: string }
interface Profile { rounds: Member[][]; aggregation: unknown; chair?: unknown; on_round_bounce?: string }
interface CouncilConfig { profiles: Record<string, Profile>; gates: Record<string, unknown> }

const KINDS: ReadonlySet<string> = new Set(['code', 'rfc', 'plan']);
const WHENS: ReadonlySet<string> = new Set(['always', 'security_class:high', 'ui_changes']);
const RULES: ReadonlySet<string> = new Set(['any-veto', 'unanimous', 'majority', 'weighted', 'chair']);

function memberKind(m: Member): Kind {
  return m.kind ?? 'code';
}

function aggregationOk(agg: unknown): boolean {
  if (typeof agg === 'string') return RULES.has(agg);
  if (agg && typeof agg === 'object' && 'quorum' in agg) {
    const q = (agg as { quorum: unknown }).quorum;
    return typeof q === 'number' && Number.isInteger(q) && q >= 1;
  }
  return false;
}

function profileKind(profile: Profile): Kind | null {
  const kinds = new Set(profile.rounds.flat().map(memberKind));
  if (kinds.size > 1) return null; // heterogeneous
  return (kinds.values().next().value as Kind) ?? 'code';
}

/**
 * Validate a council configuration: per-profile kind-homogeneity, gate-kind ↔
 * profile-kind agreement, and closed aggregation/when enums. `gateDescriptors`
 * supplies each gate key's kind (default 'code'); an unbound/unknown gate key is
 * ignored here (structural validity is the schema's job).
 */
export function validateCouncilConfig(
  config: CouncilConfig,
  gateDescriptors: Record<string, { kind?: Kind }>,
): ValidationResult {
  const violations: Violation[] = [];
  const v = (message: string) => violations.push({ rule: 'council-config', message, severity: 'error' });

  const profileKinds: Record<string, Kind | 'mixed'> = {};
  for (const [name, profile] of Object.entries(config.profiles ?? {})) {
    const k = profileKind(profile);
    if (k === null) {
      v(`profile '${name}' mixes member kinds; a profile must be kind-homogeneous`);
      profileKinds[name] = 'mixed';
    } else {
      profileKinds[name] = k;
    }
    for (const m of profile.rounds.flat()) {
      if (m.kind !== undefined && !KINDS.has(m.kind)) v(`profile '${name}' member '${m.member}' has unknown kind '${m.kind}'`);
      if (m.when !== undefined && !WHENS.has(m.when)) v(`profile '${name}' member '${m.member}' has unknown when '${m.when}'`);
    }
    if (!aggregationOk(profile.aggregation)) v(`profile '${name}' has unknown aggregation ${JSON.stringify(profile.aggregation)}`);
  }

  for (const [gateKey, binding] of Object.entries(config.gates ?? {})) {
    const gateKind: Kind = gateDescriptors[gateKey]?.kind ?? 'code';
    const profileNames = bindingProfiles(binding);
    for (const pn of profileNames) {
      if (pn === null) continue; // explicit "no council" (null in a {by,map})
      const pk = profileKinds[pn];
      if (pk === undefined) continue; // unknown profile → schema/loader concern, not kind
      if (pk === 'mixed') continue; // already reported
      if (pk !== gateKind) v(`gate '${gateKey}' (kind '${gateKind}') is bound to profile '${pn}' of kind '${pk}'`);
    }
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

function bindingProfiles(binding: unknown): Array<string | null> {
  if (typeof binding === 'string') return [binding];
  if (binding && typeof binding === 'object') {
    if ('profile' in binding) return [(binding as { profile: string }).profile];
    if ('map' in binding) return Object.values((binding as { map: Record<string, string | null> }).map);
  }
  return [];
}
