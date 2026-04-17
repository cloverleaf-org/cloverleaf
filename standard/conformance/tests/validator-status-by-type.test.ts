import { describe, it, expect } from 'vitest';
import { validateStatusByType } from '../../validators/status-by-type.js';
import type { WorkItem } from '../../validators/types.js';

describe('validator: status-by-type', () => {
  const base = { id: 'ACME-1', project: 'ACME', owner: { kind: 'agent' as const, id: 'a' } };

  it('accepts rfc with drafting', () => {
    const wi: WorkItem = { ...base, type: 'rfc', status: 'drafting' };
    expect(validateStatusByType(wi)).toEqual({ ok: true });
  });

  it('rejects rfc with a task-only status', () => {
    const wi: WorkItem = { ...base, type: 'rfc', status: 'implementing' };
    const r = validateStatusByType(wi);
    expect(r.ok).toBe(false);
  });

  it('accepts task with ui-review', () => {
    const wi: WorkItem = { ...base, type: 'task', status: 'ui-review' };
    expect(validateStatusByType(wi)).toEqual({ ok: true });
  });

  it('rejects spike with an arbitrary status', () => {
    const wi: WorkItem = { ...base, type: 'spike', status: 'frobnicate' };
    expect(validateStatusByType(wi).ok).toBe(false);
  });
});
