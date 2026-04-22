import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFeedback, latestFeedback, allFeedback, type FeedbackEnvelope, type Finding } from '../lib/feedback.js';

function envelope(verdict: 'pass' | 'bounce' | 'escalate', summary = 'x'): FeedbackEnvelope {
  return {
    verdict,
    summary,
    findings: verdict === 'bounce'
      ? [{ severity: 'error', message: 'missing test for zero input' }]
      : [],
  };
}

describe('feedback', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'cloverleaf-fb-'));
    mkdirSync(join(repoRoot, '.cloverleaf', 'feedback'), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('writes a feedback file with r1 for the first bounce', () => {
    const path = writeFeedback(repoRoot, {
      project: 'ACME',
      taskId: 'ACME-001',
      envelope: envelope('bounce', 'first bounce'),
    });
    expect(path).toMatch(/ACME-001-r1\.json$/);
    const doc = JSON.parse(readFileSync(path, 'utf-8'));
    expect(doc.verdict).toBe('bounce');
  });

  it('increments iteration on repeated bounces', () => {
    writeFeedback(repoRoot, {
      project: 'ACME', taskId: 'ACME-001', envelope: envelope('bounce'),
    });
    const path = writeFeedback(repoRoot, {
      project: 'ACME', taskId: 'ACME-001', envelope: envelope('bounce'),
    });
    expect(path).toMatch(/ACME-001-r2\.json$/);
  });

  it('latestFeedback returns the highest iteration', () => {
    writeFeedback(repoRoot, { project: 'ACME', taskId: 'ACME-001', envelope: envelope('bounce', 'r1') });
    writeFeedback(repoRoot, { project: 'ACME', taskId: 'ACME-001', envelope: envelope('bounce', 'r2') });
    const latest = latestFeedback(repoRoot, 'ACME-001');
    expect(latest?.summary).toBe('r2');
  });

  it('latestFeedback returns null when no feedback exists', () => {
    expect(latestFeedback(repoRoot, 'ACME-999')).toBeNull();
  });

  it('allFeedback returns items ordered by iteration', () => {
    writeFeedback(repoRoot, { project: 'ACME', taskId: 'ACME-001', envelope: envelope('bounce', 'r1') });
    writeFeedback(repoRoot, { project: 'ACME', taskId: 'ACME-001', envelope: envelope('bounce', 'r2') });
    writeFeedback(repoRoot, { project: 'ACME', taskId: 'ACME-001', envelope: envelope('pass', 'r3') });
    const items = allFeedback(repoRoot, 'ACME-001');
    expect(items.map((f) => f.summary)).toEqual(['r1', 'r2', 'r3']);
  });

  it('creates feedback directory if it does not exist', () => {
    rmSync(join(repoRoot, '.cloverleaf', 'feedback'), { recursive: true, force: true });
    const path = writeFeedback(repoRoot, {
      project: 'ACME',
      taskId: 'ACME-001',
      envelope: { verdict: 'pass', findings: [] },
    });
    expect(existsSync(path)).toBe(true);
  });
});

describe('latestFeedback — v0.4.1 #2 (multi-prefix)', () => {
  it('returns highest iteration across r / u / q prefixes', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'clv-latest-fb-'));
    try {
      const fbDir = join(repoRoot, '.cloverleaf', 'feedback');
      mkdirSync(fbDir, { recursive: true });
      writeFileSync(join(fbDir, 'ACME-042-r1.json'), JSON.stringify({ verdict: 'bounce', summary: 'r1' }));
      writeFileSync(join(fbDir, 'ACME-042-u1.json'), JSON.stringify({ verdict: 'bounce', summary: 'u1' }));
      writeFileSync(join(fbDir, 'ACME-042-r2.json'), JSON.stringify({ verdict: 'bounce', summary: 'r2' }));
      writeFileSync(join(fbDir, 'ACME-042-q1.json'), JSON.stringify({ verdict: 'pass',   summary: 'q1' }));

      const result = latestFeedback(repoRoot, 'ACME-042');
      expect(result).not.toBeNull();
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('returns u-prefixed feedback when only u-prefix files exist (validates bug fix)', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'clv-latest-fb-'));
    try {
      const fbDir = join(repoRoot, '.cloverleaf', 'feedback');
      mkdirSync(fbDir, { recursive: true });
      writeFileSync(join(fbDir, 'ACME-042-u1.json'), JSON.stringify({ verdict: 'bounce', summary: 'u1-surface' }));

      // Before the fix, this returned null because the regex only matched -r prefixes.
      const result = latestFeedback(repoRoot, 'ACME-042');
      expect(result).not.toBeNull();
      expect(result!.summary).toBe('u1-surface');
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('returns q-prefixed feedback when only q-prefix files exist', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'clv-latest-fb-'));
    try {
      const fbDir = join(repoRoot, '.cloverleaf', 'feedback');
      mkdirSync(fbDir, { recursive: true });
      writeFileSync(join(fbDir, 'ACME-042-q1.json'), JSON.stringify({ verdict: 'bounce', summary: 'q1-surface' }));

      const result = latestFeedback(repoRoot, 'ACME-042');
      expect(result).not.toBeNull();
      expect(result!.summary).toBe('q1-surface');
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

describe('Finding type — v0.4.0 additions', () => {
  it('accepts attachments + metadata on a finding', () => {
    const f: Finding = {
      severity: 'info',
      message: 'visual diff',
      rule: 'visual-diff',
      metadata: { route: '/faq/', viewport: 'mobile', diffRatio: 0.034 },
      attachments: [
        { label: 'baseline', path: '.cloverleaf/baselines/faq-mobile.png' },
        { label: 'diff',     path: '.cloverleaf/runs/X/ui-review/diff-faq-mobile.png' },
      ],
    };
    expect(f.attachments).toHaveLength(2);
    expect(f.metadata?.diffRatio).toBe(0.034);
  });
});
