import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ThresholdRule } from './aggregation.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG = join(here, '..', 'config', 'council.json');

export type WhenPredicate = 'always' | 'security_class:high' | 'ui_changes';

export interface CouncilMember {
  member: string; // built-in id: 'reviewer' | 'security' | 'ui' | 'qa'
  when?: WhenPredicate; // default 'always'
  blocking?: boolean; // default true
  weight?: number; // default 1
}

export interface CouncilProfile {
  rounds: CouncilMember[][];
  aggregation: ThresholdRule;
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

function normalize(doc: Partial<CouncilConfig>): CouncilConfig {
  return {
    profiles: isObject(doc.profiles) ? (doc.profiles as Record<string, CouncilProfile>) : {},
    gates: isObject(doc.gates) ? (doc.gates as Record<string, GateBinding>) : {},
  };
}

function loadDefaultConfig(): CouncilConfig {
  if (!existsSync(DEFAULT_CONFIG)) {
    throw new Error(`council config not found at ${DEFAULT_CONFIG}`);
  }
  return normalize(JSON.parse(readFileSync(DEFAULT_CONFIG, 'utf-8')) as Partial<CouncilConfig>);
}

export function loadCouncilConfig(repoRoot: string): CouncilConfig {
  const consumerPath = join(repoRoot, '.cloverleaf', 'config', 'council.json');
  if (existsSync(consumerPath)) {
    try {
      return normalize(JSON.parse(readFileSync(consumerPath, 'utf-8')) as Partial<CouncilConfig>);
    } catch {
      // fall through to package default
    }
  }
  return loadDefaultConfig();
}
