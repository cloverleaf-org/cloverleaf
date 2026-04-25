import { readdirSync, existsSync } from 'node:fs';
import { tasksDir, eventsDir, feedbackDir, projectsDir, rfcsDir, spikesDir, plansDir } from './paths.js';

export function nextTaskId(repoRoot: string, project: string): string {
  const dir = tasksDir(repoRoot);
  if (!existsSync(dir)) return `${project}-001`;
  const re = new RegExp(`^${escapeRegex(project)}-(\\d+)\\.json$`);
  const nums = readdirSync(dir)
    .map((f) => f.match(re))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => parseInt(m[1], 10));
  const next = nums.length === 0 ? 1 : Math.max(...nums) + 1;
  return `${project}-${String(next).padStart(3, '0')}`;
}

export function nextEventId(repoRoot: string, workItemId: string): number {
  const dir = eventsDir(repoRoot);
  if (!existsSync(dir)) return 1;
  // Per-work-item sequence. Filenames are `<workItemId>-<NNN>-<status|gate>.json`,
  // which keeps counters scoped to a single task / RFC / Spike / Plan — this matters
  // for the v0.6 DAG walker's parallel mode, where multiple worktrees emit events
  // simultaneously. A global per-project counter (the pre-v0.6 scheme) produced
  // filename collisions when the walker merged sibling feature branches. Per-work-item
  // scoping means each task's counter is independent; merges union cleanly.
  const re = new RegExp(`^${escapeRegex(workItemId)}-(\\d+)-(status|gate)\\.json$`);
  const nums = readdirSync(dir)
    .map((f) => f.match(re))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => parseInt(m[1], 10));
  return nums.length === 0 ? 1 : Math.max(...nums) + 1;
}

export function nextFeedbackIteration(repoRoot: string, project: string, taskNum: number, prefix = 'r'): number {
  const dir = feedbackDir(repoRoot);
  if (!existsSync(dir)) return 1;
  const suffix = String(taskNum).padStart(3, '0');
  const escapedPrefix = escapeRegex(prefix);
  const re = new RegExp(`^${escapeRegex(project)}-${suffix}-${escapedPrefix}(\\d+)\\.json$`);
  const nums = readdirSync(dir)
    .map((f) => f.match(re))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => parseInt(m[1], 10));
  return nums.length === 0 ? 1 : Math.max(...nums) + 1;
}

export function listProjects(repoRoot: string): string[] {
  const dir = projectsDir(repoRoot);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json'))
    .map((f) => f.replace(/\.json$/, ''));
}

export function inferProject(repoRoot: string, explicit?: string): string {
  if (explicit) return explicit;
  const projects = listProjects(repoRoot);
  if (projects.length === 0) throw new Error('No projects found under .cloverleaf/projects/');
  if (projects.length > 1) {
    throw new Error(`Multiple projects found (${projects.join(', ')}); specify one explicitly.`);
  }
  return projects[0];
}

/**
 * Returns unpadded per-project IDs (e.g., `CLV-13`) by scanning all four
 * work-item directories and taking max+1. Matches the canonical convention
 * used in @cloverleaf/standard example scenarios (oauth-rollout: ACME-100,
 * ACME-200). Legacy `nextTaskId` retains three-digit padding (e.g., CLV-001)
 * for back-compat with existing task files.
 */
export function nextWorkItemId(repoRoot: string, project: string): string {
  const dirs = [rfcsDir(repoRoot), spikesDir(repoRoot), plansDir(repoRoot), tasksDir(repoRoot)];
  const pat = new RegExp(`^${escapeRegex(project)}-(\\d+)\\.json$`);
  let max = 0;
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) {
      const m = pat.exec(f);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
  }
  return `${project}-${max + 1}`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
