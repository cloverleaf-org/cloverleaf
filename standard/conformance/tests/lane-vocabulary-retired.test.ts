import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { validateStatusTransitionLegality } from '../../validators/status-transition-legality.js';
import type { StatusTransitions, Task, StatusTransitionEvent } from '../../validators/types.js';

const ROOT = resolve(__dirname, '..', '..');

/**
 * 0.8.0 collapsed the task delivery FSM into one `council` phase and retired the
 * fast_lane / full_pipeline split. The `path` transition tag that encoded it survived
 * the collapse in the schema and the legality validator, where it could never match
 * (no shipped state machine carries a `path`) yet still spoke retired vocabulary in
 * every illegal-transition message. These guards keep it gone.
 *
 * Scope is the SPEC surface, deliberately not the whole package:
 *   - `CHANGELOG.md` is the historical record of the removal and has to name what it
 *     removed.
 *   - `conformance/` is the test surface — this very file must spell the forbidden
 *     words in order to forbid them, so a whole-package sweep would fail on its own
 *     guard.
 */
const SPEC_DIRS = ['schemas', 'state-machines', 'validators', 'agent-contracts', 'docs'];
const SPEC_FILES = ['README.md'];
const LANE = /fast_lane|full_pipeline/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function specSurface(): string[] {
  return [
    ...SPEC_DIRS.flatMap((d) => walk(join(ROOT, d))),
    ...SPEC_FILES.map((f) => join(ROOT, f)),
  ];
}

const TASK_SM = JSON.parse(
  readFileSync(join(ROOT, 'state-machines', 'task.json'), 'utf-8'),
) as StatusTransitions;

function evt(from: string, to: string, actor: 'agent' | 'human' = 'agent'): StatusTransitionEvent {
  return {
    event_id: 'e', event_type: 'status_transition', occurred_at: '2026-07-20T00:00:00Z',
    work_item_id: { project: 'CLV', id: 'CLV-1' }, work_item_type: 'task',
    from_status: from, to_status: to, actor: { kind: actor, id: actor },
  };
}

function task(risk: 'low' | 'high'): Task {
  return {
    id: 'CLV-1', type: 'task', status: 'council', project: 'CLV', title: 't',
    owner: { kind: 'agent', id: 'unassigned' },
    context: { rfc: { project: 'CLV', id: 'CLV-1' } },
    definition_of_done: ['x'], acceptance_criteria: ['y'], risk_class: risk,
  } as unknown as Task;
}

describe('the retired delivery-lane vocabulary stays out of the Standard', () => {
  const swept = specSurface();

  it('sweeps a non-empty spec surface', () => {
    // A sweep that silently matched nothing would read exactly like a pass.
    expect(swept.length).toBeGreaterThan(40);
  });

  it('no shipped spec file names a delivery lane', () => {
    const offenders = swept
      .filter((f) => LANE.test(readFileSync(f, 'utf-8')))
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it('the status-transitions schema declares no `path` tag, and rejects one outright', () => {
    const schema = JSON.parse(
      readFileSync(join(ROOT, 'schemas', 'status-transitions.schema.json'), 'utf-8'),
    );
    const item = schema.properties.transitions.items;
    expect(Object.keys(item.properties)).not.toContain('path');
    // additionalProperties:false is what turns "no longer declared" into "no longer
    // accepted" — without it a consumer's stale `path` tag would validate and be ignored.
    expect(item.additionalProperties).toBe(false);
  });

  it('an illegal-transition violation names no delivery lane, for either risk class', () => {
    for (const risk of ['low', 'high'] as const) {
      const result = validateStatusTransitionLegality(evt('merged', 'implementing'), TASK_SM, task(risk));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.violations[0].message).toBe(
        "Illegal transition for type 'task': merged → implementing by agent",
      );
    }
  });

  it('the Violation type keeps its own unrelated `path` field', () => {
    // `Violation.path` is a violation LOCATION, published since 0.4 and documented in
    // docs/validators.md. It looks like the retired transition tag and is not; a
    // grep-and-delete over `path?` would silently narrow violation reporting.
    const types = readFileSync(join(ROOT, 'validators', 'types.ts'), 'utf-8');
    const violation = types.slice(types.indexOf('export interface Violation'));
    expect(violation).toMatch(/^\s*path\?: string;$/m);
  });
});
