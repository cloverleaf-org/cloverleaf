import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { WalkState } from './dag-walker.js';

export function walkStatePath(repoRoot: string, planId: string): string {
  return join(repoRoot, '.cloverleaf', 'runs', 'plan', planId, 'walk-state.json');
}

export function readWalkState(repoRoot: string, planId: string): WalkState | null {
  const path = walkStatePath(repoRoot, planId);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as WalkState;
}

export function writeWalkState(repoRoot: string, state: WalkState): void {
  const path = walkStatePath(repoRoot, state.plan_id);
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  try {
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // best effort
    }
    throw err;
  }
}
