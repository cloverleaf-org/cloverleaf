import { describe, it, expect } from 'vitest';
import { slugifyRoute } from '../lib/route-slug.js';

describe('slugifyRoute', () => {
  it('maps root to "index"', () => {
    expect(slugifyRoute('/')).toBe('index');
  });

  it('strips leading and trailing slashes', () => {
    expect(slugifyRoute('/faq/')).toBe('faq');
    expect(slugifyRoute('/guide/')).toBe('guide');
  });

  it('joins nested paths with hyphens', () => {
    expect(slugifyRoute('/guide/chapter-3/')).toBe('guide-chapter-3');
    expect(slugifyRoute('/a/b/c/')).toBe('a-b-c');
  });

  it('strips query strings and hash fragments', () => {
    expect(slugifyRoute('/faq/?x=1')).toBe('faq');
    expect(slugifyRoute('/faq/#top')).toBe('faq');
  });

  it('handles missing trailing slash', () => {
    expect(slugifyRoute('/faq')).toBe('faq');
  });

  it('lowercases', () => {
    expect(slugifyRoute('/Guide/Chapter-3/')).toBe('guide-chapter-3');
  });

  it('replaces disallowed characters with hyphens', () => {
    expect(slugifyRoute('/docs/v1.2/getting started/')).toBe('docs-v1-2-getting-started');
  });

  it('collapses adjacent hyphens', () => {
    expect(slugifyRoute('/a//b/')).toBe('a-b');
  });
});
