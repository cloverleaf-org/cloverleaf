import { describe, it, expect } from 'vitest';
import { validateIdPattern } from '../../validators/id-pattern.js';
import type { WorkItem, Project } from '../../validators/types.js';

const acme: Project = { key: 'ACME', name: 'Acme' };
const contoso: Project = { key: 'CONTOSO', name: 'Contoso', id_pattern: '^[0-9a-f]{8}$' };

function wi(id: string, project: string): WorkItem {
  return { id, type: 'task', status: 'pending', project, owner: { kind: 'agent', id: 'a' } } as WorkItem;
}

describe('validator: id-pattern', () => {
  it('accepts default pattern for ACME-123', () => {
    expect(validateIdPattern(wi('ACME-123', 'ACME'), acme).ok).toBe(true);
  });

  it('rejects lowercase prefix with default pattern', () => {
    expect(validateIdPattern(wi('acme-123', 'ACME'), acme).ok).toBe(false);
  });

  it('rejects non-numeric suffix with default pattern', () => {
    expect(validateIdPattern(wi('ACME-abc', 'ACME'), acme).ok).toBe(false);
  });

  it('accepts UUID-like id when project overrides id_pattern', () => {
    expect(validateIdPattern(wi('deadbeef', 'CONTOSO'), contoso).ok).toBe(true);
  });

  it('rejects ACME-style id when project expects UUID', () => {
    expect(validateIdPattern(wi('CONTOSO-1', 'CONTOSO'), contoso).ok).toBe(false);
  });
});
