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
    expect(body).toMatch(/git merge --no-ff cloverleaf\/<TASK-ID>/);
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
