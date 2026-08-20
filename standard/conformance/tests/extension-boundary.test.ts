import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const SCHEMA_DIR = join(ROOT, 'schemas');
const DOC = join(ROOT, 'docs', 'extensions.md');

/**
 * # The extension boundary
 *
 * Six of the seventeen shipped schemas carry an `extensions` hatch; the rest do not.
 * That split was never written down, and the published text described it wrongly:
 * `docs/extensions.md` opened *"All extensions live under the `extensions` field on a
 * Work Item"* and `extensions.schema.json`'s own description said *"Team-defined
 * extension fields on Work Items"* — while `project.schema.json`, which is
 * *"Per-project configuration"*, does not reference `work-item.schema.json`, and is not
 * among the trackable units `work-item.schema.json` names, carries the hatch anyway.
 * The Standard contradicted itself in text that ships (`docs/` is in `files`).
 *
 * The boundary was ruled 2026-08-20: **descriptive documents are extensible;
 * behavioural configuration is closed so that a typo fails loudly.**
 * `additionalProperties: false` on a file the engine reads is what makes
 * `counsil_profiles` an error rather than a silent no-op. That is a feature, and it
 * justifies the split exactly as it stands — so no schema changed. Only the text did,
 * plus this guard.
 *
 * ## Why there are two anchors and not one
 *
 * A guard that only checked the doc against the schema directory would pass if both
 * sides drifted together — someone hatching `council-config` and dutifully adding it
 * to the doc's list. A guard that only pinned the literal set would pass while the
 * prose drifted back to Work-Items-only, which is the exact defect being fixed here.
 * So: the SET is pinned literally against the ruling (below), and the DOC is checked
 * against the schema directory (further below). Each catches what the other cannot.
 */

type Shape = { name: string; hatched: boolean; open: boolean };

function schemaShapes(): Shape[] {
  return readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith('.schema.json'))
    .sort()
    .map((f) => {
      const j = JSON.parse(readFileSync(join(SCHEMA_DIR, f), 'utf-8')) as {
        properties?: Record<string, unknown>;
        additionalProperties?: unknown;
      };
      return {
        name: f.replace('.schema.json', ''),
        // The hatch is the declared `extensions` property at the ROOT of the schema.
        // Nested `additionalProperties` inside `$defs` are a different mechanism and
        // must not be mistaken for it.
        hatched: Boolean(j.properties && 'extensions' in j.properties),
        open: j.additionalProperties === true,
      };
    });
}

/**
 * Every `additionalProperties: true` that is NOT at the root of a schema, as
 * `name:path`. There is exactly one, and `docs/extensions.md` says so — which
 * makes it a load-bearing sentence with nothing holding it up unless this
 * derives the set rather than spot-checking the known one.
 */
function nestedOpenBags(): string[] {
  const found: string[] = [];
  for (const f of readdirSync(SCHEMA_DIR).filter((x) => x.endsWith('.schema.json')).sort()) {
    const name = f.replace('.schema.json', '');
    const doc = JSON.parse(readFileSync(join(SCHEMA_DIR, f), 'utf-8')) as unknown;
    (function walk(node: unknown, path: string): void {
      if (!node || typeof node !== 'object') return;
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (k === 'additionalProperties' && v === true && path !== '') found.push(`${name}:${path}`);
        walk(v, path ? `${path}.${k}` : k);
      }
    })(doc, '');
  }
  return found;
}

/**
 * The ruling, as a literal. Deriving this from the files would make the assertion
 * circular — it would pass for any arrangement of hatches whatsoever.
 */
const HATCHED = ['plan', 'project', 'rfc', 'spike', 'task', 'work-item'];

/**
 * Open by external or structural necessity, NOT by the descriptive/behavioural rule.
 * `problem` is RFC 7807, whose §3.2 mandates prefixed extension members — it already
 * ships `cloverleaf.failure_class` and `cloverleaf.work_item_id`. `work-item` is the
 * abstract parent of RFC/Spike/Plan/Task; closing it would reject its own children.
 * These two are the reason the split is three-way and not two-way, and the reason
 * every prior description of this item miscounted the closed set as 11.
 */
const OPEN = ['problem', 'work-item'];

/** No hatch and `additionalProperties: false`. Ten, not eleven. */
const CLOSED = [
  'council-config',
  'council-result',
  'dependency-dag',
  'extensions',
  'feedback',
  'gate-decision-event',
  'path-rules',
  'risk-classifier-rules',
  'status-transition-event',
  'status-transitions',
];

describe('the extension hatch is present on exactly the schemas the boundary allows', () => {
  const shapes = schemaShapes();

  it('reads every shipped schema', () => {
    // A directory read that silently returned nothing would make every set
    // comparison below compare two empty lists and pass.
    expect(shapes.length).toBe(17);
  });

  it('hatches exactly the descriptive documents', () => {
    // Asserts the SET. A guard that spot-checked the six known-hatched files
    // would stay green the moment a seventh schema appeared with a hatch.
    expect(shapes.filter((s) => s.hatched).map((s) => s.name)).toEqual(HATCHED);
  });

  it('leaves exactly two schemas open to arbitrary properties', () => {
    expect(shapes.filter((s) => s.open).map((s) => s.name)).toEqual(OPEN);
  });

  it('closes everything else', () => {
    expect(shapes.filter((s) => !s.hatched && !s.open).map((s) => s.name)).toEqual(CLOSED);
  });

  it('accounts for every schema exactly once', () => {
    // 5 hatched-and-closed + 2 open + 10 closed = 17. Without this, a schema
    // could be dropped from the directory and three set comparisons above would
    // still agree with each other.
    const union = new Set([...HATCHED, ...OPEN, ...CLOSED]);
    expect(union.size).toBe(shapes.length);
    expect([...union].sort()).toEqual(shapes.map((s) => s.name));
  });

  it('leaves exactly one nested open object, on feedback findings', () => {
    // A second would be a third way to accept arbitrary data that nothing had
    // ruled on, and would silently falsify the guide's claim that this is the
    // only one. feedback's envelope and its finding object are both closed;
    // only `metadata` is open, and it is a named field with a stated purpose.
    expect(nestedOpenBags()).toEqual(['feedback:$defs.finding.properties.metadata']);
  });

  it('keeps the hatch pointing at the shared meta-schema', () => {
    // The hatch means `$ref` to extensions.schema.json, not a locally redefined
    // object that happens to be called `extensions`.
    for (const name of HATCHED) {
      const j = JSON.parse(
        readFileSync(join(SCHEMA_DIR, `${name}.schema.json`), 'utf-8'),
      ) as { properties: Record<string, { $ref?: string }> };
      expect(j.properties.extensions.$ref, `${name} does not $ref the extensions meta-schema`)
        .toMatch(/extensions\.schema\.json$/);
    }
  });
});

/**
 * The doc half. `docs/extensions.md` states the boundary in two lists; they must
 * agree with what the schema files actually do. Both sides are external to each
 * other: the doc cannot satisfy this by restating itself.
 */
function docSection(heading: string): string {
  const doc = readFileSync(DOC, 'utf-8');
  const start = doc.indexOf(heading);
  if (start === -1) return '';
  const rest = doc.slice(start + heading.length);
  const end = rest.search(/^#{2,3} /m);
  return end === -1 ? rest : rest.slice(0, end);
}

/** Top-level bullets that name a schema, e.g. "- `project` — …". */
function bulletedSchemas(section: string): string[] {
  return [...section.matchAll(/^- `([a-z][a-z-]*)`/gm)].map((m) => m[1]).sort();
}

const HATCHED_HEADING = '### Schemas that carry the hatch';
const CLOSED_HEADING = '### Schemas that are deliberately closed';
const OTHER_HEADING = '### Other places arbitrary data is accepted';

describe('docs/extensions.md describes the boundary the schemas implement', () => {
  const shapes = schemaShapes();

  it('contains both boundary sections', () => {
    // If either heading is reworded away, the extractions below would return
    // empty lists and the parity assertions would compare nothing to nothing.
    expect(docSection(HATCHED_HEADING), `missing "${HATCHED_HEADING}"`).not.toBe('');
    expect(docSection(CLOSED_HEADING), `missing "${CLOSED_HEADING}"`).not.toBe('');
  });

  it('lists exactly the schemas that carry the hatch', () => {
    expect(bulletedSchemas(docSection(HATCHED_HEADING))).toEqual(
      shapes.filter((s) => s.hatched).map((s) => s.name).sort(),
    );
  });

  it('lists exactly the schemas that are closed', () => {
    expect(bulletedSchemas(docSection(CLOSED_HEADING))).toEqual(
      shapes.filter((s) => !s.hatched && !s.open).map((s) => s.name).sort(),
    );
  });

  it('names project as a hatched schema that is not a Work Item', () => {
    // The specific fact the old text denied, and the reason this guard exists.
    // Parity alone would be satisfied by a list; this pins the explanation.
    expect(docSection(HATCHED_HEADING)).toMatch(/`project`/);
  });

  it('names every schema that accepts arbitrary data outside the hatch', () => {
    // Derived, not listed: the two root-open schemas plus whoever owns a nested
    // open bag. If a schema opens up and the guide does not mention it, the
    // guide's account of where arbitrary data may go stops being complete.
    const owners = new Set([
      ...shapes.filter((s2) => s2.open).map((s2) => s2.name),
      ...nestedOpenBags().map((b) => b.split(':')[0]),
    ]);
    expect(docSection(OTHER_HEADING), `missing "${OTHER_HEADING}"`).not.toBe('');
    expect(bulletedSchemas(docSection(OTHER_HEADING))).toEqual([...owners].sort());
  });

  it('no longer scopes the mechanism to Work Items alone', () => {
    // The exact sentence that shipped the contradiction. Pinned as forbidden
    // rather than left to be rediscovered.
    const doc = readFileSync(DOC, 'utf-8');
    expect(doc).not.toMatch(/All extensions live under the `extensions` field\*\* on a Work Item/);
  });

  it('still states the namespacing rule', () => {
    // Guards against "fixing" the scope claim by deleting the Rules section.
    expect(readFileSync(DOC, 'utf-8')).toMatch(/namespaced/i);
  });
});

describe('the extensions meta-schema describes its own scope correctly', () => {
  const meta = JSON.parse(
    readFileSync(join(SCHEMA_DIR, 'extensions.schema.json'), 'utf-8'),
  ) as { description: string };

  it('does not claim the hatch is for Work Items only', () => {
    // `project` $refs this schema and is not a Work Item.
    expect(meta.description).not.toMatch(/on Work Items/);
  });

  it('still documents the namespace convention', () => {
    // The description carries the one rule a consumer must know. Widening the
    // scope claim must not cost that.
    expect(meta.description).toMatch(/team\.field/);
  });
});
