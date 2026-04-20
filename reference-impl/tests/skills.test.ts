import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SKILLS_DIR = resolve(__dirname, '..', 'skills');

function readSkill(name: string): string {
  return readFileSync(resolve(SKILLS_DIR, `${name}.md`), 'utf-8');
}

describe('cloverleaf-new-task skill', () => {
  const body = readSkill('cloverleaf-new-task');

  it('enumerates the risk_class inference keyword list', () => {
    const keywords = [
      'site/', 'UI', 'page', 'component', 'style',
      'visual', 'layout', 'render', 'display',
      'accessibility', 'a11y', 'responsive',
      '.astro', '.css', '.html',
    ];
    for (const kw of keywords) {
      expect(body, `skill must mention keyword '${kw}'`).toContain(kw);
    }
  });

  it('documents the --risk=high|low override', () => {
    expect(body).toMatch(/--risk=high/);
    expect(body).toMatch(/--risk=low/);
  });

  it('reports inferred risk_class to the user', () => {
    expect(body.toLowerCase()).toMatch(/risk class|risk_class/);
    expect(body).toMatch(/override/i);
  });
});
