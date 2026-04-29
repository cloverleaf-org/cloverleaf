/**
 * scope-check.test.ts — 12 test cases for classifyFiles.
 *
 * Covers all scenarios from the CLV-86 definition of done:
 *  1.  empty inputs (all three lists empty)
 *  2.  file in own bucket
 *  3.  file in sibling (contested) bucket
 *  4.  file in nobody (extension) bucket
 *  5.  mixed: one file per bucket
 *  6.  path normalization (./foo.ts and foo.ts collapse to same key)
 *  7.  .cloverleaf/ prefix is excluded from classification
 *  8.  deterministic output (same inputs → same output)
 *  9.  multiple siblings claim same file → lex-smallest owner wins
 * 10.  missing own (scope absent) → everything is sibling or extension
 * 11.  missing sibling match → file goes to extension
 * 12.  literal-not-glob: lib/*.ts in own does NOT match lib/foo.ts
 */

import { describe, it, expect } from 'vitest';
import { classifyFiles } from '../lib/scope-check.js';
import type { TaskDoc } from '../lib/task.js';
import type { SiblingScope } from '../lib/scope-check.js';

function makeTask(id: string, files?: string[]): TaskDoc {
  const base: TaskDoc = {
    type: 'task',
    project: 'CLV',
    id,
    title: `Task ${id}`,
    status: 'pending',
    risk_class: 'low',
    owner: { kind: 'agent', id: 'implementer' },
    acceptance_criteria: ['ac'],
    definition_of_done: ['dod'],
    context: { rfc: { project: 'CLV', id: 'CLV-001' } },
  };
  if (files !== undefined) {
    (base as Record<string, unknown>)['scope'] = { files_touched: files };
  }
  return base;
}

describe('classifyFiles', () => {
  // 1. Empty inputs — all three lists empty → all buckets empty
  it('returns all-empty buckets when inputs are all empty', () => {
    const task = makeTask('CLV-001', []);
    const result = classifyFiles(task, [], []);
    expect(result.own).toEqual([]);
    expect(result.contested).toEqual([]);
    expect(result.extension).toEqual([]);
  });

  // 2. File in own bucket
  it('places a modified file in own when it is declared in scope.files_touched', () => {
    const task = makeTask('CLV-001', ['lib/foo.ts']);
    const result = classifyFiles(task, ['lib/foo.ts'], []);
    expect(result.own).toEqual(['lib/foo.ts']);
    expect(result.contested).toEqual([]);
    expect(result.extension).toEqual([]);
  });

  // 3. File in sibling (contested) bucket
  it('places a modified file in contested when a sibling task declares it', () => {
    const task = makeTask('CLV-001', ['lib/own.ts']);
    const siblings: SiblingScope[] = [
      { taskId: 'CLV-002', files: ['lib/sibling.ts'] },
    ];
    const result = classifyFiles(task, ['lib/sibling.ts'], siblings);
    expect(result.contested).toEqual([{ file: 'lib/sibling.ts', owner: 'CLV-002' }]);
    expect(result.own).toEqual([]);
    expect(result.extension).toEqual([]);
  });

  // 4. File in nobody (extension) bucket
  it('places a modified file in extension when no task declares it', () => {
    const task = makeTask('CLV-001', ['lib/own.ts']);
    const result = classifyFiles(task, ['lib/unknown.ts'], []);
    expect(result.extension).toEqual(['lib/unknown.ts']);
    expect(result.own).toEqual([]);
    expect(result.contested).toEqual([]);
  });

  // 5. Mixed: one file per bucket
  it('correctly splits files across all three buckets in a mixed scenario', () => {
    const task = makeTask('CLV-001', ['lib/own.ts']);
    const siblings: SiblingScope[] = [
      { taskId: 'CLV-002', files: ['lib/sibling.ts'] },
    ];
    const modified = ['lib/own.ts', 'lib/sibling.ts', 'lib/extra.ts'];
    const result = classifyFiles(task, modified, siblings);
    expect(result.own).toEqual(['lib/own.ts']);
    expect(result.contested).toEqual([{ file: 'lib/sibling.ts', owner: 'CLV-002' }]);
    expect(result.extension).toEqual(['lib/extra.ts']);
  });

  // 6. Path normalization: ./foo.ts and foo.ts collapse to the same key
  it('treats ./prefix and no-prefix paths as identical after normalization', () => {
    const task = makeTask('CLV-001', ['lib/foo.ts']);
    // modifiedFiles uses ./lib/foo.ts — should still land in own
    const result = classifyFiles(task, ['./lib/foo.ts'], []);
    expect(result.own).toEqual(['lib/foo.ts']);
    expect(result.contested).toEqual([]);
    expect(result.extension).toEqual([]);
  });

  // 7. .cloverleaf/ prefix is excluded from classification entirely
  it('excludes .cloverleaf/-prefixed paths even if they appear in modifiedFiles', () => {
    const task = makeTask('CLV-001', ['.cloverleaf/tasks/CLV-001.json']);
    const modified = [
      '.cloverleaf/tasks/CLV-001.json',
      '.cloverleaf/plans/CLV-P1.json',
      'lib/real.ts',
    ];
    const result = classifyFiles(task, modified, []);
    // .cloverleaf/ files must not appear in any bucket
    expect(result.own).toEqual([]);
    expect(result.contested).toEqual([]);
    // only lib/real.ts remains, goes to extension
    expect(result.extension).toEqual(['lib/real.ts']);
  });

  // 8. Deterministic output: same inputs always produce the same result
  it('produces identical output for the same inputs (determinism)', () => {
    const task = makeTask('CLV-001', ['lib/a.ts', 'lib/b.ts']);
    const siblings: SiblingScope[] = [
      { taskId: 'CLV-002', files: ['lib/c.ts'] },
    ];
    const modified = ['lib/b.ts', 'lib/a.ts', 'lib/c.ts', 'lib/d.ts'];

    const r1 = classifyFiles(task, modified, siblings);
    const r2 = classifyFiles(task, modified, siblings);
    const r3 = classifyFiles(task, modified, siblings);
    expect(r1).toEqual(r2);
    expect(r1).toEqual(r3);
    // Also verify sorted order
    expect(r1.own).toEqual(['lib/a.ts', 'lib/b.ts']);
    expect(r1.contested).toEqual([{ file: 'lib/c.ts', owner: 'CLV-002' }]);
    expect(r1.extension).toEqual(['lib/d.ts']);
  });

  // 9. Multiple siblings claim same file → lex-smallest taskId wins as owner
  it('assigns lex-smallest sibling taskId as owner when multiple siblings claim a file', () => {
    const task = makeTask('CLV-001', []);
    const siblings: SiblingScope[] = [
      { taskId: 'CLV-010', files: ['lib/shared.ts'] },
      { taskId: 'CLV-002', files: ['lib/shared.ts'] },
      { taskId: 'CLV-005', files: ['lib/shared.ts'] },
    ];
    const result = classifyFiles(task, ['lib/shared.ts'], siblings);
    expect(result.contested).toEqual([{ file: 'lib/shared.ts', owner: 'CLV-002' }]);
    expect(result.own).toEqual([]);
    expect(result.extension).toEqual([]);
  });

  // 10. Missing own (scope absent) → files cannot land in own; go to sibling or extension
  it('returns all-empty own bucket when scope is absent', () => {
    const task = makeTask('CLV-001'); // no scope field at all
    const siblings: SiblingScope[] = [
      { taskId: 'CLV-002', files: ['lib/sibling.ts'] },
    ];
    const modified = ['lib/sibling.ts', 'lib/extra.ts'];
    const result = classifyFiles(task, modified, siblings);
    expect(result.own).toEqual([]);
    expect(result.contested).toEqual([{ file: 'lib/sibling.ts', owner: 'CLV-002' }]);
    expect(result.extension).toEqual(['lib/extra.ts']);
  });

  // 11. Missing sibling match → file goes to extension (not in own, not contested)
  it('sends a file to extension when no own or sibling declares it', () => {
    const task = makeTask('CLV-001', ['lib/declared.ts']);
    const siblings: SiblingScope[] = [
      { taskId: 'CLV-002', files: ['lib/other-sibling.ts'] },
    ];
    const result = classifyFiles(task, ['lib/undeclared.ts'], siblings);
    expect(result.own).toEqual([]);
    expect(result.contested).toEqual([]);
    expect(result.extension).toEqual(['lib/undeclared.ts']);
  });

  // 12. Literal-not-glob: `lib/*.ts` in own does NOT match `lib/foo.ts`
  it('uses exact-path comparison only — glob patterns in own do NOT match real paths', () => {
    const task = makeTask('CLV-001', ['lib/*.ts']); // glob-like, but treated as literal
    const result = classifyFiles(task, ['lib/foo.ts', 'lib/*.ts'], []);
    // lib/foo.ts does NOT match the literal string "lib/*.ts"
    expect(result.own).toEqual(['lib/*.ts']);
    // lib/foo.ts goes to extension because it doesn't equal "lib/*.ts" literally
    expect(result.extension).toEqual(['lib/foo.ts']);
    expect(result.contested).toEqual([]);
  });
});
