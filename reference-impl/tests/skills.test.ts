import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const SKILLS_DIR = resolve(__dirname, '..', 'skills');

function readSkill(name: string): string {
  return readFileSync(resolve(SKILLS_DIR, name, 'SKILL.md'), 'utf-8');
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

describe('cloverleaf-ui-review skill (v0.4)', () => {
  const body = readFileSync(resolve(__dirname, '..', 'skills', 'cloverleaf-ui-review', 'SKILL.md'), 'utf-8');

  it('references {{ui_review_config}} placeholder for prompt substitution', () => {
    expect(body).toContain('{{ui_review_config}}');
  });

  it('mkdirs the .cloverleaf/baselines and runs/<taskId>/ui-review paths', () => {
    expect(body).toContain('.cloverleaf/baselines');
    expect(body).toContain('ui-review');
  });
});

describe('cloverleaf-qa skill (v0.4)', () => {
  const body = readFileSync(resolve(__dirname, '..', 'skills', 'cloverleaf-qa', 'SKILL.md'), 'utf-8');

  it('mkdirs the .cloverleaf/runs/<taskId>/qa path', () => {
    expect(body).toContain('.cloverleaf/runs');
    expect(body).toContain('qa');
  });
});

describe('cloverleaf-new-task skill (v0.4)', () => {
  const body = readFileSync(resolve(__dirname, '..', 'skills', 'cloverleaf-new-task', 'SKILL.md'), 'utf-8');

  it('mkdirs .cloverleaf/baselines and .cloverleaf/runs', () => {
    expect(body).toContain('.cloverleaf/baselines');
    expect(body).toContain('.cloverleaf/runs');
  });

  it('appends .cloverleaf/runs/ to .gitignore if missing', () => {
    expect(body).toContain('.gitignore');
    expect(body).toMatch(/\.cloverleaf\/runs\/?/);
  });
});

describe('cloverleaf-merge skill (v0.4.1 #1)', () => {
  const body = readFileSync(resolve(__dirname, '..', 'skills', 'cloverleaf-merge', 'SKILL.md'), 'utf-8');

  it('performs a real git merge --no-ff of the feature branch', () => {
    expect(body).toContain('git merge --no-ff cloverleaf/');
  });

  it('documents conflict handling via git merge --abort + escalate', () => {
    expect(body).toContain('git merge --abort');
    expect(body.toLowerCase()).toMatch(/escalate/);
  });
});

describe('no hardcoded plugin paths in skills (v0.4.1 #7)', () => {
  const SKILLS_DIR = resolve(__dirname, '..', 'skills');
  const names = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('cloverleaf-'))
    .map((e) => e.name);

  for (const name of names) {
    it(`skills/${name}/SKILL.md contains no literal ~/.claude/plugins/cloverleaf/`, () => {
      const body = readFileSync(resolve(SKILLS_DIR, name, 'SKILL.md'), 'utf-8');
      expect(body).not.toContain('~/.claude/plugins/cloverleaf/');
    });
  }
});

describe('cloverleaf-new-rfc skill', () => {
  const body = readSkill('cloverleaf-new-rfc');

  it('takes a brief file argument', () => {
    expect(body).toMatch(/\$BRIEF|<brief-file>|brief/i);
  });

  it('scaffolds the RFC with status=drafting', () => {
    expect(body).toMatch(/drafting/);
  });

  it('uses cloverleaf-cli (no hardcoded plugin paths)', () => {
    expect(body).toMatch(/cloverleaf-cli/);
    expect(body).not.toMatch(/~\/\.claude\/plugins\/cloverleaf/);
  });

  it('consults discovery-config for projectId', () => {
    expect(body).toMatch(/discovery-config/);
    expect(body).toMatch(/projectId/);
  });

  it('calls next-work-item-id', () => {
    expect(body).toMatch(/next-work-item-id/);
  });

  it('calls save-rfc to persist the scaffold', () => {
    expect(body).toMatch(/save-rfc/);
  });

  // v0.5.1: echo appends a trailing newline that jq -Rs captures into the string,
  // so the RFC title ended up as "Brief: cross-browser UI review\n". Using printf
  // without a format-string newline produces a clean string. This regression guard
  // ensures future edits do not re-introduce `echo "$FIRST_LINE" | jq -Rs`.
  it('uses printf (not echo) before jq -Rs for title + problem (v0.5.1)', () => {
    expect(body).not.toMatch(/echo\s+"?\$FIRST_LINE"?\s*\|\s*jq/);
    expect(body).not.toMatch(/echo\s+"?\$BRIEF_CONTENT"?\s*\|\s*jq/);
    expect(body).toMatch(/printf\s+'%s'\s+"\$FIRST_LINE"\s*\|\s*jq\s+-Rs/);
    expect(body).toMatch(/printf\s+'%s'\s+"\$BRIEF_CONTENT"\s*\|\s*jq\s+-Rs/);
  });
});

describe('reviewer skills /tmp cleanup + feedback commit (v0.4.1 #3, #5)', () => {
  const REVIEWERS = ['cloverleaf-review', 'cloverleaf-ui-review', 'cloverleaf-qa'] as const;

  for (const name of REVIEWERS) {
    describe(name, () => {
      const body = readFileSync(resolve(__dirname, '..', 'skills', name, 'SKILL.md'), 'utf-8');

      it('cleans /tmp/cloverleaf-fb-*.json at step 0', () => {
        expect(body).toMatch(/rm\s+-f\s+\/tmp\/cloverleaf-fb-r\.json/);
        expect(body).toContain('/tmp/cloverleaf-fb-u.json');
        expect(body).toContain('/tmp/cloverleaf-fb-q.json');
      });

      it('commits feedback after write-feedback', () => {
        expect(body).toContain('cloverleaf-cli write-feedback');
        expect(body).toContain('git add .cloverleaf/feedback/');
        expect(body).toContain('git commit -m');
      });
    });
  }
});

describe('cloverleaf-draft-rfc skill', () => {
  const body = readSkill('cloverleaf-draft-rfc');

  it('takes an RFC ID argument', () => {
    expect(body).toMatch(/\$RFC_ID|<RFC-ID>|<rfc-id>|RFC-ID/);
  });

  it('loads the researcher prompt via plugin-root (no hardcoded plugin path)', () => {
    expect(body).toMatch(/\$\(cloverleaf-cli plugin-root\)\/prompts\/researcher/);
    expect(body).not.toMatch(/~\/\.claude\/plugins\/cloverleaf/);
  });

  it('uses operation=draftRfc', () => {
    expect(body).toMatch(/draftRfc/);
  });

  it('creates Spike work items from unknowns[] when non-empty', () => {
    expect(body).toMatch(/unknowns/);
    expect(body).toMatch(/save-spike/);
    expect(body).toMatch(/spike-in-flight/);
  });

  it('transitions to planning when unknowns is empty', () => {
    expect(body).toMatch(/planning/);
  });

  it('uses cloverleaf-cli save-rfc + advance-rfc (no hardcoded paths)', () => {
    expect(body).toMatch(/save-rfc/);
    expect(body).toMatch(/advance-rfc/);
  });
});

describe('cloverleaf-spike skill', () => {
  const body = readSkill('cloverleaf-spike');

  it('takes a spike ID', () => {
    expect(body).toMatch(/\$SPIKE_ID|<SPIKE-ID>|<spike-id>|SPIKE-ID/);
  });

  it('loads the researcher prompt via plugin-root', () => {
    expect(body).toMatch(/\$\(cloverleaf-cli plugin-root\)\/prompts\/researcher/);
    expect(body).not.toMatch(/~\/\.claude\/plugins\/cloverleaf/);
  });

  it('uses operation=runSpike', () => {
    expect(body).toMatch(/runSpike/);
  });

  it('advances pending → running → completed', () => {
    expect(body).toMatch(/pending.*running/s);
    expect(body).toMatch(/running.*completed/s);
  });

  it('uses save-spike + advance-spike', () => {
    expect(body).toMatch(/save-spike/);
    expect(body).toMatch(/advance-spike/);
  });
});

describe('cloverleaf-breakdown skill', () => {
  const body = readSkill('cloverleaf-breakdown');

  it('takes an RFC ID', () => {
    expect(body).toMatch(/\$RFC_ID|<RFC-ID>|<rfc-id>|RFC-ID/);
  });

  it('invokes the plan prompt via plugin-root', () => {
    expect(body).toMatch(/\$\(cloverleaf-cli plugin-root\)\/prompts\/plan/);
    expect(body).not.toMatch(/~\/\.claude\/plugins\/cloverleaf/);
  });

  it('writes a plan.json with status=drafting then gate-pending', () => {
    expect(body).toMatch(/drafting/);
    expect(body).toMatch(/gate-pending/);
  });

  it('uses task_batch_gate on transition', () => {
    expect(body).toMatch(/task_batch_gate/);
  });

  it('uses save-plan + advance-plan', () => {
    expect(body).toMatch(/save-plan/);
    expect(body).toMatch(/advance-plan/);
  });

  it('collects completed spikes via parent_rfc', () => {
    expect(body).toMatch(/parent_rfc/);
    expect(body).toMatch(/completed/);
  });
});

describe('cloverleaf-gate skill', () => {
  const body = readSkill('cloverleaf-gate');

  it('accepts approve/reject/revise actions', () => {
    expect(body).toMatch(/approve/);
    expect(body).toMatch(/reject/);
    expect(body).toMatch(/revise/);
  });

  it('handles both rfc_strategy_gate and task_batch_gate', () => {
    expect(body).toMatch(/rfc_strategy_gate/);
    expect(body).toMatch(/task_batch_gate/);
  });

  it('restricts revise to rfc_strategy_gate', () => {
    expect(body).toMatch(/revise.*(only|exclusive|rfc_strategy|RFC|only valid)/i);
  });

  it('emits a gate_decision event', () => {
    expect(body).toMatch(/emit-gate-decision/);
  });

  it('detects work-item type by directory presence', () => {
    expect(body).toMatch(/rfcs\//);
    expect(body).toMatch(/plans\//);
  });

  it('uses cloverleaf-cli (no hardcoded paths)', () => {
    expect(body).toMatch(/cloverleaf-cli/);
    expect(body).not.toMatch(/~\/\.claude\/plugins\/cloverleaf/);
  });

  it('verifies gate-pending status before acting', () => {
    expect(body).toMatch(/gate-pending/);
  });
});

describe('cloverleaf-discover skill', () => {
  const body = readSkill('cloverleaf-discover');

  it('takes a brief file argument', () => {
    expect(body).toMatch(/<brief-file>|\$BRIEF_FILE|BRIEF_FILE|brief/i);
  });

  it('chains new-rfc → draft-rfc → spike → breakdown → gate stages', () => {
    expect(body).toMatch(/new-rfc|cloverleaf-new-rfc/);
    expect(body).toMatch(/draft-rfc|cloverleaf-draft-rfc/);
    expect(body).toMatch(/cloverleaf-spike/);
    expect(body).toMatch(/breakdown|cloverleaf-breakdown/);
    expect(body).toMatch(/gate|cloverleaf-gate/);
  });

  it('has per-agent bounce budgets', () => {
    expect(body).toMatch(/bounce|BOUNCES/i);
    expect(body).toMatch(/3/);
  });

  it('materialises tasks after plan approval', () => {
    expect(body).toMatch(/materialise-tasks/);
  });

  it('prompts to run first task after materialisation', () => {
    expect(body).toMatch(/Run first.*task|first.*root.*run/i);
  });

  it('handles both human gates (rfc_strategy_gate and task_batch_gate)', () => {
    expect(body).toMatch(/rfc_strategy_gate/);
    expect(body).toMatch(/task_batch_gate/);
  });

  it('uses cloverleaf-cli (no hardcoded plugin paths)', () => {
    expect(body).toMatch(/cloverleaf-cli/);
    expect(body).not.toMatch(/~\/\.claude\/plugins\/cloverleaf/);
  });

  it('supports revise loop at rfc_strategy_gate', () => {
    expect(body).toMatch(/revise/);
  });
});
