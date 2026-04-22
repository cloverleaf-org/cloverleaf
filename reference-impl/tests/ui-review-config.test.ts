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

  // -------------------------------------------------------------------------
  // CLV-16: browsers, axe.browser, maxCombinations — new fields + back-compat
  // -------------------------------------------------------------------------

  describe('browsers (CLV-16)', () => {
    it('default config resolves browsers to ["chromium"]', () => {
      const cfg = loadUiReviewConfig(repoRoot);
      expect(cfg.browsers).toEqual(['chromium']);
    });

    it('a legacy config omitting "browsers" resolves to ["chromium"]', () => {
      mkdirSync(join(repoRoot, '.cloverleaf', 'config'), { recursive: true });
      // A legacy config — browsers key absent
      writeFileSync(
        join(repoRoot, '.cloverleaf', 'config', 'ui-review.json'),
        JSON.stringify({
          viewports: { desktop: { width: 1280, height: 800 } },
          visualDiff: { enabled: true, threshold: 0.1, maxDiffRatio: 0.01, mask: [] },
          axe: { viewports: ['desktop'], dedupeBy: ['ruleId', 'target'] },
        }),
      );
      const cfg = loadUiReviewConfig(repoRoot);
      expect(cfg.browsers).toEqual(['chromium']);
    });

    it('a config explicitly setting browsers to all three engines passes through', () => {
      mkdirSync(join(repoRoot, '.cloverleaf', 'config'), { recursive: true });
      writeFileSync(
        join(repoRoot, '.cloverleaf', 'config', 'ui-review.json'),
        JSON.stringify({
          browsers: ['chromium', 'webkit', 'firefox'],
          viewports: { desktop: { width: 1280, height: 800 } },
          visualDiff: { enabled: true, threshold: 0.1, maxDiffRatio: 0.01, mask: [] },
          axe: { viewports: ['desktop'], dedupeBy: ['ruleId', 'target'] },
        }),
      );
      const cfg = loadUiReviewConfig(repoRoot);
      expect(cfg.browsers).toEqual(['chromium', 'webkit', 'firefox']);
    });
  });

  describe('axe.browser (CLV-16)', () => {
    it('default config resolves axe.browser to "chromium"', () => {
      const cfg = loadUiReviewConfig(repoRoot);
      expect(cfg.axe.browser).toBe('chromium');
    });

    it('a legacy config omitting "axe.browser" resolves to "chromium"', () => {
      mkdirSync(join(repoRoot, '.cloverleaf', 'config'), { recursive: true });
      writeFileSync(
        join(repoRoot, '.cloverleaf', 'config', 'ui-review.json'),
        JSON.stringify({
          viewports: { desktop: { width: 1280, height: 800 } },
          visualDiff: { enabled: true, threshold: 0.1, maxDiffRatio: 0.01, mask: [] },
          axe: { viewports: ['desktop'], dedupeBy: ['ruleId', 'target'] },
        }),
      );
      const cfg = loadUiReviewConfig(repoRoot);
      expect(cfg.axe.browser).toBe('chromium');
    });

    it('a config setting axe.browser to "webkit" passes through', () => {
      mkdirSync(join(repoRoot, '.cloverleaf', 'config'), { recursive: true });
      writeFileSync(
        join(repoRoot, '.cloverleaf', 'config', 'ui-review.json'),
        JSON.stringify({
          viewports: { desktop: { width: 1280, height: 800 } },
          visualDiff: { enabled: true, threshold: 0.1, maxDiffRatio: 0.01, mask: [] },
          axe: { viewports: ['desktop'], browser: 'webkit', dedupeBy: ['ruleId', 'target'] },
        }),
      );
      const cfg = loadUiReviewConfig(repoRoot);
      expect(cfg.axe.browser).toBe('webkit');
    });
  });

  describe('maxCombinations (CLV-16)', () => {
    it('default config resolves maxCombinations to 90', () => {
      const cfg = loadUiReviewConfig(repoRoot);
      expect(cfg.maxCombinations).toBe(90);
    });

    it('a legacy config omitting "maxCombinations" resolves to 90', () => {
      mkdirSync(join(repoRoot, '.cloverleaf', 'config'), { recursive: true });
      writeFileSync(
        join(repoRoot, '.cloverleaf', 'config', 'ui-review.json'),
        JSON.stringify({
          viewports: { desktop: { width: 1280, height: 800 } },
          visualDiff: { enabled: true, threshold: 0.1, maxDiffRatio: 0.01, mask: [] },
          axe: { viewports: ['desktop'], dedupeBy: ['ruleId', 'target'] },
        }),
      );
      const cfg = loadUiReviewConfig(repoRoot);
      expect(cfg.maxCombinations).toBe(90);
    });

    it('a config setting maxCombinations to 45 passes through', () => {
      mkdirSync(join(repoRoot, '.cloverleaf', 'config'), { recursive: true });
      writeFileSync(
        join(repoRoot, '.cloverleaf', 'config', 'ui-review.json'),
        JSON.stringify({
          browsers: ['chromium', 'webkit', 'firefox'],
          maxCombinations: 45,
          viewports: { desktop: { width: 1280, height: 800 } },
          visualDiff: { enabled: true, threshold: 0.1, maxDiffRatio: 0.01, mask: [] },
          axe: { viewports: ['desktop'], dedupeBy: ['ruleId', 'target'] },
        }),
      );
      const cfg = loadUiReviewConfig(repoRoot);
      expect(cfg.maxCombinations).toBe(45);
      expect(cfg.browsers).toEqual(['chromium', 'webkit', 'firefox']);
    });
  });

  describe('full legacy config backward-compatibility (CLV-16)', () => {
    it('a config with only legacy keys resolves all new keys to their defaults', () => {
      mkdirSync(join(repoRoot, '.cloverleaf', 'config'), { recursive: true });
      // Simulates a consumer config written before CLV-16 — no browsers, axe.browser, maxCombinations
      const legacyConfig = {
        viewports: {
          mobile:  { width: 375,  height: 667 },
          tablet:  { width: 768,  height: 1024 },
          desktop: { width: 1280, height: 800 },
        },
        visualDiff: {
          enabled: true,
          threshold: 0.1,
          maxDiffRatio: 0.01,
          mask: [],
        },
        axe: {
          viewports: ['desktop'],
          dedupeBy: ['ruleId', 'target'],
          ignored: [],
        },
      };
      writeFileSync(
        join(repoRoot, '.cloverleaf', 'config', 'ui-review.json'),
        JSON.stringify(legacyConfig, null, 2),
      );
      const cfg = loadUiReviewConfig(repoRoot);
      // New keys must resolve to defaults
      expect(cfg.browsers).toEqual(['chromium']);
      expect(cfg.axe.browser).toBe('chromium');
      expect(cfg.maxCombinations).toBe(90);
      // Legacy keys must be preserved verbatim
      expect(cfg.viewports.desktop).toEqual({ width: 1280, height: 800 });
      expect(cfg.axe.viewports).toEqual(['desktop']);
    });
  });
});
