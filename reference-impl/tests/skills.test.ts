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

  it('documents the --rfc=<ID> flag', () => {
    expect(body).toMatch(/--rfc=<RFC-ID>|--rfc=<ID>/);
  });

  it('reads the RFC document from .cloverleaf/rfcs/ to populate context.rfc', () => {
    expect(body).toMatch(/\.cloverleaf\/rfcs\/<RFC-ID>\.json/);
    expect(body).toMatch(/context\.rfc/);
  });

  it('specifies the workItemRef shape { project, id } for context.rfc', () => {
    expect(body).toMatch(/"rfc":\s*\{\s*"project":\s*"<rfc-project-field>",\s*"id":\s*"<RFC-ID>"\s*\}/);
  });

  it('aborts if the --rfc target file does not exist', () => {
    expect(body).toMatch(/does not exist.*verify|verify.*RFC ID/i);
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

describe('cloverleaf-merge skill (v0.5.2 #A — final-gate actor bug)', () => {
  const body = readFileSync(resolve(__dirname, '..', 'skills', 'cloverleaf-merge', 'SKILL.md'), 'utf-8');

  it('full-pipeline final-gate → merged uses actor=human with gate + path positional args', () => {
    // The task state machine declares `final-gate → merged` as allowed_actors: [human],
    // so the skill must pass `human final_approval_gate full_pipeline`, not `agent`.
    // Regression guard for two field repros (CLV-16, CLV-17) where the skill used `agent`
    // and the CLI rejected with "Illegal transition final-gate → merged ... by agent".
    expect(body).toMatch(/advance-status[^\n]*\bmerged human final_approval_gate full_pipeline\b/);
  });

  it('does not use actor=agent for any merged transition', () => {
    // Fast lane uses `human human_merge fast_lane`; full pipeline uses `human final_approval_gate full_pipeline`.
    // Neither should use `agent` for the `merged` transition.
    expect(body).not.toMatch(/advance-status[^\n]*\bmerged agent\b/);
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

  // v0.5.1: the v0.5 prose said "inline /cloverleaf-X steps", which the driven
  // Claude consistently interpreted as "invoke the sub-skill" anyway. Match the
  // observed behaviour explicitly so future edits don't reintroduce the
  // confusing "inline steps" phrasing.
  it('uses "invoke" language for sub-skill calls (not "inline ... steps") (v0.5.1)', () => {
    expect(body).not.toMatch(/inline\s+`?\/cloverleaf-/i);
    expect(body).toMatch(/invoke\s+`?\/cloverleaf-new-rfc/i);
    expect(body).toMatch(/invoke\s+`?\/cloverleaf-draft-rfc/i);
    expect(body).toMatch(/invoke\s+\/cloverleaf-spike/i);
    expect(body).toMatch(/invoke\s+`?\/cloverleaf-breakdown/i);
    expect(body).toMatch(/invoke\s+`?\/cloverleaf-gate/i);
  });
});

// ---------------------------------------------------------------------------
// CLV-19: baseline-approval sidecar gate in cloverleaf-ui-review skill
// ---------------------------------------------------------------------------

describe('cloverleaf-ui-review skill (CLV-19 — baseline-approval gate)', () => {
  const body = readFileSync(resolve(__dirname, '..', 'skills', 'cloverleaf-ui-review', 'SKILL.md'), 'utf-8');

  it('reads the ui-review state sidecar after the subagent completes', () => {
    expect(body).toMatch(/read-ui-review-state/);
  });

  it('references baselines_pending flag', () => {
    expect(body).toContain('baselines_pending');
  });

  it('blocks ui-review → qa when baselines_pending is true', () => {
    // Must NOT advance to qa when baselines_pending is true
    expect(body).toMatch(/baselines_pending.*true|true.*baselines_pending/i);
    expect(body).toMatch(/do NOT advance|not advance|leave.*ui-review|remains? in.*ui-review/i);
  });

  it('surfaces a human-readable message containing "baselines_pending" when baseline approval is required', () => {
    expect(body).toMatch(/baselines_pending/);
    // Must tell the human to run the approve-baselines skill
    expect(body).toMatch(/cloverleaf-approve-baselines/);
  });

  it('uses the fully-qualified /cloverleaf-approve-baselines slash command (v0.5.4 #D)', () => {
    // CLV-19 review flagged this as a non-blocking nit: line 98 said `/approve-baselines`
    // but the registered plugin-scoped skill is `/cloverleaf-approve-baselines`. A human
    // copying the unqualified form verbatim would hit "skill not found". v0.5.4 patches
    // the skill and this guard keeps the unqualified `/approve-baselines` from reappearing.
    // Note the word-boundary `\b` — we want to forbid the bare form but still allow
    // `/cloverleaf-approve-baselines` (which contains the substring "approve-baselines").
    expect(body).not.toMatch(/(^|[^-])\/approve-baselines\b/);
  });

  it('advances to qa normally when baselines_pending is false', () => {
    expect(body).toMatch(/baselines_pending.*false|false.*baselines_pending/i);
    expect(body).toMatch(/advance-status[^\n]*qa/);
  });

  it('uses cloverleaf-cli read-ui-review-state command', () => {
    expect(body).toContain('cloverleaf-cli read-ui-review-state');
  });
});

// ---------------------------------------------------------------------------
// CLV-19: cloverleaf-approve-baselines skill
// ---------------------------------------------------------------------------

describe('cloverleaf-approve-baselines skill (CLV-19)', () => {
  const body = readFileSync(resolve(__dirname, '..', 'skills', 'cloverleaf-approve-baselines', 'SKILL.md'), 'utf-8');

  it('has valid frontmatter with name cloverleaf-approve-baselines', () => {
    expect(body).toMatch(/^---[\s\S]*?name: cloverleaf-approve-baselines[\s\S]*?---/);
  });

  it('has a description mentioning baselines_pending and qa', () => {
    expect(body).toMatch(/description:/);
    expect(body).toMatch(/baselines_pending|baselines.*pending/i);
    expect(body).toMatch(/qa/);
  });

  it('documents its trigger condition (baselines_pending: true)', () => {
    expect(body).toMatch(/trigger condition|trigger/i);
    expect(body).toMatch(/baselines_pending.*true|new-baseline|dimension-mismatch/i);
  });

  it('verifies task status is ui-review before acting', () => {
    expect(body).toMatch(/status.*ui-review|ui-review.*status/);
  });

  it('reads state.json to check baselines_pending before proceeding', () => {
    expect(body).toContain('read-ui-review-state');
  });

  it('writes baselines_pending: false via cloverleaf-cli write-ui-review-state', () => {
    expect(body).toContain('write-ui-review-state');
    expect(body).toMatch(/write-ui-review-state[^\n]*false/);
  });

  it('advances the task ui-review → qa after approval', () => {
    expect(body).toMatch(/advance-status[^\n]*qa/);
  });

  it('commits the updated state before reporting', () => {
    expect(body).toContain('git add .cloverleaf/');
    expect(body).toContain('git commit');
  });

  it('documents the effect: baselines_pending cleared → qa', () => {
    expect(body).toMatch(/baselines.*cleared|clear.*flag|baselines_pending.*false/i);
    expect(body).toMatch(/qa/);
  });

  it('contains no hardcoded plugin paths', () => {
    expect(body).not.toContain('~/.claude/plugins/cloverleaf/');
  });

  it('uses cloverleaf-cli (not hardcoded paths)', () => {
    expect(body).toContain('cloverleaf-cli');
  });
});

describe('cloverleaf-merge skill (v0.6 #F — Q&A at final-gate)', () => {
  const body = readFileSync(
    resolve(__dirname, '..', 'skills', 'cloverleaf-merge', 'SKILL.md'),
    'utf-8',
  );

  it('supports clarifying questions before y/N verdict', () => {
    expect(body.toLowerCase()).toMatch(
      /clarifying question|ask.*question|(treat|interpret).*(non.y|anything else|not.*y\/n).*as.*question/,
    );
  });

  it('explicitly re-prompts y/N after answering a question', () => {
    expect(body.toLowerCase()).toMatch(/re.?prompt|re.?ask|ask again|repeat.*prompt/);
  });

  it('only proceeds on y/Y/yes/YES — not on arbitrary text', () => {
    expect(body).toMatch(/\by[/|,\s]+Y[/|,\s]+yes[/|,\s]+YES\b|y\/Y\/yes\/YES/);
  });
});

describe('cloverleaf-run-plan skill (v0.6 — autonomous DAG walker)', () => {
  const body = readFileSync(
    resolve(__dirname, '..', 'skills', 'cloverleaf-run-plan', 'SKILL.md'),
    'utf-8',
  );

  it('has valid frontmatter with name cloverleaf-run-plan', () => {
    expect(body).toMatch(/^---[\s\S]*?name: cloverleaf-run-plan[\s\S]*?---/);
  });

  it('documents the --max-concurrent and --reset flags', () => {
    expect(body).toMatch(/--max-concurrent/);
    expect(body).toMatch(/--reset/);
  });

  it('defaults max_concurrent to 3', () => {
    expect(body).toMatch(/default[:\s][^\n]*\b3\b|max_concurrent[:\s]+3/i);
  });

  it('guards against cycles via cloverleaf-cli dag-detect-cycle', () => {
    expect(body).toContain('dag-detect-cycle');
  });

  it('uses cloverleaf-cli walk-state-read / walk-state-write for persistence', () => {
    expect(body).toContain('walk-state-read');
    expect(body).toContain('walk-state-write');
  });

  it('uses cloverleaf-cli dag-ready-tasks to compute schedulable tasks', () => {
    expect(body).toContain('dag-ready-tasks');
  });

  it('spawns per-task sessions via claw-drive start_session (MCP) or CLI equivalent', () => {
    expect(body).toMatch(/claw-drive.*start.?session|mcp__claw-drive__start_session/i);
  });

  it('monitors sessions via claw-drive watch (with --since for event-stream resumption)', () => {
    expect(body).toMatch(/claw-drive watch/);
    expect(body).toMatch(/--since/);
  });

  it('surfaces escalations immediately (not batched)', () => {
    expect(body.toLowerCase()).toMatch(
      /escalat[^\n]*immediat|surface[^\n]*(right away|immediat|as soon)|not[^\n]*queue.*escalation/,
    );
  });

  it('drains final-gate prompts serially to the driver session', () => {
    expect(body.toLowerCase()).toMatch(/final.gate[^\n]*(serial|queue|one at a time|one-at-a-time)/);
  });

  it('is resumable — attaches to live sessions on re-invocation', () => {
    expect(body.toLowerCase()).toMatch(/resum|re.?attach|re.?invok/);
  });

  it('reports merged / escalated / awaiting / unreachable at exit', () => {
    expect(body).toMatch(/merged/i);
    expect(body).toMatch(/escalated/i);
    expect(body).toMatch(/awaiting.?final.?gate/i);
    expect(body).toMatch(/unreachable|blocked/i);
  });

  it('references the per-task /cloverleaf-run skill for each Session B', () => {
    expect(body).toContain('cloverleaf-run');
  });

  // v0.6 #G — worktree isolation per Session B.
  // The first dogfood surfaced the fact that parallel Sessions B sharing one
  // working directory race on git checkout / commit and corrupt branches.
  // The walker MUST spin a dedicated git worktree per task, pass it as cwd
  // to the session, and perform the final merge itself on main (Session B
  // does NOT invoke /cloverleaf-merge, which would try to checkout main in
  // its worktree and fail because main is held by the primary repo).
  it('spawns Session B with cwd pointing at a dedicated git worktree (v0.6 #G)', () => {
    // Must set up a per-task worktree BEFORE start_session.
    expect(body).toMatch(/git[^\n]*worktree add/);
    // Session's cwd must be the worktree (not the repo root). The skill body
    // shows `cwd`: `$WT` in the start_session parameter list.
    expect(body.toLowerCase()).toMatch(/cwd[^\n]*\$wt|cwd[^\n]*worktree|cwd[^\n]*\/tmp\/walker/);
  });

  it('instructs Session B to NOT invoke /cloverleaf-merge (v0.6 #G)', () => {
    // The scenario brief template (or walker rules) must explicitly tell
    // Session B to stop before /cloverleaf-merge. The walker owns the merge.
    expect(body.toLowerCase()).toMatch(
      /do not invoke[^\n]*cloverleaf-merge|not invoke[^\n]*cloverleaf-merge|session b must not invoke|don'?t invoke[^\n]*cloverleaf-merge/,
    );
  });

  it('walker performs the real git merge --no-ff on main in the primary repo (v0.6 #G)', () => {
    // On y approval, the walker must run git merge --no-ff in the primary repo.
    // CLV-70: the command now uses git -C <repo_root> so path resolution is CWD-independent.
    expect(body).toMatch(/git(?:\s+-C\s+\S+)?\s+merge --no-ff cloverleaf\/<TASK-ID>/);
    // The walker also advances state to merged and commits, in the primary repo.
    expect(body).toMatch(/advance-status[^\n]*<TASK-ID>[^\n]*merged human/);
  });

  it('tears down the worktree after a successful merge (v0.6 #G)', () => {
    expect(body).toMatch(/git[^\n]*worktree remove/);
  });

  it('serialises merges on main (no concurrent merges, even for independent branches)', () => {
    expect(body.toLowerCase()).toMatch(
      /sequential.*main|serial.*main|one (prompt|decision).*next|concurrent[^\n]*merge[^\n]*race|two[^\n]*(concurrent|parallel).*merge/,
    );
  });
});

// ---------------------------------------------------------------------------
// CLV-34: v0.6.1 walker correctness patches (bugs #1, #6, #7)
// ---------------------------------------------------------------------------

describe('cloverleaf-run-plan skill (v0.6.1 — bug #1: XDG_CACHE_HOME worktree path)', () => {
  const body = readFileSync(
    resolve(__dirname, '..', 'skills', 'cloverleaf-run-plan', 'SKILL.md'),
    'utf-8',
  );

  it('uses XDG_CACHE_HOME-based WT path (not /tmp/walker-*)', () => {
    // Bug #1: claw-drive rejects sessions with cwd outside $HOME (INVALID_CWD).
    // WT must be under $HOME via XDG_CACHE_HOME or the $HOME/.cache fallback.
    expect(body).toContain('${XDG_CACHE_HOME:-$HOME/.cache}/cloverleaf/walker/');
  });

  it('has no /tmp/walker-* path anywhere in the skill body', () => {
    // Regression guard: no /tmp/walker path must remain after the v0.6.1 patch.
    expect(body).not.toMatch(/\/tmp\/walker/);
  });

  it('adds mkdir -p "$(dirname "$WT")" before git worktree add', () => {
    // The XDG_CACHE_HOME path may not exist on first use; mkdir -p creates the hierarchy.
    expect(body).toMatch(/mkdir -p "\$\(dirname "\$WT"\)"/);
  });
});

describe('cloverleaf-run-plan skill (v0.6.1 — bug #6: conflict-marker guard before merge)', () => {
  const body = readFileSync(
    resolve(__dirname, '..', 'skills', 'cloverleaf-run-plan', 'SKILL.md'),
    'utf-8',
  );

  it('scans changed files for conflict markers before git merge --no-ff', () => {
    // Bug #6: unresolved conflict markers reached git merge --no-ff undetected.
    // The drain step must grep changed files for <<<<<<< / ======= / >>>>>>> markers.
    expect(body).toMatch(/grep[^\n]*(<<<|<\{7\}|conflict.marker)/i);
  });

  it('aborts the merge when conflict markers are found', () => {
    // Must NOT proceed to git merge --no-ff when markers are detected.
    expect(body).toMatch(/abort.*merge|aborting merge|do NOT proceed|conflict markers found/i);
  });

  it('greps for all three conflict marker variants (<<<<<<< ======= >>>>>>>)', () => {
    // The guard must catch all three standard git conflict marker forms.
    // SKILL.md uses shell ERE notation <{7}, ={7}, >{7} inside the grep -E pattern.
    expect(body).toContain('<{7}');
    expect(body).toContain('={7}');
    expect(body).toContain('>{7}');
  });

  it('escalates the task when conflict markers are found (not silently skipping)', () => {
    // Unresolved conflicts must surface to the user, not be silently ignored.
    expect(body).toMatch(/escalated.*conflict|conflict.*escalat/i);
  });
});

describe('cloverleaf-run-plan skill (v0.6.1 — bug #7: walk-state-write after merge)', () => {
  const body = readFileSync(
    resolve(__dirname, '..', 'skills', 'cloverleaf-run-plan', 'SKILL.md'),
    'utf-8',
  );

  it('calls walk-state-write after a successful git merge --no-ff', () => {
    // Bug #7: walk-state.json stayed at state: "running" after drain because
    // the walk-state-write call was referenced in prose but never emitted.
    // The drain step must call cloverleaf-cli walk-state-write after merge.
    expect(body).toMatch(/walk-state-write[\s\S]{0,400}merge_commit|merge_commit[\s\S]{0,400}walk-state-write/);
  });

  it('records state: "merged" and the merge_commit SHA in walk-state', () => {
    // The updated walk-state entry must carry both the merged state and the SHA.
    expect(body).toMatch(/state.*merged.*merge_commit|merge_commit.*state.*merged/i);
  });

  it('captures the merge commit SHA via git rev-parse HEAD', () => {
    // The SHA must be captured programmatically after the merge.
    // CLV-70: the command now uses git -C <repo_root> so path resolution is CWD-independent.
    expect(body).toMatch(/git(?:\s+-C\s+\S+)?\s+rev-parse HEAD/);
  });
});

// ---------------------------------------------------------------------------
// CLV-53: cloverleaf-run-plan scenario_brief git checkout main guard
// ---------------------------------------------------------------------------

describe('cloverleaf-run-plan skill (CLV-53 — scenario_brief git checkout guard)', () => {
  const body = readFileSync(
    resolve(__dirname, '..', 'skills', 'cloverleaf-run-plan', 'SKILL.md'),
    'utf-8',
  );

  it('contains "DO NOT run `git checkout main`" within the scenario_brief section', () => {
    // The scenario_brief template must explicitly forbid switching to main from a worktree.
    const scenarioBriefIdx = body.indexOf('## Session brief template');
    const walkerPolicyIdx = body.indexOf('## Walker policy');
    expect(scenarioBriefIdx).toBeGreaterThan(-1);
    expect(walkerPolicyIdx).toBeGreaterThan(-1);
    const scenarioBriefSection = body.slice(scenarioBriefIdx, walkerPolicyIdx);
    expect(scenarioBriefSection).toContain('DO NOT run `git checkout main`');
  });

  it('scenario_brief directs to git diff main..HEAD as safe comparison alternative', () => {
    const scenarioBriefIdx = body.indexOf('## Session brief template');
    const walkerPolicyIdx = body.indexOf('## Walker policy');
    const scenarioBriefSection = body.slice(scenarioBriefIdx, walkerPolicyIdx);
    expect(scenarioBriefSection).toContain('git diff main..HEAD');
  });

  it('scenario_brief directs to git show main:<path> as safe inspection alternative', () => {
    const scenarioBriefIdx = body.indexOf('## Session brief template');
    const walkerPolicyIdx = body.indexOf('## Walker policy');
    const scenarioBriefSection = body.slice(scenarioBriefIdx, walkerPolicyIdx);
    expect(scenarioBriefSection).toMatch(/git show main:<path>/);
  });
});

// ---------------------------------------------------------------------------
// CLV-53: cloverleaf-run-plan step-6 Report Next steps block
// ---------------------------------------------------------------------------

describe('cloverleaf-run-plan skill (CLV-53 — step-6 Report Next steps block)', () => {
  const body = readFileSync(
    resolve(__dirname, '..', 'skills', 'cloverleaf-run-plan', 'SKILL.md'),
    'utf-8',
  );

  it('step-6 Report section contains ## Next steps heading', () => {
    // Find step 6 and the Session brief template (which comes after step 6).
    const step6Idx = body.indexOf('6. **Report.**');
    const scenarioBriefIdx = body.indexOf('## Session brief template');
    expect(step6Idx).toBeGreaterThan(-1);
    expect(scenarioBriefIdx).toBeGreaterThan(-1);
    const step6Section = body.slice(step6Idx, scenarioBriefIdx);
    expect(step6Section).toContain('## Next steps');
  });

  it('step-6 Report section contains git tag -a command', () => {
    const step6Idx = body.indexOf('6. **Report.**');
    const scenarioBriefIdx = body.indexOf('## Session brief template');
    const step6Section = body.slice(step6Idx, scenarioBriefIdx);
    // CLV-70: now uses git -C <repo_root> tag -a for CWD-independent invocation.
    expect(step6Section).toMatch(/git(?:\s+-C\s+\S+)?\s+tag -a/);
  });

  it('step-6 Report section lists all five release commands', () => {
    const step6Idx = body.indexOf('6. **Report.**');
    const scenarioBriefIdx = body.indexOf('## Session brief template');
    const step6Section = body.slice(step6Idx, scenarioBriefIdx);
    // CLV-70: now uses git -C <repo_root> for CWD-independent invocation.
    expect(step6Section).toMatch(/git(?:\s+-C\s+\S+)?\s+tag -a reference-impl-v<VERSION>/);
    expect(step6Section).toMatch(/git(?:\s+-C\s+\S+)?\s+push origin main/);
    expect(step6Section).toMatch(/git(?:\s+-C\s+\S+)?\s+push origin reference-impl-v<VERSION>/);
    expect(step6Section).toMatch(/npm publish --access public/);
    expect(step6Section).toMatch(/gh release create reference-impl-v<VERSION>/);
  });
});

// ---------------------------------------------------------------------------
// CLV-59: walker-default-concurrency subcommand call in step 1
// ---------------------------------------------------------------------------

describe('cloverleaf-run-plan skill (CLV-59 — walker-default-concurrency in step 1)', () => {
  const body = readFileSync(
    resolve(__dirname, '..', 'skills', 'cloverleaf-run-plan', 'SKILL.md'),
    'utf-8',
  );

  it('step 1 contains both cloverleaf-cli walker-default-concurrency (plain) and --explain forms', () => {
    // Slice step 1 only: from "1. " up to "2. **Guard against cycles.**"
    const step1Start = body.indexOf('1. Capture the `<PLAN-ID>`');
    const step2Start = body.indexOf('2. **Guard against cycles.**');
    expect(step1Start).toBeGreaterThan(-1);
    expect(step2Start).toBeGreaterThan(-1);
    const step1Body = body.slice(step1Start, step2Start);

    // Plain form — must appear (used for MAX=$(...) assignment)
    expect(step1Body).toContain('cloverleaf-cli walker-default-concurrency');
    // Explain form — must also appear (used for startup info line)
    expect(step1Body).toContain('cloverleaf-cli walker-default-concurrency --explain');
  });
});

// ---------------------------------------------------------------------------
// CLV-53: cloverleaf-run Branch discipline section guards
// ---------------------------------------------------------------------------

describe('cloverleaf-run skill (CLV-53 — Branch discipline section)', () => {
  const body = readFileSync(
    resolve(__dirname, '..', 'skills', 'cloverleaf-run', 'SKILL.md'),
    'utf-8',
  );

  it('Branch discipline section defines <repo_root> as $(git rev-parse --show-toplevel)', () => {
    const branchDisciplineIdx = body.indexOf('## Branch discipline');
    const perAgentIdx = body.indexOf('## Per-agent bounce budget');
    expect(branchDisciplineIdx).toBeGreaterThan(-1);
    expect(perAgentIdx).toBeGreaterThan(-1);
    const branchSection = body.slice(branchDisciplineIdx, perAgentIdx);
    expect(branchSection).toContain('git rev-parse --show-toplevel');
  });

  it('Branch discipline section notes that in walker context this is the worktree NOT the primary repo', () => {
    const branchDisciplineIdx = body.indexOf('## Branch discipline');
    const perAgentIdx = body.indexOf('## Per-agent bounce budget');
    const branchSection = body.slice(branchDisciplineIdx, perAgentIdx);
    expect(branchSection.toLowerCase()).toMatch(/worktree/);
    expect(branchSection.toLowerCase()).toMatch(/not.*primary|primary.*not/);
  });

  it('Branch discipline section forbids git checkout main from walker worktrees', () => {
    const branchDisciplineIdx = body.indexOf('## Branch discipline');
    const perAgentIdx = body.indexOf('## Per-agent bounce budget');
    const branchSection = body.slice(branchDisciplineIdx, perAgentIdx);
    expect(branchSection).toMatch(/do NOT `git checkout main`|Do NOT `git checkout main`/i);
  });

  it('Branch discipline section points to git diff main..HEAD and git show main:<path>', () => {
    const branchDisciplineIdx = body.indexOf('## Branch discipline');
    const perAgentIdx = body.indexOf('## Per-agent bounce budget');
    const branchSection = body.slice(branchDisciplineIdx, perAgentIdx);
    expect(branchSection).toContain('git diff main..HEAD');
    expect(branchSection).toMatch(/git show main:<path>/);
  });

  it('does NOT contain the legacy "Each sub-skill runs from `main`" directive', () => {
    // This directive caused v0.6.3 dogfood walker pollution where state-advance
    // commits landed on primary main instead of the worktree feature branch.
    expect(body).not.toContain('Each sub-skill runs from `main`');
  });
});

// ---------------------------------------------------------------------------
// CLV-34: v0.6.1 CHANGELOG and package.json guards
// ---------------------------------------------------------------------------

describe('CHANGELOG.md (v0.6.1)', () => {
  const changelog = readFileSync(resolve(__dirname, '..', 'CHANGELOG.md'), 'utf-8');

  it('has a ## 0.6.1 section', () => {
    expect(changelog).toMatch(/^## 0\.6\.1/m);
  });

  it('documents bug #1 (worktree path under /tmp/ → XDG_CACHE_HOME)', () => {
    expect(changelog).toMatch(/Bug #1|\/tmp\/walker|XDG_CACHE_HOME/);
    expect(changelog).toMatch(/INVALID_CWD|claw-drive/i);
  });

  it('documents bug #2 (git worktree add ... main collision)', () => {
    expect(changelog).toMatch(/Bug #2|worktree add.*main|main.*already checked out/i);
    expect(changelog).toMatch(/--detach/);
  });

  it('documents bug #3 (Playwright script in /tmp/)', () => {
    expect(changelog).toMatch(/Bug #3|playwright.*\/tmp|\/tmp.*playwright/i);
  });

  it('documents bug #4 (prep-worktree node_modules resolution)', () => {
    expect(changelog).toMatch(/Bug #4|prep-worktree/i);
    expect(changelog).toMatch(/node_modules/);
  });

  it('documents bug #5 (baselines_pending CLI guard)', () => {
    expect(changelog).toMatch(/Bug #5|baselines_pending/i);
  });

  it('documents bug #6 (conflict-marker grep before merge)', () => {
    expect(changelog).toMatch(/Bug #6|conflict.marker/i);
    expect(changelog).toMatch(/<{7}|<<<<<<|conflict markers/);
  });

  it('documents bug #7 (walk-state-write missing after merge)', () => {
    expect(changelog).toMatch(/Bug #7|walk-state.*running|walk-state-write/i);
    expect(changelog).toMatch(/merge_commit|merged.*state/i);
  });

  it('includes the --reset migration note for v0.6.0 → v0.6.1 upgrade', () => {
    // RFC AC #6 and DoD: consumers with stale walk-state from v0.6.0 must use --reset.
    expect(changelog).toMatch(/--reset/);
    expect(changelog).toMatch(/stale.*walk-state|walk-state.*stale/i);
  });

  it('confirms walk-state-reconcile is NOT shipped (mentions it only to say so) (RFC AC #11)', () => {
    // RFC AC #11: no walk-state-reconcile subcommand introduced. The CHANGELOG may
    // mention the name in prose to explicitly state it is not being shipped.
    // The guard is on SKILL.md (no reconcile command is called) and CLI source.
    // Here we verify the CHANGELOG says it is "not" shipped rather than documenting it as a feature.
    if (changelog.includes('walk-state-reconcile')) {
      expect(changelog).toMatch(/walk-state-reconcile.*not shipped|not.*walk-state-reconcile|walk-state-reconcile.*\*\*not\*\*/i);
    }
  });
});

describe('package.json (v0.8.0)', () => {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'));

  it('reports version 0.8.0', () => {
    // v0.8.0: Security Reviewer agent + security_class dimension.
    expect(pkg.version).toBe('0.8.0');
  });

  it('is the @cloverleaf/reference-impl package (not @cloverleaf/standard)', () => {
    // RFC AC #5: @cloverleaf/standard package.json is NOT modified.
    expect(pkg.name).toBe('@cloverleaf/reference-impl');
  });
});

// ---------------------------------------------------------------------------
// CLV-64: --idle-after adoption, token vocabulary refresh, prep-worktree
// ---------------------------------------------------------------------------

describe('cloverleaf-run-plan skill (CLV-64 — --idle-after, prep-worktree, token refresh, idle handler)', () => {
  const body = readFileSync(
    resolve(__dirname, '..', 'skills', 'cloverleaf-run-plan', 'SKILL.md'),
    'utf-8',
  );

  it('references --idle-after in a claw-drive watch command context (CLV-64 #1)', () => {
    // CLV-97: the literal 600 was replaced by $IDLE_AFTER (read from notification_contract).
    // The guard now checks that --idle-after appears in a claw-drive watch line, regardless
    // of whether the value is a literal or a shell variable.
    expect(body).toMatch(/claw-drive watch[^\n]*--idle-after/);
  });

  it('calls cloverleaf-cli prep-worktree after git worktree add (CLV-64 #2)', () => {
    const worktreeAddIdx = body.indexOf('git -C <repo_root> worktree add "$WT" -b cloverleaf/<TASK-ID> main');
    const startSessionIdx = body.indexOf('mcp__claw-drive__start_session');
    expect(worktreeAddIdx).toBeGreaterThan(-1);
    expect(startSessionIdx).toBeGreaterThan(-1);
    const between = body.slice(worktreeAddIdx, startSessionIdx);
    expect(between).toContain('cloverleaf-cli prep-worktree');
  });

  it('contains no retired claw-drive 0.5.7 token names (CLV-64 #3)', () => {
    expect(body).not.toContain('INFO-FINISHED');
    expect(body).not.toContain('NEEDS-DECISION');
    expect(body).not.toContain('INFO-CHECKPOINT');
    expect(body).not.toContain('INFO-PROGRESS');
  });

  it('contains an idle event handler that references claw-drive status (CLV-64 #4)', () => {
    expect(body).toMatch(/silent_for_ms.*600000|600000.*silent_for_ms/);
    expect(body).toMatch(/claw-drive status[^\n]*<child_session_id>/);
  });
});


// ---------------------------------------------------------------------------
// CLV-70: regression guard — no bare git invocations in walker bash blocks
// ---------------------------------------------------------------------------

describe('cloverleaf-run-plan skill (CLV-70 — no bare git in bash blocks)', () => {
  const body = readFileSync(
    resolve(__dirname, '..', 'skills', 'cloverleaf-run-plan', 'SKILL.md'),
    'utf-8',
  );

  /**
   * Step-0 pre-flight read-only allowlist.
   * These diagnostic commands do not mutate state and are always safe bare.
   */
  const ALLOWLIST: RegExp[] = [
    /^git\s+rev-parse\s+--abbrev-ref\b/,
    /^git\s+status\b/,
  ];

  /**
   * Extract all fenced ```bash ... ``` blocks from the skill body.
   * Handles indented fences (e.g. "   ```bash") as used in SKILL.md.
   * Returns an array of { lines } for each block found.
   */
  function extractBashBlocks(text: string): Array<{ lines: string[] }> {
    const blocks: Array<{ lines: string[] }> = [];
    // Match optional-whitespace-then-```bash up to the closing optional-whitespace-then-```
    // Use non-greedy dotall for the block content.
    const fenceRe = /[ \t]*```bash[ \t]*\n([\s\S]*?)[ \t]*```/g;
    let m: RegExpExecArray | null;
    while ((m = fenceRe.exec(text)) !== null) {
      const blockText = m[1];
      blocks.push({ lines: blockText.split('\n') });
    }
    return blocks;
  }

  it('contains no bare git invocations (outside the step-0 allowlist) in any bash code block', () => {
    const blocks = extractBashBlocks(body);
    // We should find at least one bash block to confirm we are scanning something.
    expect(blocks.length).toBeGreaterThan(0);

    const violations: string[] = [];

    for (const { lines } of blocks) {
      for (const line of lines) {
        // Match lines that start with optional whitespace then "git " — real invocations.
        // Skip comment lines (# ...) and empty lines.
        const trimmed = line.trimStart();
        if (!trimmed.startsWith('git ') && !trimmed.startsWith('git\t')) {
          continue;
        }
        // Skip if this is a compliant git -C invocation.
        if (/^git\s+-C\s/.test(trimmed)) {
          continue;
        }
        // Check allowlist.
        const allowed = ALLOWLIST.some((re) => re.test(trimmed));
        if (!allowed) {
          violations.push(line);
        }
      }
    }

    expect(violations, `Bare git invocations found (not allowlisted and missing -C <repo_root>):\n${violations.map((l) => `  ${JSON.stringify(l)}`).join('\n')}`).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// CLV-74: plugin.json must have no `skills` property (auto-discovery guard)
// ---------------------------------------------------------------------------

describe('plugin.json (CLV-74 — no skills property)', () => {
  const pluginJson = JSON.parse(
    readFileSync(resolve(__dirname, '..', '.claude-plugin', 'plugin.json'), 'utf-8'),
  );

  it('plugin.json exists and is valid JSON', () => {
    expect(pluginJson).toBeDefined();
    expect(typeof pluginJson).toBe('object');
  });

  it('plugin.json has no skills property (auto-discovery must not be suppressed)', () => {
    // The `skills[]` array in plugin.json suppresses Claude Code's auto-discovery
    // mechanism. When present, only the listed skills are registered — all others
    // vanish at runtime. Removing the field restores full auto-discovery (CLV-69
    // hot-fix / v0.6.6 changelog entry). This guard prevents the field from
    // being inadvertently re-introduced by future edits.
    expect(pluginJson).not.toHaveProperty('skills');
  });
});

// ---------------------------------------------------------------------------
// CLV-74: walker self-healing — Monitor attachment, dispatch table, 5xx retry
// ---------------------------------------------------------------------------

describe('cloverleaf-run-plan skill (CLV-74 — walker self-healing)', () => {
  const body = readFileSync(
    resolve(__dirname, '..', 'skills', 'cloverleaf-run-plan', 'SKILL.md'),
    'utf-8',
  );

  it('attaches Monitor tool with persistent: true and timeout_ms: 3600000 after start_session', () => {
    // The walker must invoke the Monitor tool immediately after spawning each
    // Session B so that child events arrive without requiring Session A nudges.
    expect(body).toContain('persistent: true');
    expect(body).toContain('timeout_ms: 3600000');
    // Monitor attachment must appear after mcp__claw-drive__start_session in the skill body.
    const startSessionIdx = body.indexOf('mcp__claw-drive__start_session');
    const monitorIdx = body.indexOf('persistent: true');
    expect(startSessionIdx).toBeGreaterThan(-1);
    expect(monitorIdx).toBeGreaterThan(-1);
    expect(monitorIdx).toBeGreaterThan(startSessionIdx);
  });

  it('dispatch table covers the idle event with claw-drive status check', () => {
    // idle handler must call `claw-drive status <child_session_id>`
    expect(body).toMatch(/\*\*`?idle`?\*\*/);
    expect(body).toMatch(/claw-drive status[^\n]*<child_session_id>/);
  });

  it('idle handler branches on last_token [DONE]', () => {
    expect(body).toMatch(/last_token.*\[DONE\]|\[DONE\].*last_token/);
  });

  it('idle handler branches on last_token [NEEDS-INPUT]', () => {
    expect(body).toMatch(/last_token.*\[NEEDS-INPUT\]|\[NEEDS-INPUT\].*last_token/);
  });

  it('dispatch table covers tool_decision_required event', () => {
    expect(body).toMatch(/\*\*`?tool_decision_required`?\*\*/);
  });

  it('dispatch table covers turn_completed [DONE] event', () => {
    expect(body).toMatch(/turn_completed[^\n]*\[DONE\]|\[DONE\][^\n]*turn_completed/);
  });

  it('dispatch table covers turn_completed [NEEDS-INPUT] event', () => {
    expect(body).toMatch(/turn_completed[^\n]*\[NEEDS-INPUT\]|\[NEEDS-INPUT\][^\n]*turn_completed/);
  });

  it('dispatch table covers session_stopped event', () => {
    expect(body).toMatch(/\*\*`?session_stopped`?\*\*/);
  });

  it('transient-5xx regex covers HTTP 5xx status codes (e.g. 503)', () => {
    // The regex must match patterns like "503", "500", "599".
    expect(body).toMatch(/5\\d\\d\\b|5\\\\d\\\\d/);
  });

  it('transient-5xx regex covers "API Error: 5xx" string form', () => {
    expect(body).toMatch(/API Error: 5\\d\\d|API Error.*5xx/);
  });

  it('transient-5xx regex covers "temporarily unavailable" literal', () => {
    expect(body).toContain('temporarily unavailable');
  });

  it('5xx self-healing sends recovery turn via mcp__claw-drive__send_turn', () => {
    expect(body).toContain('mcp__claw-drive__send_turn');
    expect(body).toContain('API recovered. Retry the last operation.');
  });
});

// ---------------------------------------------------------------------------
// CLV-88: walker scope-enforcement patches (SKILL.md + implementer prompt)
// ---------------------------------------------------------------------------

describe('cloverleaf-run-plan skill (CLV-88 — scope enforcement patches)', () => {
  const body = readFileSync(
    resolve(__dirname, '..', 'skills', 'cloverleaf-run-plan', 'SKILL.md'),
    'utf-8',
  );

  it('contains the literal string `cloverleaf-cli check-scope`', () => {
    expect(body).toContain('cloverleaf-cli check-scope');
  });

  it('contains the contested-escalation message template (CLV-88)', () => {
    // Verbatim message surfaced when check-scope reports contested files.
    expect(body).toContain('escalated: scope-contested merge');
    expect(body).toContain('Walker will not auto-resolve');
    expect(body).toContain('Re-run /cloverleaf-run-plan');
  });

  it('Rules block contains the scope-contested rule (CLV-88)', () => {
    expect(body).toContain('Scope-contested merges are escalated, never auto-resolved');
  });
});

describe('Implementer prompt (CLV-88 — scope nudge)', () => {
  const body = readFileSync(
    resolve(__dirname, '..', 'prompts', 'implementer.md'),
    'utf-8',
  );

  it('contains the literal scope-nudge paragraph (CLV-88)', () => {
    expect(body).toContain('**Scope nudge.** Your declared scope is `task.scope.files_touched`.');
    expect(body).toContain('walker auto-extends your scope on merge');
    expect(body).toContain('refuse contested merges');
  });
});

// ---------------------------------------------------------------------------
// CLV-93: partial-scope warning in Plan-agent gate-pending summary
// ---------------------------------------------------------------------------

describe('Plan prompt (CLV-93 — partial-scope warning in gate-pending summary)', () => {
  const body = readFileSync(
    resolve(__dirname, '..', 'prompts', 'plan.md'),
    'utf-8',
  );

  it('contains the count-instruction sentence for tasks missing scope.files_touched', () => {
    // The Plan agent must be directed to count tasks where scope.files_touched is absent or empty.
    expect(body).toContain('Count the tasks where `scope.files_touched` is absent or an empty array');
  });

  it('contains the literal warning-template string for partial-scope tasks', () => {
    // The gate-pending summary template must include this exact warning line.
    expect(body).toContain('⚠ Tasks without scope.files_touched: <CLV-XX, CLV-YY>');
  });
});

// ---------------------------------------------------------------------------
// CLV-97: notification_contract consumption — idle_after_seconds, vocab guard,
//          and Vocab dependency Notes paragraph
// ---------------------------------------------------------------------------

describe('cloverleaf-run-plan skill (CLV-97 — notification_contract consumption)', () => {
  const body = readFileSync(
    resolve(__dirname, '..', 'skills', 'cloverleaf-run-plan', 'SKILL.md'),
    'utf-8',
  );

  it('step 5b reads idle_after_seconds from notification_contract with jq // 600 fallback', () => {
    // The walker must extract IDLE_AFTER from the start_session response, falling
    // back to 600 if the field is absent. This removes the hardcoded literal 600.
    expect(body).toContain(
      "IDLE_AFTER=$(echo \"$START_SESSION_RESPONSE\" | jq -r '.notification_contract.idle_after_seconds // 600')",
    );
  });

  it('step 5b validates notification_contract.vocabulary contains DONE and NEEDS-INPUT, warns to stderr on drift', () => {
    // The skill must check that both required sentinel tokens are declared in the
    // contract's vocabulary array and emit a warning to stderr if either is missing.
    expect(body).toContain('EXPECTED_TOKENS="DONE NEEDS-INPUT"');
    // The warning must go to stderr (>&2) so it does not pollute stdout event processing.
    expect(body).toMatch(/>&2/);
    // The block must reference vocab drift in the warning text.
    expect(body).toMatch(/vocab.*drift|drift.*detected/i);
  });

  it('Notes section contains the **Vocab dependency.** paragraph', () => {
    // A Notes section with a **Vocab dependency.** heading must be present so that
    // operators understand the advisory nature of the contract check and the SDK flag
    // as the authoritative source of truth for driven tokens.
    const notesIdx = body.indexOf('## Notes');
    expect(notesIdx).toBeGreaterThan(-1);
    const notesSection = body.slice(notesIdx);
    expect(notesSection).toContain('**Vocab dependency.**');
  });
});

describe('cloverleaf-run-plan skill (v0.7.4 — Plan advance on completion)', () => {
  const body = readFileSync(
    resolve(__dirname, '..', 'skills', 'cloverleaf-run-plan', 'SKILL.md'),
    'utf-8',
  );

  it('advances Plan approved → completed via cloverleaf-cli advance-plan after final task merge', () => {
    expect(body).toMatch(/cloverleaf-cli advance-plan\s+<repo_root>\s+<PLAN-ID>\s+completed\s+agent/);
  });

  it('guards the advance on plan.status === "approved" (idempotent re-runs)', () => {
    expect(body).toMatch(/on-disk\s+`?status`?\s+is\s+`?"?approved"?`?/i);
    expect(body.toLowerCase()).toMatch(/idempotent|already at `?completed`?|skip the advance if/);
  });

  it('commits the plan-advance state change with a descriptive message', () => {
    expect(body).toMatch(/git -C <repo_root> commit -m "cloverleaf: plan <PLAN-ID> completed/);
  });
});

describe('cloverleaf-run-plan skill (v0.7.5 — RFC auto-advance via rfc-tasks)', () => {
  const body = readFileSync(
    resolve(__dirname, '..', 'skills', 'cloverleaf-run-plan', 'SKILL.md'),
    'utf-8',
  );

  it('invokes cloverleaf-cli rfc-tasks to compute the auto-advance check', () => {
    expect(body).toMatch(/cloverleaf-cli rfc-tasks\s+<repo_root>\s+"?\$?PARENT_RFC_ID"?/);
  });

  it('reads summary.can_auto_advance_rfc from the rfc-tasks output', () => {
    expect(body).toMatch(/\.summary\.can_auto_advance_rfc/);
  });

  it('advances the RFC via cloverleaf-cli advance-rfc when can_auto_advance_rfc is true', () => {
    expect(body).toMatch(/CAN_ADVANCE"?\s*=\s*"true"/);
    expect(body).toMatch(/cloverleaf-cli advance-rfc\s+<repo_root>\s+"?\$?PARENT_RFC_ID"?\s+completed\s+agent/);
  });

  it('commit message references delivered_plans AND delivered_standalone counts', () => {
    expect(body).toMatch(/cloverleaf: rfc \$PARENT_RFC_ID completed/);
    expect(body).toMatch(/delivered_plans/);
    expect(body).toMatch(/delivered_standalone/);
  });

  it('documents the three skip conditions in plain language', () => {
    const advanceIdx = body.indexOf('**RFC auto-advance');
    expect(advanceIdx).toBeGreaterThan(-1);
    const advanceBlock = body.slice(advanceIdx);
    expect(advanceBlock.toLowerCase()).toMatch(/not at\s+`?approved`?|already terminal/);
    expect(advanceBlock.toLowerCase()).toMatch(/in-flight|still pending/);
    expect(advanceBlock.toLowerCase()).toMatch(/at\s+least\s+one\s+delivered|no\s+plan.*delivered/);
  });

  it('Notes section calls out RFC-direct task participation', () => {
    const notesIdx = body.indexOf('## Notes');
    expect(notesIdx).toBeGreaterThan(-1);
    const notesSection = body.slice(notesIdx);
    expect(notesSection.toLowerCase()).toMatch(/rfc-direct|standalone task/);
  });
});

describe('README — Plans vs RFC-direct tasks section (v0.7.5)', () => {
  const readme = readFileSync(
    resolve(__dirname, '..', 'README.md'),
    'utf-8',
  );

  it('contains the section heading', () => {
    expect(readme).toMatch(/##\s+Plans vs RFC-direct tasks/);
  });

  it('describes both task-creation patterns', () => {
    expect(readme).toMatch(/\/cloverleaf-discover/);
    expect(readme).toMatch(/\/cloverleaf-new-task --rfc/);
  });

  it('documents auto-advance semantics', () => {
    expect(readme.toLowerCase()).toMatch(/can_auto_advance_rfc|advance.*completed/);
    expect(readme).toMatch(/cloverleaf-cli rfc-tasks/);
  });

  it('calls out the task_batch_gate tradeoff', () => {
    expect(readme).toMatch(/task_batch_gate/);
  });
});

describe('Site — guide chapter 4: RFC-direct tasks (v0.7.5)', () => {
  const ch4 = readFileSync(
    resolve(__dirname, '..', '..', 'site', 'src', 'content', 'guide', '04-discovery.mdx'),
    'utf-8',
  );

  it('contains the section heading', () => {
    expect(ch4).toMatch(/##\s+RFC-direct tasks/);
  });

  it('documents both use cases (hotfix + incremental)', () => {
    expect(ch4.toLowerCase()).toMatch(/hotfix/);
    expect(ch4.toLowerCase()).toMatch(/incremental/);
  });

  it('mentions cloverleaf-cli rfc-tasks for visibility', () => {
    expect(ch4).toMatch(/cloverleaf-cli rfc-tasks/);
  });

  it('calls out the task_batch_gate tradeoff', () => {
    expect(ch4).toMatch(/task_batch_gate/);
  });
});

describe('Site — guide chapter 6: Task parent clarification (v0.7.5)', () => {
  const ch6 = readFileSync(
    resolve(__dirname, '..', '..', 'site', 'src', 'content', 'guide', '06-work-items.mdx'),
    'utf-8',
  );

  it('mentions parent: null + context.rfc as the RFC-direct task shape', () => {
    expect(ch6).toMatch(/parent/);
    expect(ch6).toMatch(/context\.rfc/);
    expect(ch6.toLowerCase()).toMatch(/rfc-direct|standalone/);
  });
});

describe('Site — FAQ entry for Plan vs RFC-direct (v0.7.5)', () => {
  const faq = readFileSync(
    resolve(__dirname, '..', '..', 'site', 'src', 'pages', 'faq.astro'),
    'utf-8',
  );

  it('contains a question about Plan vs RFC → Task directly', () => {
    expect(faq.toLowerCase()).toMatch(/plan.*vs.*rfc.*task|rfc.*direct/);
  });

  it('mentions task_batch_gate as the tradeoff', () => {
    expect(faq).toMatch(/task_batch_gate/);
  });
});

describe('security-reviewer prompt (v0.8.0)', () => {
  const body = readFileSync(resolve(__dirname, '..', 'prompts', 'security-reviewer.md'), 'utf-8');
  it('has placeholders for task/diff', () => {
    expect(body).toMatch(/\{\{task\}\}/);
    expect(body).toMatch(/\{\{diff\}\}/);
  });
  it('instructs the reviewer to emit a feedback envelope with verdict + findings', () => {
    expect(body).toMatch(/verdict/);
    expect(body).toMatch(/findings/);
    expect(body).toMatch(/pass|bounce|escalate/);
  });
  it('enumerates the vulnerability classes it judges', () => {
    expect(body.toLowerCase()).toMatch(/injection/);
    expect(body.toLowerCase()).toMatch(/deserializ/);
    expect(body.toLowerCase()).toMatch(/auth/);
  });
  it('maps severity to the schema enum (info/warning/error/blocker)', () => {
    expect(body).toMatch(/blocker/);
    expect(body).toMatch(/info|warning|error/);
  });
});

describe('cloverleaf-security-review skill (v0.8.0)', () => {
  const body = readFileSync(resolve(__dirname, '..', 'skills', 'cloverleaf-security-review', 'SKILL.md'), 'utf-8');
  it('has frontmatter name cloverleaf-security-review', () => {
    expect(body).toMatch(/^---[\s\S]*?name: cloverleaf-security-review[\s\S]*?---/);
  });
  it('verifies task status is security-review', () => {
    expect(body).toMatch(/status.*security-review/);
  });
  it('runs deterministic secret-scan (Pass A)', () => {
    expect(body).toMatch(/cloverleaf-cli secret-scan <repo_root> --branch/);
  });
  it('dispatches the security-reviewer subagent (Pass B)', () => {
    expect(body).toMatch(/prompts\/security-reviewer\.md/);
    expect(body).toMatch(/subagent_type.*general-purpose/);
  });
  it('merges both passes and maps to all three transitions', () => {
    expect(body).toMatch(/blocker.*escalate|escalate.*blocker/);
    expect(body).toMatch(/automated-gates/);
    expect(body).toMatch(/implementing/);
    expect(body).toMatch(/escalated/);
  });
  it('writes feedback on non-pass', () => {
    expect(body).toMatch(/write-feedback/);
  });
});

describe('cloverleaf-new-task — security_class inference (v0.8.0)', () => {
  const body = readFileSync(resolve(__dirname, '..', 'skills', 'cloverleaf-new-task', 'SKILL.md'), 'utf-8');
  it('documents the --security=high|low override', () => {
    expect(body).toMatch(/--security=high/);
    expect(body).toMatch(/--security=low/);
  });
  it('infers security_class from sensitive markers (keyword/path)', () => {
    expect(body).toMatch(/security_class/);
    expect(body.toLowerCase()).toMatch(/sensitive|security-paths/);
  });
  it('defaults security_class to low', () => {
    expect(body).toMatch(/security_class.*low|default.*low/i);
  });
});

describe('cloverleaf-run — security gate (v0.8.0)', () => {
  const body = readFileSync(resolve(__dirname, '..', 'skills', 'cloverleaf-run', 'SKILL.md'), 'utf-8');
  it('declares a MAX_SECURITY_BOUNCES budget', () => {
    expect(body).toMatch(/MAX_SECURITY_BOUNCES\s*=\s*3/);
  });
  it('runs classify-security with the task branch', () => {
    expect(body).toMatch(/cloverleaf-cli classify-security <repo_root> <TASK-ID> --branch/);
  });
  it('advances to security-review and invokes the skill on effective high', () => {
    expect(body).toMatch(/advance-status <repo_root> <TASK-ID> security-review agent/);
    expect(body).toMatch(/cloverleaf-security-review/);
  });
  it('writes back security_class on under-classification', () => {
    expect(body.toLowerCase()).toMatch(/under-classif|write.?back|diff_detected/);
  });
  it('has a Security gate section applied in both lanes', () => {
    expect(body).toMatch(/Security gate/);
  });
});

describe('cloverleaf-run-plan — security escalation note (v0.8.0)', () => {
  const body = readFileSync(resolve(__dirname, '..', 'skills', 'cloverleaf-run-plan', 'SKILL.md'), 'utf-8');
  it('Notes mention security-review escalations are expected', () => {
    const notes = body.slice(body.indexOf('## Notes'));
    expect(notes.toLowerCase()).toMatch(/security/);
  });
});

describe('README — Security review section (v0.8.0)', () => {
  const readme = readFileSync(resolve(__dirname, '..', 'README.md'), 'utf-8');
  it('has a Security review section', () => {
    expect(readme).toMatch(/##\s+Security review/);
  });
  it('documents security_class + the two passes', () => {
    expect(readme).toMatch(/security_class/);
    expect(readme.toLowerCase()).toMatch(/secret scan|secret-scan/);
    expect(readme.toLowerCase()).toMatch(/llm|judgment|vulnerab/);
  });
  it('names the override config files', () => {
    expect(readme).toMatch(/security-paths\.json/);
    expect(readme).toMatch(/secret-patterns\.json/);
  });
});

describe('Site guide — security reviewer (v0.8.0)', () => {
  const g = (f: string) => readFileSync(resolve(__dirname, '..', '..', 'site', 'src', 'content', 'guide', f), 'utf-8');
  it('chapter 5 (delivery) mentions security-review', () => {
    expect(g('05-delivery.mdx').toLowerCase()).toMatch(/security[ -]review/);
  });
  it('chapter 7 (agents) lists the Security Reviewer', () => {
    expect(g('07-agents.mdx')).toMatch(/Security Reviewer/);
  });
  it('chapter 9 (risk) documents security_class', () => {
    expect(g('09-risk.mdx')).toMatch(/security_class/);
  });
});
