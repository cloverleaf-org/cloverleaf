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

  it('calls affected-routes CLI before dispatching subagent', () => {
    expect(body).toContain('affected-routes');
  });

  it('handles empty-set early-exit by advancing to qa without subagent', () => {
    expect(body).toMatch(/\[\]|empty.*set|no.*renderable.*routes/i);
    expect(body).toMatch(/advance-status.*qa|→ qa/);
  });

  it('sets PLAYWRIGHT_BROWSERS_PATH before subagent dispatch', () => {
    expect(body).toContain('PLAYWRIGHT_BROWSERS_PATH');
  });

  it('passes affected_routes to subagent prompt', () => {
    expect(body).toContain('{{affected_routes}}');
  });
});

describe('cloverleaf-qa skill', () => {
  const body = readSkill('cloverleaf-qa');

  it('has valid frontmatter', () => {
    expect(body).toMatch(/^---[\s\S]*?name: cloverleaf-qa[\s\S]*?---/);
  });

  it('dispatches subagent with qa prompt', () => {
    expect(body).toMatch(/prompts\/qa\.md/);
    expect(body).toMatch(/subagent_type.*general-purpose/);
  });

  it('verifies task state is qa', () => {
    expect(body).toMatch(/status.*['"]qa['"]|['"]qa['"].*status/);
  });

  it('advances qa → final-gate on pass', () => {
    expect(body).toContain('final-gate');
  });

  it('handles bounce by looping back to implementing with q prefix', () => {
    expect(body).toContain('implementing');
    expect(body).toMatch(/prefix=q|-q\d|<TASK-ID>-q/);
  });

  it('passes qa_rules to the subagent prompt', () => {
    expect(body).toMatch(/qa_rules|qa-rules\.json/);
  });

  it('reads consumer qa-rules override if present, else package default', () => {
    expect(body).toContain('.cloverleaf/config/qa-rules.json');
    expect(body.toLowerCase()).toMatch(/test -f|\[ -f/);
  });
});

describe('cloverleaf-merge skill (v0.2 state-aware)', () => {
  const body = readSkill('cloverleaf-merge');

  it('accepts both automated-gates and final-gate states', () => {
    expect(body).toContain('automated-gates');
    expect(body).toContain('final-gate');
  });

  it('uses human_merge gate for automated-gates state', () => {
    expect(body).toContain('human_merge');
  });

  it('uses final_approval_gate for final-gate state', () => {
    expect(body).toContain('final_approval_gate');
  });

  it('shows richer summary at final-gate', () => {
    expect(body.toLowerCase()).toMatch(/ui.review|qa|summary/);
  });
});

describe('cloverleaf-run skill (v0.2 path-aware)', () => {
  const body = readSkill('cloverleaf-run');

  it('reads risk_class to select path', () => {
    expect(body).toContain('risk_class');
    expect(body).toMatch(/fast.lane|full.pipeline/);
  });

  it('fast lane calls implement → review → merge', () => {
    expect(body).toMatch(/cloverleaf-implement[\s\S]*cloverleaf-review[\s\S]*cloverleaf-merge/);
  });

  it('full pipeline calls implement → document → review → [ui-review?] → qa → merge', () => {
    expect(body).toContain('cloverleaf-document');
    expect(body).toContain('cloverleaf-qa');
    expect(body).toContain('cloverleaf-ui-review');
  });

  it('has per-agent bounce counters with max 3 each', () => {
    expect(body).toContain('reviewer_bounces');
    expect(body).toContain('ui_reviewer_bounces');
    expect(body).toContain('qa_bounces');
    expect(body).toMatch(/MAX.*3|max.*3|= 3/);
  });

  it('uses detect-ui-paths to decide ui-review conditional', () => {
    expect(body).toContain('detect-ui-paths');
  });

  it('escalates when any per-agent counter hits cap', () => {
    expect(body).toMatch(/escalate/i);
  });
});
