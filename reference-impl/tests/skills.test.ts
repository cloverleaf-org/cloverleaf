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

describe('cloverleaf-document skill', () => {
  const body = readSkill('cloverleaf-document');

  it('has valid frontmatter with name and description', () => {
    expect(body).toMatch(/^---[\s\S]*?name: cloverleaf-document[\s\S]*?---/);
    expect(body).toMatch(/description:.*Documenter/);
  });

  it('dispatches subagent with documenter prompt', () => {
    expect(body).toMatch(/prompts\/documenter\.md/);
    expect(body).toMatch(/subagent_type.*general-purpose/);
    expect(body).toMatch(/model.*sonnet/);
  });

  it('verifies task state is implementing', () => {
    expect(body).toMatch(/status.*implementing/);
  });

  it('enforces risk_class === "high" (full pipeline only)', () => {
    expect(body).toMatch(/risk_class.*high|high.*risk_class/);
  });

  it('advances state implementing → documenting → review after success', () => {
    expect(body).toContain('documenting');
    expect(body).toContain('review');
  });

  it('expects JSON response with commits_added', () => {
    expect(body).toContain('commits_added');
  });
});

describe('cloverleaf-implement skill (v0.2 path-aware)', () => {
  const body = readSkill('cloverleaf-implement');

  it('reads risk_class after load-task', () => {
    expect(body).toContain('risk_class');
  });

  it('stops at implementing for risk_class=high', () => {
    expect(body).toMatch(/risk_class.*high|high.*risk_class/);
    expect(body).toMatch(/stop.*implementing|state.*implementing|Next.*document/i);
  });

  it('batches to review for risk_class=low', () => {
    expect(body).toMatch(/risk_class.*low|low.*fast|fast.*lane/i);
    expect(body).toMatch(/review/);
  });
});

describe('cloverleaf-ui-review skill', () => {
  const body = readSkill('cloverleaf-ui-review');

  it('has valid frontmatter with name and description', () => {
    expect(body).toMatch(/^---[\s\S]*?name: cloverleaf-ui-review[\s\S]*?---/);
    expect(body).toMatch(/description:.*UI/i);
  });

  it('dispatches subagent with ui-reviewer prompt', () => {
    expect(body).toMatch(/prompts\/ui-reviewer\.md/);
    expect(body).toMatch(/subagent_type.*general-purpose/);
  });

  it('reads preview port from getFreePort CLI or ports lib', () => {
    expect(body).toMatch(/preview_port|free.*port|getFreePort/);
  });

  it('verifies task state is ui-review', () => {
    expect(body).toMatch(/status.*ui-review|ui-review.*status/);
  });

  it('handles bounce by looping back to implementing', () => {
    expect(body).toContain('implementing');
    expect(body).toContain('bounce');
  });

  it('writes feedback envelope with u<N> prefix', () => {
    expect(body).toMatch(/<TASK-ID>-u\d|u<N>|prefix=u/);
  });
});
