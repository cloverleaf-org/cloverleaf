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

  it('instructs the Documenter to stage ALL modified docs via git status before committing (v0.5.3 #C)', () => {
    // Regression guard for the three-Delivery-repro bug (CLV-16, CLV-17, CLV-18): the
    // Documenter consistently committed only CHANGELOG.md even when it had also edited
    // README.md in the same worktree. Fix pushes the Documenter to read `git status`
    // and explicitly stage every modified doc file before committing.
    expect(body).toMatch(/git status/);
    // Must mention staging every modified file, not only CHANGELOG.md.
    expect(body.toLowerCase()).toMatch(/all (the )?modified|each modified|every (modified|edited)/);
  });

  it('warns about the specific CHANGELOG-only commit failure mode (v0.5.3 #C)', () => {
    // The prompt should explicitly call out the README-omission failure mode so the
    // subagent doesn't fall back into it the next time it runs.
    expect(body.toLowerCase()).toMatch(/forgotten? readme|readme\.md[^\n]*committed only changelog|only changelog\.md when it edited both/);
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

  it('documents the {{ui_review_config}} placeholder', () => {
    expect(body).toContain('{{ui_review_config}}');
  });

  it('references multi-viewport screenshotting', () => {
    expect(body.toLowerCase()).toMatch(/viewport(s)?/);
    expect(body).toMatch(/mobile|tablet|desktop/i);
  });

  it('references visual diff via pixelmatch / baselines', () => {
    expect(body.toLowerCase()).toMatch(/visual[- ]diff|pixelmatch|baseline/);
    expect(body).toMatch(/\.cloverleaf\/baselines/);
  });

  it('documents info-severity for visual-diff findings', () => {
    expect(body.toLowerCase()).toMatch(/severity.*info|info.*severity|severity[^\n]*"info"/);
    expect(body).toMatch(/visual[- ]diff/i);
  });

  it('documents axe dedupe by (ruleId, target) with viewports aggregated', () => {
    expect(body.toLowerCase()).toMatch(/dedupe|aggregat/);
    expect(body).toMatch(/viewports/);
  });

  it('forbids touching source code', () => {
    expect(body.toLowerCase()).toMatch(/read[-\s]only|do not.*(modify|edit).*source/);
  });

  it('does not tell agents to emit location as a URL string (schema requires object)', () => {
    expect(body).not.toMatch(/"location":\s*"<url/);
    expect(body).toMatch(/location.*object|omit.*location/i);
  });

  it('documents the {{affected_routes}} placeholder', () => {
    expect(body).toContain('{{affected_routes}}');
  });

  it('documents empty-set early-exit behavior', () => {
    expect(body.toLowerCase()).toMatch(/no renderable routes affected|skipping axe/);
  });

  it('documents "all" sentinel crawl fallback', () => {
    expect(body).toMatch(/"all"/);
    expect(body.toLowerCase()).toMatch(/v0\.2.*(behavior|crawl)|crawl.*up to 20/);
  });

  it('notes PLAYWRIGHT_BROWSERS_PATH cache resolution', () => {
    expect(body).toContain('PLAYWRIGHT_BROWSERS_PATH');
  });

  it('checks .cloverleaf/config/astro-base.json before parsing astro config', () => {
    expect(body).toContain('.cloverleaf/config/astro-base.json');
    expect(body.toLowerCase()).toMatch(/check.*astro-base|astro-base.*first|consumer.*override|before parsing/);
  });

  it('documents astro-config parse as fallback', () => {
    expect(body.toLowerCase()).toMatch(/fallback|if absent|otherwise/);
    expect(body).toMatch(/astro\.config/);
  });

  it('has a Paths section distinguishing worktree from repoRoot (v0.4.1 #4)', () => {
    expect(body.toLowerCase()).toContain('paths');
    expect(body).toContain('worktree');
    expect(body).toContain('{{repo_root}}');
  });

  it('roots compareVisual paths at {{repo_root}}, not worktree', () => {
    expect(body).toMatch(/baselinePath\s*=\s*\{\{repo_root\}\}\/\.cloverleaf\/baselines/);
  });

  it('uses browser-subdirectory layout for baselinePath ({browser}/{slug}-{viewport}.png)', () => {
    // Must reference the new layout: baselines/{browser}/{slug}-{viewport}.png
    expect(body).toMatch(/\.cloverleaf\/baselines\/\{browser\}\/\{slug\}-\{viewport\}\.png/);
    // Must NOT reference the deprecated flat layout: baselines/{slug}-{viewport}.png
    expect(body).not.toMatch(/\.cloverleaf\/baselines\/\{[^b][^r][^o][^w][^s][^e][^r]\}/);
  });

  it('uses browser-subdirectory layout in attachment label paths', () => {
    // Output schema attachment for "baseline" label must reference the new layout
    expect(body).toMatch(/"baseline".*\.cloverleaf\/baselines\/\{browser\}/s);
  });

  it('documents deprecated flat layout as replaced by baselines/{browser}/', () => {
    // The prompt should not contain the old flat pattern as an active path
    // (i.e., baselines/{slug}-{viewport}.png directly)
    expect(body).not.toMatch(/baselines\/\{slug\}-\{viewport\}\.png/);
  });

  it('documents the axe.ignored allowlist (v0.4.1 #6)', () => {
    expect(body).toContain('axe.ignored');
    expect(body.toLowerCase()).toMatch(/allowlist|ignored/);
  });

  // -------------------------------------------------------------------------
  // CLV-18: 3-browser outer loop, per-engine escalation, axe chromium-only,
  // maxCombinations cap
  // -------------------------------------------------------------------------

  it('documents browsers as the outermost loop (CLV-18)', () => {
    // The prompt must describe iterating over config.browsers as outer loop
    expect(body).toMatch(/browsers.*outermost|outer.*loop.*browser|per-browser.*outer/i);
  });

  it('documents per-browser escalation for missing binaries (CLV-18)', () => {
    // Must name the install command for the missing engine
    expect(body).toContain('npx playwright install webkit firefox');
  });

  it('documents per-browser escalation includes Linux install-deps hint (CLV-18)', () => {
    expect(body).toContain('npx playwright install-deps webkit');
  });

  it('documents that axe runs only on the configured axe.browser (CLV-18)', () => {
    // Must say something like "only when browser === axe.browser" or equivalent
    expect(body).toMatch(/axe\.browser/);
    expect(body).toMatch(/only.*axe\.browser|axe\.browser.*only|skip.*axe|axe.*skip/i);
  });

  it('documents that webkit and firefox produce no axe findings (CLV-18)', () => {
    expect(body).toMatch(/webkit.*no axe|firefox.*no axe|no axe.*webkit|no axe.*firefox/i);
  });

  it('documents maxCombinations cap enforcement (CLV-18)', () => {
    expect(body).toMatch(/maxCombinations/);
    expect(body).toMatch(/ui-review-cap/);
  });

  it('documents skipped route warning with rule ui-review-cap (CLV-18)', () => {
    expect(body).toContain('ui-review-cap');
    expect(body).toMatch(/warning.*ui-review-cap|ui-review-cap.*warning/i);
  });

  it('documents floor(maxCombinations / (viewports x browsers)) route selection (CLV-18)', () => {
    // The cap math: floor(maxCombinations / (viewportCount × browserCount))
    expect(body).toMatch(/floor\(maxCombinations\s*\/\s*\(viewportCount\s*[×x*]\s*browserCount\)\)/i);
  });

  it('references lib/ui-browser.ts helpers (CLV-18)', () => {
    expect(body).toContain('lib/ui-browser.ts');
    expect(body).toContain('applyMaxCombinationsCap');
    expect(body).toContain('buildBrowserEscalationFinding');
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

  it('documents writing a QA HTML report under .cloverleaf/runs/{taskId}/qa/', () => {
    expect(body).toContain('.cloverleaf/runs');
    expect(body).toContain('qa/report.html');
  });

  it('documents attaching the report via finding.attachments', () => {
    expect(body.toLowerCase()).toMatch(/attachment/);
    expect(body).toContain('report');
  });

  it('invokes cloverleaf-cli prep-worktree after git worktree add (v0.5.2 #B)', () => {
    // Regression guard: QA was hitting `Cannot find module '@cloverleaf/standard/validators/index.js'`
    // in fresh worktrees on CLV-16 and CLV-17 Delivery runs. prep-worktree primes the worktree.
    expect(body).toMatch(/cloverleaf-cli prep-worktree[^\n]*\{\{repo_root\}\}[^\n]*"?\$TMPDIR"?/);
  });
});

describe('reviewer prompt (v0.5.2 #B — worktree prep)', () => {
  // Reviewer also spawns a worktree when it wants to run tests; same prep helper applies.
  const body = readFileSync(resolve(__dirname, '..', 'prompts', 'reviewer.md'), 'utf-8');

  it('invokes cloverleaf-cli prep-worktree when it creates a worktree', () => {
    expect(body).toMatch(/git worktree add[\s\S]*cloverleaf-cli prep-worktree/);
  });
});

describe('researcher prompt', () => {
  const body = readPrompt('researcher');

  it('has all required placeholders', () => {
    expect(body).toContain('{{operation}}');
    expect(body).toContain('{{brief}}');
    expect(body).toContain('{{doc_context_uri}}');
    expect(body).toContain('{{repo_root}}');
    expect(body).toContain('{{spike}}');
  });

  it('has no stale placeholders', () => {
    expect(body).not.toMatch(/\{\{[^}]*TODO[^}]*\}\}/);
    expect(body).not.toMatch(/XXX|TBD/);
  });

  it('specifies both operations', () => {
    expect(body).toMatch(/draftRfc/);
    expect(body).toMatch(/runSpike/);
  });

  it('specifies JSON output contract with schema references', () => {
    expect(body.toLowerCase()).toMatch(/rfc\.schema\.json/);
    expect(body.toLowerCase()).toMatch(/spike\.schema\.json/);
  });

  it('references unknowns[] for RFC uncertainties (not rfc.spikes[])', () => {
    expect(body).toMatch(/unknowns/);
    // Spike IDs must come from separate spike work items, not embedded in the RFC.
    expect(body).not.toMatch(/rfc\.spikes\s*\[/);
  });
});

describe('plan prompt', () => {
  const body = readPrompt('plan');

  it('has all required placeholders', () => {
    expect(body).toContain('{{rfc}}');
    expect(body).toContain('{{spikes}}');
    expect(body).toContain('{{doc_context_uri}}');
    expect(body).toContain('{{repo_root}}');
    expect(body).toContain('{{path_rules}}');
  });

  it('specifies breakdown operation', () => {
    expect(body).toMatch(/breakdown/);
  });

  it('specifies edge-based task_dag (nodes + edges), not blockedBy', () => {
    expect(body).toMatch(/task_dag/);
    expect(body).toMatch(/edges/);
    // Should NOT describe the DAG with blockedBy fields on nodes.
    expect(body).not.toMatch(/blockedBy/);
  });

  it('specifies inline tasks[] with task.schema.json conformance', () => {
    expect(body).toMatch(/tasks\[/);
    expect(body).toMatch(/task\.schema\.json/);
  });

  it('references plan.schema.json', () => {
    expect(body.toLowerCase()).toMatch(/plan\.schema\.json/);
  });

  it('specifies tasks start at status=pending (not todo)', () => {
    expect(body).toMatch(/pending/);
    // "todo" is not a valid task status — guard against future drift.
    expect(body).not.toMatch(/status.*todo/);
  });

  it('has no stale placeholders', () => {
    expect(body).not.toMatch(/\{\{[^}]*TODO[^}]*\}\}/);
    expect(body).not.toMatch(/XXX|TBD/);
  });
});
