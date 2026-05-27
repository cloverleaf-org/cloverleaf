/**
 * scope-check.ts — reference-impl v0.7.0
 *
 * Classifies a task's modified files into three buckets:
 *  - own: file is declared in the task's own scope.files_touched
 *  - contested: file is declared by a sibling task in the same Plan
 *  - extension: file was touched but not declared by anyone
 *
 * Algorithm:
 *  1. Normalize all input paths (taskDoc.scope.files_touched, modifiedFiles,
 *     every siblingScopes[*].files) using the same rules as dag-overlap.ts:
 *     trim, replace backslashes, strip leading `./`, strip trailing `/`.
 *     Drop empties after normalization.
 *  2. Build:
 *     - ownSet = normalized set of taskDoc.scope?.files_touched ?? []
 *     - siblingMap = Map<normalizedFile, sortedListOfTaskIds> from all siblings
 *       (a single file may be claimed by multiple siblings — kept sorted lex ascending)
 *  3. Filter out any modified file whose normalized path starts with `.cloverleaf/`
 *     (these are state-machine transitions, not work).
 *  4. For each remaining normalized modified file f (in input order, deduped):
 *     - If f ∈ ownSet → push to own
 *     - Else if siblingMap.has(f) → push { file: f, owner: siblingMap.get(f)![0] } to contested
 *       (lex-smallest sibling id wins)
 *     - Else → push to extension
 *  5. Sort all three output bucket arrays lexicographically by file path.
 *  6. Return { contested, own, extension }.
 *
 * Exact-path comparison only — no glob expansion (mirrors dag-overlap.ts v0.7.0 non-goals).
 */

import type { TaskDoc } from './task.js';

export interface ContestedEntry {
  file: string;
  owner: string;
}

export interface ClassifyResult {
  contested: ContestedEntry[];
  own: string[];
  extension: string[];
}

export interface SiblingScope {
  taskId: string;
  files: string[];
}

/**
 * Normalize a raw file path from `scope.files_touched` or modifiedFiles.
 *
 * Rules (applied in order):
 *  - Trim whitespace
 *  - Replace backslashes with forward-slashes
 *  - Strip any number of leading `./` sequences
 *  - Strip trailing `/` (preserving a non-empty result)
 *  - Return the resulting string (may be empty for degenerate inputs; caller filters)
 */
export function normalizePath(p: string): string {
  let s = p.trim().replace(/\\/g, '/');
  // Strip leading `./` repeatedly
  while (s.startsWith('./')) {
    s = s.slice(2);
  }
  // Strip trailing `/`
  while (s.endsWith('/') && s.length > 1) {
    s = s.slice(0, -1);
  }
  return s;
}

/**
 * Normalize an array of paths and drop empty strings after normalization.
 */
function normalizePaths(paths: string[]): string[] {
  const result: string[] = [];
  for (const p of paths) {
    if (typeof p !== 'string') continue;
    const n = normalizePath(p);
    if (n.length > 0) result.push(n);
  }
  return result;
}

/**
 * Classify a task's modified files into own, contested, and extension buckets.
 *
 * @param taskDoc       - The task document whose scope declares "own" files.
 * @param modifiedFiles - The list of files actually modified (e.g., from git diff).
 * @param siblingScopes - Other tasks in the same Plan with their declared files.
 * @returns             - { contested, own, extension } with arrays sorted by file path.
 */
export function classifyFiles(
  taskDoc: TaskDoc,
  modifiedFiles: string[],
  siblingScopes: SiblingScope[],
  sharedFiles?: Set<string>
): ClassifyResult {
  // 1. Normalize own files from taskDoc.scope.files_touched
  const scope = taskDoc['scope'] as Record<string, unknown> | undefined;
  const rawOwn = Array.isArray(scope?.['files_touched'])
    ? (scope!['files_touched'] as unknown[]).filter((f): f is string => typeof f === 'string')
    : [];
  const ownSet = new Set(normalizePaths(rawOwn));

  // 2. Build siblingMap: normalizedFile → sorted list of taskIds
  const siblingMap = new Map<string, string[]>();
  for (const sibling of siblingScopes) {
    const normalized = normalizePaths(sibling.files);
    for (const f of normalized) {
      const existing = siblingMap.get(f);
      if (existing) {
        existing.push(sibling.taskId);
        existing.sort();
      } else {
        siblingMap.set(f, [sibling.taskId]);
      }
    }
  }

  // 3. Normalize modifiedFiles, filter .cloverleaf/ prefix, deduplicate
  const seen = new Set<string>();
  const filteredModified: string[] = [];
  for (const raw of modifiedFiles) {
    if (typeof raw !== 'string') continue;
    const n = normalizePath(raw);
    if (n.length === 0) continue;
    if (n.startsWith('.cloverleaf/')) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    filteredModified.push(n);
  }

  // 4. Classify each file into the appropriate bucket
  const own: string[] = [];
  const contested: ContestedEntry[] = [];
  const extension: string[] = [];

  for (const f of filteredModified) {
    if (ownSet.has(f)) {
      own.push(f);
    } else if (sharedFiles?.has(f)) {
      // merge=union (or other shared-intent annotation): never contested.
      // Falls into extension so post-merge auto-extend picks it up.
      extension.push(f);
    } else if (siblingMap.has(f)) {
      const owners = siblingMap.get(f)!;
      contested.push({ file: f, owner: owners[0] }); // lex-smallest wins
    } else {
      extension.push(f);
    }
  }

  // 5. Sort all buckets lexicographically by file path
  own.sort();
  contested.sort((a, b) => a.file.localeCompare(b.file));
  extension.sort();

  return { contested, own, extension };
}
