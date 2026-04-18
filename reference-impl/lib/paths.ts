import { resolve } from 'node:path';

const CLOVERLEAF = '.cloverleaf';

export function cloverleafDir(repoRoot: string): string {
  return resolve(repoRoot, CLOVERLEAF);
}

export function projectsDir(repoRoot: string): string {
  return resolve(cloverleafDir(repoRoot), 'projects');
}

export function tasksDir(repoRoot: string): string {
  return resolve(cloverleafDir(repoRoot), 'tasks');
}

export function eventsDir(repoRoot: string): string {
  return resolve(cloverleafDir(repoRoot), 'events');
}

export function feedbackDir(repoRoot: string): string {
  return resolve(cloverleafDir(repoRoot), 'feedback');
}

export function rfcsDir(repoRoot: string): string {
  return resolve(cloverleafDir(repoRoot), 'rfcs');
}

export function spikesDir(repoRoot: string): string {
  return resolve(cloverleafDir(repoRoot), 'spikes');
}

export function plansDir(repoRoot: string): string {
  return resolve(cloverleafDir(repoRoot), 'plans');
}
