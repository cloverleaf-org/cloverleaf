import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ThresholdRule } from './aggregation.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG = join(here, '..', 'config', 'council.json');

export type WhenPredicate = 'always' | 'security_class:high' | 'ui_changes';

export interface CouncilMember {
  member: string; // built-in id ('reviewer' | 'security' | 'ui' | 'qa') or a custom role id
  prompt?: string; // custom-role prompt filename, resolved under .cloverleaf/prompts/
  when?: WhenPredicate; // default 'always'
  blocking?: boolean; // default true
  weight?: number; // default 1
}

export interface CouncilProfile {
  rounds: CouncilMember[][];
  aggregation: ThresholdRule | 'chair';
  chair?: { prompt?: string }; // only when aggregation === 'chair'; omit prompt → built-in chair.md
  on_round_bounce?: 'stop' | 'continue'; // default 'stop'
}

export type GateBinding =
  | string
  | { profile: string; mode?: 'decisive' | 'advisory' }
  | { by: string; map: Record<string, string | null> };

export interface CouncilConfig {
  profiles: Record<string, CouncilProfile>;
  gates: Record<string, GateBinding>;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

// Full-replacement (not merge): a consumer council.json wholly replaces the
// shipped default — matching the qa-rules / security-paths loaders. A partial
// consumer file (e.g. only `profiles`) intentionally yields empty `gates`,
// i.e. no bound gates → today's behavior. Per-profile shape validation is a
// later (validator) slice; this loader normalizes only the top-level containers.
function normalize(doc: Record<string, unknown>): CouncilConfig {
  return {
    profiles: isObject(doc.profiles) ? (doc.profiles as Record<string, CouncilProfile>) : {},
    gates: isObject(doc.gates) ? (doc.gates as Record<string, GateBinding>) : {},
  };
}

function loadDefaultConfig(): CouncilConfig {
  if (!existsSync(DEFAULT_CONFIG)) {
    throw new Error(`council config not found at ${DEFAULT_CONFIG}`);
  }
  const parsed: unknown = JSON.parse(readFileSync(DEFAULT_CONFIG, 'utf-8'));
  if (!isObject(parsed)) {
    throw new Error(`council config malformed (not an object) at ${DEFAULT_CONFIG}`);
  }
  return normalize(parsed);
}

export function loadCouncilConfigWithSource(
  repoRoot: string,
): { config: CouncilConfig; source: 'consumer' | 'default' } {
  const consumerPath = join(repoRoot, '.cloverleaf', 'config', 'council.json');
  if (existsSync(consumerPath)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(consumerPath, 'utf-8'));
      if (!isObject(parsed)) throw new Error('council.json is not an object');
      return { config: normalize(parsed), source: 'consumer' };
    } catch {
      // malformed / non-object consumer config → fall back to package default
    }
  }
  return { config: loadDefaultConfig(), source: 'default' };
}

export function loadCouncilConfig(repoRoot: string): CouncilConfig {
  return loadCouncilConfigWithSource(repoRoot).config;
}
