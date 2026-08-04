import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { validateOrThrow } from '../lib/validate.js';

const ROOT = resolve(__dirname, '..');
const req = createRequire(import.meta.url);
const STANDARD_DIR = req.resolve('@cloverleaf/standard/package.json').replace(/\/package\.json$/, '');

/**
 * Which schema each agent-facing file's documented output must satisfy.
 * Files absent from this map are not checked; this map is the single place to
 * register a new prompt or skill whose documented shape is schema-bound.
 */
const CONTRACTS: ReadonlyArray<{ file: string; schema: string }> = [
  { file: 'prompts/reviewer.md', schema: 'feedback.schema.json' },
  { file: 'prompts/qa.md', schema: 'feedback.schema.json' },
  { file: 'prompts/ui-reviewer.md', schema: 'feedback.schema.json' },
  { file: 'prompts/security-reviewer.md', schema: 'feedback.schema.json' },
  { file: 'skills/cloverleaf-new-task/SKILL.md', schema: 'task.schema.json' },
];

const SCHEMA_ID_PREFIX = 'https://cloverleaf.example/schemas/';

function loadSchema(name: string): { properties?: Record<string, unknown>; additionalProperties?: boolean } {
  return JSON.parse(readFileSync(resolve(STANDARD_DIR, 'schemas', name), 'utf-8'));
}

function jsonBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
}

/**
 * Top-level keys of a documented block, extracted textually so that pseudo-JSON
 * templates (`"verdict": "pass" | "bounce"`, `<placeholder>`) are still checked.
 * Depth is tracked so nested keys are not mistaken for top-level ones.
 */
function topLevelKeys(block: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  for (const line of block.split('\n')) {
    const opens = (line.match(/[{[]/g) ?? []).length;
    const closes = (line.match(/[}\]]/g) ?? []).length;
    const keyMatch = line.match(/^\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*:/);
    if (keyMatch && depth === 1) keys.push(keyMatch[1]);
    depth += opens - closes;
  }
  return keys;
}

describe('prompt/skill documented shapes satisfy their schema', () => {
  for (const { file, schema } of CONTRACTS) {
    const markdown = readFileSync(resolve(ROOT, file), 'utf-8');
    const blocks = jsonBlocks(markdown);
    const schemaDoc = loadSchema(schema);
    const allowed = new Set(Object.keys(schemaDoc.properties ?? {}));

    it(`${file}: documents at least one JSON block`, () => {
      expect(blocks.length).toBeGreaterThan(0);
    });

    it(`${file}: every documented top-level key is allowed by ${schema}`, () => {
      const offenders: string[] = [];
      for (const block of blocks) {
        for (const key of topLevelKeys(block)) {
          if (!allowed.has(key)) offenders.push(key);
        }
      }
      expect(offenders).toEqual([]);
    });

    it(`${file}: every parseable JSON block validates against ${schema}`, () => {
      for (const block of blocks) {
        let doc: unknown;
        try {
          doc = JSON.parse(block);
        } catch {
          continue; // pseudo-JSON template — covered by the key-subset check above
        }
        expect(() => validateOrThrow(`${SCHEMA_ID_PREFIX}${schema}`, doc)).not.toThrow();
      }
    });
  }
});
