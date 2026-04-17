import { describe, it, expect } from 'vitest';
import { validateCrossProjectRef } from '../../validators/cross-project-ref.js';
import type { Project } from '../../validators/types.js';

const projects: Project[] = [
  { key: 'ACME', name: 'Acme' },
  { key: 'PLATFORM', name: 'Platform' }
];

describe('validator: cross-project-ref', () => {
  it('accepts ref to a known project', () => {
    expect(validateCrossProjectRef({ project: 'ACME', id: 'ACME-1' }, projects).ok).toBe(true);
    expect(validateCrossProjectRef({ project: 'PLATFORM', id: 'PLATFORM-42' }, projects).ok).toBe(true);
  });

  it('rejects ref to an unknown project', () => {
    const r = validateCrossProjectRef({ project: 'GHOST', id: 'GHOST-1' }, projects);
    expect(r.ok).toBe(false);
  });
});
