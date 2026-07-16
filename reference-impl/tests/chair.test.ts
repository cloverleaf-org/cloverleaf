import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveChairPrompt, buildChairContext, finalizeChairVerdict } from '../lib/chair.js';
import type { MemberVerdict } from '../lib/aggregation.js';

describe('resolveChairPrompt', () => {
  it('omitted chair → built-in prompts/chair.md', () => {
    expect(resolveChairPrompt(undefined, '/x').endsWith('/prompts/chair.md')).toBe(true);
    expect(resolveChairPrompt({}, '/x').endsWith('/prompts/chair.md')).toBe(true);
  });
  it('custom chair.prompt resolves under .cloverleaf/prompts and exist-checks', () => {
    const repo = mkdtempSync(join(tmpdir(), 'clv-chair-'));
    try {
      mkdirSync(join(repo, '.cloverleaf', 'prompts'), { recursive: true });
      writeFileSync(join(repo, '.cloverleaf', 'prompts', 'my-chair.md'), '# chair');
      expect(resolveChairPrompt({ prompt: 'my-chair.md' }, repo)).toBe(join(repo, '.cloverleaf', 'prompts', 'my-chair.md'));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
  it('throws when a custom chair prompt is missing', () => {
    const repo = mkdtempSync(join(tmpdir(), 'clv-chair-miss-'));
    try {
      expect(() => resolveChairPrompt({ prompt: 'ghost.md' }, repo)).toThrow(/chair prompt not found/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('buildChairContext', () => {
  it('renders each member verdict + its findings', () => {
    const out = buildChairContext([
      { member: 'security', verdict: 'bounce', blocking: true, weight: 1,
        envelope: { summary: 'leaked key', findings: [{ severity: 'blocker', message: 'API key in code', location: { file: 'a.ts', line: 3 } }] } },
      { member: 'qa', verdict: 'pass' },
    ]);
    expect(out).toContain('security — bounce');
    expect(out).toContain('leaked key');
    expect(out).toContain('(blocker) API key in code [a.ts:3]');
    expect(out).toContain('qa — pass');
  });

  it('tags each member as blocking/advisory with its weight', () => {
    const out = buildChairContext([
      { member: 'security', verdict: 'bounce', blocking: true, weight: 1 },
      { member: 'perf', verdict: 'pass', blocking: false, weight: 2 },
    ]);
    expect(out).toContain('security — bounce (blocking, weight 1)');
    expect(out).toContain('perf — pass (advisory, weight 2)');
  });
});

describe('finalizeChairVerdict', () => {
  const members: MemberVerdict[] = [{ member: 'reviewer', verdict: 'pass' }, { member: 'security', verdict: 'bounce' }];
  it('normalizes a bounce with a forward list, tagging rule=chair', () => {
    const v = finalizeChairVerdict({ verdict: 'bounce', rationale: 'fix security', forward: ['security'] }, members);
    expect(v.rule).toBe('chair');
    expect(v.verdict).toBe('bounce');
    expect(v.forward).toEqual(['security']);
    expect(v.members).toBe(members);
  });
  it('lets the chair RAISE to escalate', () => {
    expect(finalizeChairVerdict({ verdict: 'escalate', rationale: 'human needed' }, members).verdict).toBe('escalate');
  });
  it('re-asserts the escalate invariant: a member escalate forces escalate regardless of chair', () => {
    const withEscalate: MemberVerdict[] = [{ member: 'security', verdict: 'escalate' }];
    const v = finalizeChairVerdict({ verdict: 'pass', rationale: 'ignore it' }, withEscalate);
    expect(v.verdict).toBe('escalate');
    expect(v.rationale).toMatch(/cannot lower/);
  });
  it('omits forward on a pass', () => {
    expect(finalizeChairVerdict({ verdict: 'pass', rationale: 'ok' }, members).forward).toBeUndefined();
  });
  it('throws on an invalid verdict', () => {
    expect(() => finalizeChairVerdict({ verdict: 'maybe' as never, rationale: 'x' }, members)).toThrow(/invalid verdict/);
  });
  it('throws when forward names a non-member', () => {
    expect(() => finalizeChairVerdict({ verdict: 'bounce', rationale: 'x', forward: ['ghost'] }, members)).toThrow(/unknown member/);
  });
  it('throws when the raw chair output is not an object', () => {
    expect(() => finalizeChairVerdict(null as never, members)).toThrow(/not an object/);
  });
  it('falls back to an empty rationale when raw.rationale is not a string', () => {
    const v = finalizeChairVerdict({ verdict: 'pass', rationale: 123 as never }, members);
    expect(v.rationale).toBe('');
  });
});
