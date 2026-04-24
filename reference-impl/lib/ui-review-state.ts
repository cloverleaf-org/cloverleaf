import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { uiReviewRunDir } from './paths.js';

export interface UiReviewState {
  baselines_pending: boolean;
}

const STATE_FILENAME = 'state.json';

/**
 * Returns the canonical path for the ui-review sidecar state file:
 *   .cloverleaf/runs/{taskId}/ui-review/state.json
 */
export function uiReviewStatePath(repoRoot: string, taskId: string): string {
  return join(uiReviewRunDir(repoRoot, taskId), STATE_FILENAME);
}

/**
 * Reads the ui-review state sidecar from disk.
 *
 * Returns `{ baselines_pending: false }` when the file is absent — the
 * absence of the file is treated as "no pending baselines", which lets the
 * ui-review → qa transition proceed normally.
 */
export function readUiReviewState(repoRoot: string, taskId: string): UiReviewState {
  const path = uiReviewStatePath(repoRoot, taskId);
  if (!existsSync(path)) {
    return { baselines_pending: false };
  }
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as UiReviewState;
  return { baselines_pending: Boolean(raw.baselines_pending) };
}

/**
 * Writes the ui-review state sidecar to disk, creating intermediate directories
 * as needed.
 *
 * @param repoRoot  Absolute path to the repository root.
 * @param taskId    Task identifier (e.g. "CLV-42").
 * @param state     The state to persist.
 */
export function writeUiReviewState(
  repoRoot: string,
  taskId: string,
  state: UiReviewState,
): void {
  const dir = uiReviewRunDir(repoRoot, taskId);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, STATE_FILENAME);
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n');
}
