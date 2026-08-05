import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { validateOrThrow } from '../lib/validate.js';

/**
 * Cross-boundary backstop: every JSON shape an agent-facing file documents must
 * be a shape the Standard's schemas actually accept. Prose that specifies an
 * output the schema forbids is the defect class this suite exists to catch.
 *
 * ## The `cloverleaf-schema` annotation
 *
 * By default a ```json block is checked against the schema its file is mapped to
 * in CONTRACTS below. Some blocks are legitimately a different document type —
 * a runner-internal sidecar, or a fragment of a larger envelope. Mark those with
 * an HTML comment on the line immediately preceding the fence:
 *
 *   <!-- cloverleaf-schema: none -->
 *       The block is not schema-bound. Skipped by both checks. Use this only for
 *       documents the Standard genuinely does not describe.
 *
 *   <!-- cloverleaf-schema: feedback.schema.json#/$defs/finding -->
 *       The block is checked against that subschema instead of the file default:
 *       validated against it, and key-checked against its `properties`. This is
 *       added coverage for fragments, not an exemption from it.
 *
 *   (no annotation)
 *       The block is checked against the file's mapped schema. This is the
 *       default, and covers every block that is a real top-level envelope.
 */

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

/** A documented block plus the schema reference that governs it. */
interface Block {
  /** Fence contents. */
  body: string;
  /** 1-based line of the opening fence, for failure messages. */
  line: number;
  /** Schema ref (`<file>` or `<file>#/<pointer>`), or null when the block opted out. */
  ref: string | null;
}

/**
 * Resolve a schema ref to the schema node it names, following any JSON-pointer
 * fragment. Throws on an unresolvable ref: a typo'd annotation must fail loudly
 * rather than silently disable checking.
 */
function loadSchemaNode(ref: string): { properties?: Record<string, unknown> } {
  const [file, pointer] = ref.split('#');
  let node: unknown = JSON.parse(readFileSync(resolve(STANDARD_DIR, 'schemas', file), 'utf-8'));
  for (const rawSegment of (pointer ?? '').split('/').filter(Boolean)) {
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (typeof node !== 'object' || node === null || !(segment in node)) {
      throw new Error(`Unresolvable cloverleaf-schema ref: ${ref} (no '${segment}')`);
    }
    node = (node as Record<string, unknown>)[segment];
  }
  return node as { properties?: Record<string, unknown> };
}

/**
 * Every ```json block in the document, each carrying the schema ref that governs
 * it: the `cloverleaf-schema` annotation on the immediately preceding line when
 * present, otherwise the file's mapped schema. `none` yields a null ref.
 */
function jsonBlocks(markdown: string, defaultSchema: string): Block[] {
  const re =
    /(?:<!--[ \t]*cloverleaf-schema:[ \t]*([^\n>]*?)[ \t]*-->[ \t]*\r?\n[ \t]*)?```json\n([\s\S]*?)```/g;
  return [...markdown.matchAll(re)].map((m) => {
    const annotation = m[1]?.trim();
    const fenceOffset = m.index! + m[0].indexOf('```json');
    return {
      body: m[2],
      line: markdown.slice(0, fenceOffset).split('\n').length,
      ref: annotation === 'none' ? null : (annotation ?? defaultSchema),
    };
  });
}

/**
 * Top-level keys of a documented block, extracted textually so that pseudo-JSON
 * templates (`"verdict": "pass" | "bounce"`, `<placeholder>`) are still checked.
 *
 * Scans character by character rather than line by line so that keys sharing a
 * line with their opening brace are found too — a single-line block such as
 * `{"verdict": "pass", "results": {…}}` otherwise contributes nothing at all.
 * String literals are tracked, so braces inside placeholder paths like
 * `"baselines/{browser}/{slug}.png"` cannot skew the depth, and a `:` inside a
 * string value is never mistaken for a key separator.
 */
function topLevelKeys(block: string): string[] {
  const keys: string[] = [];
  const isIdentifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let literal = '';
  // Most recently closed string literal and the depth it closed at: a key is
  // such a literal immediately followed by `:` at depth 1.
  let pending: string | null = null;
  let pendingDepth = -1;

  for (const ch of block) {
    if (inString) {
      if (escaped) { escaped = false; literal += ch; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { inString = false; pending = literal; pendingDepth = depth; continue; }
      literal += ch;
      continue;
    }
    switch (ch) {
      case '"': inString = true; literal = ''; continue;
      case '{': case '[': depth++; pending = null; continue;
      case '}': case ']': depth--; pending = null; continue;
      case ':':
        if (pending !== null && pendingDepth === 1 && isIdentifier.test(pending)) keys.push(pending);
        pending = null;
        continue;
      case ',': pending = null; continue;
      default: continue; // whitespace and template noise leave `pending` intact
    }
  }
  return keys;
}

describe('prompt/skill documented shapes satisfy their schema', () => {
  for (const { file, schema } of CONTRACTS) {
    const markdown = readFileSync(resolve(ROOT, file), 'utf-8');
    const bound = jsonBlocks(markdown, schema).filter((b) => b.ref !== null);

    it(`${file}: documents at least one schema-bound JSON block`, () => {
      expect(bound.length).toBeGreaterThan(0);
    });

    it(`${file}: every documented top-level key is allowed by its schema`, () => {
      // Collected across every block, so no block can mask another.
      const offenders: string[] = [];
      for (const block of bound) {
        const allowed = new Set(Object.keys(loadSchemaNode(block.ref!).properties ?? {}));
        for (const key of topLevelKeys(block.body)) {
          if (!allowed.has(key)) offenders.push(`line ${block.line} (${block.ref}): ${key}`);
        }
      }
      expect(offenders).toEqual([]);
    });

    it(`${file}: every parseable JSON block validates against its schema`, () => {
      // Collected across every block, so no block can mask another.
      const failures: string[] = [];
      for (const block of bound) {
        let doc: unknown;
        try {
          doc = JSON.parse(block.body);
        } catch {
          continue; // pseudo-JSON template — covered by the key-subset check above
        }
        try {
          validateOrThrow(`${SCHEMA_ID_PREFIX}${block.ref}`, doc);
        } catch (err) {
          failures.push(`line ${block.line}: ${(err as Error).message}`);
        }
      }
      expect(failures).toEqual([]);
    });
  }
});
