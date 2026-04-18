import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import {
  cloverleafDir,
  projectsDir,
  tasksDir,
  eventsDir,
  feedbackDir,
  rfcsDir,
  spikesDir,
  plansDir,
} from '../lib/paths.js';

describe('paths', () => {
  const root = '/tmp/demo-repo';

  it('resolves the .cloverleaf root', () => {
    expect(cloverleafDir(root)).toBe(resolve(root, '.cloverleaf'));
  });

  it('resolves each subdirectory', () => {
    expect(projectsDir(root)).toBe(resolve(root, '.cloverleaf', 'projects'));
    expect(tasksDir(root)).toBe(resolve(root, '.cloverleaf', 'tasks'));
    expect(eventsDir(root)).toBe(resolve(root, '.cloverleaf', 'events'));
    expect(feedbackDir(root)).toBe(resolve(root, '.cloverleaf', 'feedback'));
    expect(rfcsDir(root)).toBe(resolve(root, '.cloverleaf', 'rfcs'));
    expect(spikesDir(root)).toBe(resolve(root, '.cloverleaf', 'spikes'));
    expect(plansDir(root)).toBe(resolve(root, '.cloverleaf', 'plans'));
  });
});
