import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { feedbackDir } from './paths.js';
import { nextFeedbackIteration } from './ids.js';

export type Verdict = 'pass' | 'bounce' | 'escalate';
export type FindingSeverity = 'info' | 'warning' | 'error' | 'blocker';

export interface FindingLocation {
  file?: string;
  line?: number;
  work_item_id?: { project: string; id: string };
}

export interface Finding {
  severity: FindingSeverity;
  message: string;
  location?: FindingLocation;
  suggestion?: string;
  rule?: string;
}

export interface FeedbackEnvelope {
  verdict: Verdict;
  summary?: string;
  findings?: Finding[];
  [key: string]: unknown;
}

export interface WriteFeedbackParams {
  project: string;
  taskId: string; // e.g. "ACME-001"
  envelope: FeedbackEnvelope;
}

export function writeFeedback(repoRoot: string, params: WriteFeedbackParams): string {
  const match = params.taskId.match(/^(.+)-(\d+)$/);
  if (!match) throw new Error(`Invalid taskId: ${params.taskId}`);
  const project = match[1];
  const taskNum = parseInt(match[2], 10);
  if (project !== params.project) {
    throw new Error(`project mismatch: taskId=${params.taskId} vs project=${params.project}`);
  }
  const iteration = nextFeedbackIteration(repoRoot, project, taskNum);
  const filename = `${params.taskId}-r${iteration}.json`;
  const path = join(feedbackDir(repoRoot), filename);
  writeFileSync(path, JSON.stringify(params.envelope, null, 2) + '\n');
  return path;
}

export function latestFeedback(repoRoot: string, taskId: string): FeedbackEnvelope | null {
  const items = allFeedback(repoRoot, taskId);
  return items.length === 0 ? null : items[items.length - 1];
}

export function allFeedback(repoRoot: string, taskId: string): FeedbackEnvelope[] {
  const dir = feedbackDir(repoRoot);
  if (!existsSync(dir)) return [];
  const re = new RegExp(`^${escapeRegex(taskId)}-r(\\d+)\\.json$`);
  const entries = readdirSync(dir)
    .map((f) => ({ f, m: f.match(re) }))
    .filter((x): x is { f: string; m: RegExpMatchArray } => !!x.m)
    .sort((a, b) => parseInt(a.m[1], 10) - parseInt(b.m[1], 10));
  return entries.map(({ f }) =>
    JSON.parse(readFileSync(join(dir, f), 'utf-8')) as FeedbackEnvelope
  );
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
