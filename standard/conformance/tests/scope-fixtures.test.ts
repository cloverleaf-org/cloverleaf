/**
 * Conformance tests for standard/conformance/fixtures/.
 *
 * Multi-task fixture files are JSON objects with a `tasks` array.  Every task
 * entry must validate against the task schema.  This suite is the canonical
 * home for multi-task fixture scenarios (e.g. overlapping scope.files_touched).
 *
 * Standalone single-task fixture files (no `tasks` array) are skipped by this
 * suite; they are validated by their own dedicated test files, e.g. security-fixture.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeAjv } from '../helpers/ajv-instance.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_DIR = resolve(__dirname, '..', 'fixtures');
const SCHEMA_ID = 'https://cloverleaf.example/schemas/task.schema.json';

interface FixtureFile {
  tasks?: unknown[];
  [k: string]: unknown;
}

describe('conformance/fixtures — scope.files_touched', () => {
  const ajv = makeAjv();
  const validate = ajv.getSchema(SCHEMA_ID);

  it('task schema is registered', () => {
    expect(validate).toBeDefined();
  });

  if (!existsSync(FIXTURES_DIR)) {
    it('fixtures directory exists', () => {
      expect(existsSync(FIXTURES_DIR)).toBe(true);
    });
  } else {
    const fixtureFiles = readdirSync(FIXTURES_DIR).filter(
      (f) => f.endsWith('.json')
    );

    it('at least one fixture file exists', () => {
      expect(fixtureFiles.length).toBeGreaterThan(0);
    });

    // Only process multi-task fixtures (those with a `tasks` array).
    // Standalone single-task fixtures are validated by their own dedicated test files.
    const multiTaskFixtures = fixtureFiles.filter((filename) => {
      const filePath = resolve(FIXTURES_DIR, filename);
      const fixture = JSON.parse(readFileSync(filePath, 'utf-8')) as FixtureFile;
      return Array.isArray(fixture.tasks);
    });

    it('at least one multi-task fixture exists', () => {
      expect(multiTaskFixtures.length).toBeGreaterThan(0);
    });

    for (const filename of multiTaskFixtures) {
      const filePath = resolve(FIXTURES_DIR, filename);
      const fixture = JSON.parse(readFileSync(filePath, 'utf-8')) as FixtureFile;

      describe(`fixture: ${filename}`, () => {
        it('has a tasks array', () => {
          expect(Array.isArray(fixture.tasks)).toBe(true);
          expect((fixture.tasks as unknown[]).length).toBeGreaterThan(0);
        });

        const tasks = Array.isArray(fixture.tasks) ? fixture.tasks : [];

        for (let i = 0; i < tasks.length; i++) {
          it(`task[${i}] validates against task schema`, () => {
            expect(validate).toBeDefined();
            const ok = validate!(tasks[i]);
            expect(
              validate!.errors ?? null,
              `task[${i}] in ${filename}: AJV errors: ${JSON.stringify(validate!.errors)}`
            ).toBeNull();
            expect(ok).toBe(true);
          });
        }

        it('at least two tasks share a file in scope.files_touched', () => {
          const allFiles: string[] = [];
          for (const task of tasks) {
            const t = task as { scope?: { files_touched?: string[] } };
            if (t.scope?.files_touched) {
              allFiles.push(...t.scope.files_touched);
            }
          }
          // Count occurrences of each file
          const counts: Record<string, number> = {};
          for (const f of allFiles) {
            counts[f] = (counts[f] ?? 0) + 1;
          }
          const hasOverlap = Object.values(counts).some((c) => c >= 2);
          expect(
            hasOverlap,
            `Expected at least two tasks to share a file in scope.files_touched in ${filename}`
          ).toBe(true);
        });
      });
    }
  }
});
