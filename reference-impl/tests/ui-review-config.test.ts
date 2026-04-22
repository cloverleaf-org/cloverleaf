import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadUiReviewConfig } from '../lib/ui-review-config.js';

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'clv-ui-review-'));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('loadUiReviewConfig', () => {
  it('falls back to package default when no consumer override exists', () => {
    const cfg = loadUiReviewConfig(repoRoot);
    expect(cfg.viewports.desktop).toEqual({ width: 1280, height: 800 });
    expect(cfg.viewports.mobile).toEqual({ width: 375, height: 667 });
    expect(cfg.viewports.tablet).toEqual({ width: 768, height: 1024 });
    expect(cfg.visualDiff.enabled).toBe(true);
    expect(cfg.visualDiff.threshold).toBe(0.1);
    expect(cfg.visualDiff.maxDiffRatio).toBe(0.01);
    expect(cfg.visualDiff.mask).toEqual([]);
    expect(cfg.axe.viewports).toEqual(['desktop']);
    expect(cfg.axe.dedupeBy).toEqual(['ruleId', 'target']);
  });

  it('uses consumer override verbatim when present', () => {
    mkdirSync(join(repoRoot, '.cloverleaf', 'config'), { recursive: true });
    const override = {
      viewports: { desktop: { width: 1440, height: 900 } },
      visualDiff: { enabled: false, threshold: 0.2, maxDiffRatio: 0.02, mask: ['.timestamp'] },
      axe: { viewports: ['desktop'], dedupeBy: ['ruleId', 'target'] },
    };
    writeFileSync(
      join(repoRoot, '.cloverleaf', 'config', 'ui-review.json'),
      JSON.stringify(override, null, 2),
    );
    const cfg = loadUiReviewConfig(repoRoot);
    expect(cfg.viewports).toEqual({ desktop: { width: 1440, height: 900 } });
    expect(cfg.visualDiff.enabled).toBe(false);
    expect(cfg.visualDiff.mask).toEqual(['.timestamp']);
  });

  it('falls through to package default if consumer override is malformed JSON', () => {
    mkdirSync(join(repoRoot, '.cloverleaf', 'config'), { recursive: true });
    writeFileSync(join(repoRoot, '.cloverleaf', 'config', 'ui-review.json'), '{ not json }');
    const cfg = loadUiReviewConfig(repoRoot);
    expect(cfg.viewports.desktop).toEqual({ width: 1280, height: 800 });
  });

  describe('axe.ignored (v0.4.1 #6)', () => {
    it('default config has axe.ignored as empty array', () => {
      const cfg = loadUiReviewConfig(repoRoot);
      expect(cfg.axe.ignored).toEqual([]);
    });

    it('consumer override can populate axe.ignored', () => {
      mkdirSync(join(repoRoot, '.cloverleaf', 'config'), { recursive: true });
      writeFileSync(
        join(repoRoot, '.cloverleaf', 'config', 'ui-review.json'),
        JSON.stringify({
          viewports: { desktop: { width: 1280, height: 800 } },
          visualDiff: { enabled: true, threshold: 0.1, maxDiffRatio: 0.01, mask: [] },
          axe: {
            viewports: ['desktop'],
            dedupeBy: ['ruleId', 'target'],
            ignored: [{ ruleId: 'color-contrast', target: '.step-meta' }],
          },
        }),
      );
      const cfg = loadUiReviewConfig(repoRoot);
      expect(cfg.axe.ignored).toEqual([{ ruleId: 'color-contrast', target: '.step-meta' }]);
    });

    it('missing axe.ignored in override falls back to empty array', () => {
      mkdirSync(join(repoRoot, '.cloverleaf', 'config'), { recursive: true });
      writeFileSync(
        join(repoRoot, '.cloverleaf', 'config', 'ui-review.json'),
        JSON.stringify({
          viewports: { desktop: { width: 1280, height: 800 } },
          visualDiff: { enabled: true, threshold: 0.1, maxDiffRatio: 0.01, mask: [] },
          axe: {
            viewports: ['desktop'],
            dedupeBy: ['ruleId', 'target'],
            // ignored omitted — back-compat for older overrides
          },
        }),
      );
      const cfg = loadUiReviewConfig(repoRoot);
      expect(cfg.axe.ignored).toEqual([]);
    });
  });
});
