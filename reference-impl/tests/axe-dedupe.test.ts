import { describe, it, expect } from 'vitest';
import { dedupeAxeFindings, type RawAxeFinding } from '../lib/axe-dedupe.js';

describe('dedupeAxeFindings', () => {
  const findingAt = (viewport: string, ruleId: string, target: string, extras: Partial<RawAxeFinding> = {}): RawAxeFinding => ({
    viewport,
    ruleId,
    target,
    impact: 'serious',
    message: `${ruleId} on ${target}`,
    helpUrl: `https://example/${ruleId}`,
    ...extras,
  });

  it('aggregates identical (ruleId, target) across viewports into one deduped finding', () => {
    const raws = [
      findingAt('mobile',  'color-contrast', 'button.primary'),
      findingAt('tablet',  'color-contrast', 'button.primary'),
      findingAt('desktop', 'color-contrast', 'button.primary'),
    ];
    const out = dedupeAxeFindings(raws, ['ruleId', 'target']);
    expect(out).toHaveLength(1);
    expect(out[0].metadata?.viewports).toEqual(['mobile', 'tablet', 'desktop']);
    expect(out[0].metadata?.target).toBe('button.primary');
    expect(out[0].rule).toBe('color-contrast');
  });

  it('keeps distinct findings when target differs', () => {
    const raws = [
      findingAt('mobile',  'color-contrast', 'button.primary'),
      findingAt('desktop', 'color-contrast', 'button.secondary'),
    ];
    const out = dedupeAxeFindings(raws, ['ruleId', 'target']);
    expect(out).toHaveLength(2);
  });

  it('keeps distinct findings when ruleId differs', () => {
    const raws = [
      findingAt('desktop', 'color-contrast',  'button.primary'),
      findingAt('desktop', 'aria-label',      'button.primary'),
    ];
    const out = dedupeAxeFindings(raws, ['ruleId', 'target']);
    expect(out).toHaveLength(2);
  });

  it('preserves the first occurrence impact/helpUrl/message when dedupe collides', () => {
    const raws = [
      findingAt('mobile',  'color-contrast', 'x', { impact: 'serious',  message: 'first' }),
      findingAt('desktop', 'color-contrast', 'x', { impact: 'critical', message: 'second' }),
    ];
    const out = dedupeAxeFindings(raws, ['ruleId', 'target']);
    expect(out).toHaveLength(1);
    expect(out[0].metadata?.impact).toBe('serious');
    expect(out[0].message).toBe('first');
  });

  it('produces deterministic viewport order matching input order', () => {
    const raws = [
      findingAt('desktop', 'r', 't'),
      findingAt('mobile',  'r', 't'),
    ];
    const out = dedupeAxeFindings(raws, ['ruleId', 'target']);
    expect(out[0].metadata?.viewports).toEqual(['desktop', 'mobile']);
  });

  it('dedupeBy=["ruleId"] collapses different targets into one finding', () => {
    const raws = [
      findingAt('mobile',  'color-contrast', 'button.primary'),
      findingAt('mobile',  'color-contrast', 'button.secondary'),
    ];
    const out = dedupeAxeFindings(raws, ['ruleId']);
    expect(out).toHaveLength(1);
  });

  it('maps impact to severity: critical→blocker, serious→error, moderate→warning, minor→info', () => {
    const raws = [
      findingAt('desktop', 'r1', 't1', { impact: 'critical' }),
      findingAt('desktop', 'r2', 't2', { impact: 'serious' }),
      findingAt('desktop', 'r3', 't3', { impact: 'moderate' }),
      findingAt('desktop', 'r4', 't4', { impact: 'minor' }),
    ];
    const out = dedupeAxeFindings(raws, ['ruleId', 'target']);
    expect(out.map(f => f.severity)).toEqual(['blocker', 'error', 'warning', 'info']);
  });
});
