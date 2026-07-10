import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { councilRunDir } from './paths.js';
import type { Verdict } from './feedback.js';
import type { ThresholdRule } from './aggregation.js';

export interface CouncilResultMember {
  member: string;
  verdict: Verdict;
  blocking: boolean;
  weight: number;
}

export interface CouncilResult {
  gate: string;
  final_verdict: Verdict;
  rule: ThresholdRule | 'chair';
  rationale: string;
  members: CouncilResultMember[];
  walk: string[]; // states walked, e.g. ["review","automated-gates","qa","final-gate"]
  walk_note?: string; // set when a state was traversed administratively (e.g. qa with no qa member)
  security: {
    member_verdict: Verdict | 'absent';
    gating_verdict_set: 'pass' | null; // security_review_verdict the council set, if any
    basis: string; // human-readable explanation of the security decision
  };
}

export function councilResultPath(repoRoot: string, taskId: string, gate: string): string {
  return join(councilRunDir(repoRoot, taskId), `${gate}.json`);
}

export function writeCouncilResult(repoRoot: string, taskId: string, result: CouncilResult): string {
  const dir = councilRunDir(repoRoot, taskId);
  mkdirSync(dir, { recursive: true });
  const path = councilResultPath(repoRoot, taskId, result.gate);
  writeFileSync(path, JSON.stringify(result, null, 2) + '\n');
  return path;
}

export function readCouncilResult(repoRoot: string, taskId: string, gate: string): CouncilResult | null {
  const path = councilResultPath(repoRoot, taskId, gate);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8')) as CouncilResult;
}
