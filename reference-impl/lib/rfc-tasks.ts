import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { plansDir, tasksDir, rfcsDir } from './paths.js';
import type { TaskDoc } from './task.js';

/**
 * A task is "standalone" (RFC-direct) iff it has no parent (absent or null)
 * AND it has a non-empty context.rfc.id. See
 * docs/superpowers/specs/2026-05-12-rfc-direct-tasks-design.md §"Discriminator".
 */
export function isStandaloneTask(task: TaskDoc): boolean {
  const parent = (task as Record<string, unknown>).parent;
  if (parent != null) return false;
  const ctx = task.context as Record<string, unknown> | undefined;
  const rfc = ctx?.rfc as { project?: string; id?: string } | undefined;
  return !!(rfc && typeof rfc.id === 'string' && rfc.id.length > 0);
}
