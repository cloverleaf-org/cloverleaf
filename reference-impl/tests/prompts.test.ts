import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PROMPTS = resolve(__dirname, '..', 'prompts');

function readPrompt(name: string): string {
  return readFileSync(resolve(PROMPTS, `${name}.md`), 'utf-8');
}

describe('documenter prompt', () => {
  const body = readPrompt('documenter');

  it('has all required placeholders', () => {
    expect(body).toContain('{{task}}');
    expect(body).toContain('{{diff}}');
    expect(body).toContain('{{repo_root}}');
    expect(body).toContain('{{branch}}');
    expect(body).toContain('{{base_branch}}');
  });

  it('has no stale placeholders', () => {
    expect(body).not.toMatch(/\{\{[^}]*TODO[^}]*\}\}/);
    expect(body).not.toMatch(/XXX|TBD/);
  });

  it('specifies JSON output format', () => {
    expect(body.toLowerCase()).toMatch(/commits_added/);
    expect(body.toLowerCase()).toMatch(/files_changed/);
    expect(body.toLowerCase()).toMatch(/summary/);
  });

  it('forbids touching source code', () => {
    expect(body.toLowerCase()).toMatch(/doc.*only|no source|docs? only/);
  });

  it('explains CHANGELOG update rules', () => {
    expect(body).toContain('CHANGELOG');
    expect(body).toMatch(/Unreleased/);
  });

  it('lists the per-package file-path rules', () => {
    expect(body).toContain('standard/');
    expect(body).toContain('reference-impl/');
    expect(body).toContain('site/');
  });
});

describe('ui-reviewer prompt', () => {
  const body = readPrompt('ui-reviewer');

  it('has required placeholders', () => {
    expect(body).toContain('{{task}}');
    expect(body).toContain('{{diff}}');
    expect(body).toContain('{{branch}}');
    expect(body).toContain('{{repo_root}}');
    expect(body).toContain('{{preview_port}}');
    expect(body).toContain('{{base_branch}}');
  });

  it('has no stale placeholders', () => {
    expect(body).not.toMatch(/\{\{[^}]*TODO[^}]*\}\}/);
    expect(body).not.toMatch(/XXX|TBD/);
  });

  it('mentions Playwright and axe-core', () => {
    expect(body.toLowerCase()).toContain('playwright');
    expect(body.toLowerCase()).toContain('axe');
  });

  it('specifies a11y rule prefix and severity mapping', () => {
    expect(body).toContain('a11y.');
    expect(body).toMatch(/critical.*blocker/i);
    expect(body).toMatch(/serious.*error/i);
  });

  it('specifies verdict/findings output envelope', () => {
    expect(body).toContain('verdict');
    expect(body).toContain('findings');
    expect(body).toMatch(/pass|bounce|escalate/);
  });

  it('documents the 20-page cap and single viewport', () => {
    expect(body).toMatch(/20.*pages?|cap.*20/);
    expect(body).toMatch(/1280.*800/);
  });

  it('forbids touching source code', () => {
    expect(body.toLowerCase()).toMatch(/read[-\s]only|do not.*(modify|edit).*source/);
  });

  it('does not tell agents to emit location as a URL string (schema requires object)', () => {
    expect(body).not.toMatch(/"location":\s*"<url/);
    expect(body).toMatch(/location.*object|omit.*location/i);
  });
});

describe('qa prompt', () => {
  const body = readPrompt('qa');

  it('has required placeholders', () => {
    expect(body).toContain('{{task}}');
    expect(body).toContain('{{diff}}');
    expect(body).toContain('{{branch}}');
    expect(body).toContain('{{repo_root}}');
    expect(body).toContain('{{qa_rules}}');
    expect(body).toContain('{{base_branch}}');
  });

  it('has no stale placeholders', () => {
    expect(body).not.toMatch(/\{\{[^}]*TODO[^}]*\}\}/);
    expect(body).not.toMatch(/XXX|TBD/);
  });

  it('specifies no-browser / test-runner mode', () => {
    expect(body.toLowerCase()).toMatch(/no.*browser|test.*runner|vitest|npm test/);
  });

  it('specifies sentinel preview_uri', () => {
    expect(body).toMatch(/about:blank|sentinel/);
  });

  it('specifies pass|bounce|escalate verdicts', () => {
    expect(body).toContain('pass');
    expect(body).toContain('bounce');
    expect(body).toContain('escalate');
  });

  it('specifies results aggregation shape', () => {
    expect(body).toContain('passed');
    expect(body).toContain('failed');
    expect(body).toContain('total');
  });

  it('explains git worktree discipline', () => {
    expect(body.toLowerCase()).toMatch(/git worktree/);
  });

  it('explains nothing-testable case', () => {
    expect(body.toLowerCase()).toMatch(/nothing.*testable|skip|no match/);
  });
});
