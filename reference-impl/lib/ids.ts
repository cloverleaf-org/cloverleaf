import { readdirSync, existsSync } from 'node:fs';
import { tasksDir, eventsDir, feedbackDir, projectsDir } from './paths.js';

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

export function nextEventId(repoRoot: string, project: string): number {
  const dir = eventsDir(repoRoot);
  if (!existsSync(dir)) return 1;
  const re = new RegExp(`^${escapeRegex(project)}-(\\d+)-(status|gate)\\.json$`);
  const nums = readdirSync(dir)
    .map((f) => f.match(re))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => parseInt(m[1], 10));
  return nums.length === 0 ? 1 : Math.max(...nums) + 1;
}

export function nextFeedbackIteration(repoRoot: string, project: string, taskNum: number): number {
  const dir = feedbackDir(repoRoot);
  if (!existsSync(dir)) return 1;
  const suffix = String(taskNum).padStart(3, '0');
  const re = new RegExp(`^${escapeRegex(project)}-${suffix}-r(\\d+)\\.json$`);
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
