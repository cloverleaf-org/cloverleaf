import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spikesDir } from './paths.js';
import { validateOrThrow } from './validate.js';
import { advanceWorkItemStatus, loadStateMachine } from './work-item.js';

export interface SpikeDoc {
  type: 'spike';
  project: string;
  id: string;
  title: string;
  status: string;
  owner: { kind: 'agent' | 'human' | 'system'; id: string };
  parent_rfc: { project: string; id: string };
  question: string;
  method: 'research' | 'prototype' | 'benchmark';
  findings?: string;
  recommendation?: string;
  [key: string]: unknown;
}

export function loadSpike(repoRoot: string, id: string): SpikeDoc {
  const path = join(spikesDir(repoRoot), `${id}.json`);
  if (!existsSync(path)) throw new Error(`Spike ${id} not found at ${path}`);
  return JSON.parse(readFileSync(path, 'utf-8')) as SpikeDoc;
}

export function saveSpike(repoRoot: string, spike: SpikeDoc): void {
  validateOrThrow('https://cloverleaf.example/schemas/spike.schema.json', spike);
  const path = join(spikesDir(repoRoot), `${spike.id}.json`);
  writeFileSync(path, JSON.stringify(spike, null, 2) + '\n');
}

export function advanceSpikeStatus(
  repoRoot: string,
  id: string,
  toStatus: string,
  actor: 'agent' | 'human'
): SpikeDoc {
  const spike = loadSpike(repoRoot, id);
  const from = spike.status;
  const sm = loadStateMachine('spike');
  const fixture = { type: 'spike', id: spike.id, project: spike.project, status: spike.status };

  const proposed = { ...spike, status: toStatus };
  advanceWorkItemStatus({
    repoRoot,
    workItemType: 'spike',
    project: spike.project,
    id: spike.id,
    from,
    to: toStatus,
    actor,
    stateMachine: sm,
    validateFixture: fixture,
    save: (p) => saveSpike(repoRoot, p as SpikeDoc),
    proposed,
  });
  return proposed;
}
