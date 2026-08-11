import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PROMPTS = resolve(__dirname, '..', 'prompts');
const SKILLS = resolve(__dirname, '..', 'skills');

function readPrompt(name: string): string {
  return readFileSync(resolve(PROMPTS, `${name}.md`), 'utf-8');
}

/**
 * Every prompt and skill body this package ships — the surface an agent reads.
 * Sweeps that close a class of prose defect run over both: a skill body is read
 * by the same agents as a prompt, so a rule that holds on only one surface
 * leaves the class open.
 */
function shippedDocs(): string[] {
  return [
    ...readdirSync(PROMPTS)
      .filter((f) => f.endsWith('.md'))
      .map((f) => resolve(PROMPTS, f)),
    ...readdirSync(SKILLS, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => resolve(SKILLS, d.name, 'SKILL.md'))
      .filter((p) => existsSync(p)),
  ];
}

/** Repo-relative label for a shippedDocs() path, so failures name the offender. */
function shippedDocLabel(path: string): string {
  return path.replace(/^.*\/(?=(prompts|skills)\/)/, '');
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

  // The PLAYWRIGHT_BROWSERS_PATH assertion that used to sit here pinned the
  // prompt's *mention* of the variable, which stayed green while the sentence
  // doing the mentioning was false on the council path. See the D2 block at the
  // end of this file for what replaced it.

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

// ---------------------------------------------------------------------------
// D1/D1b — the UI driver resolves its browser dependencies from the plugin root.
//
// History, because this replaces a guard rather than adding one. CLV-36 read the
// symptom — a driver written to /tmp could not `import 'playwright'` — as a
// *placement* problem, so the prompt grew a rule pinning drivers to `$WT/site/`
// "so that Node can resolve `playwright` from `$WT/site/node_modules/`". That
// rationale was false. `site/` declares neither `playwright` nor `axe-core`, and
// `prep-worktree` copies node_modules only into `standard/` and
// `reference-impl/`, so ESM resolution walking up from `$WT/site/` reaches
// neither package: the import failed from the mandated location too. The
// 2026-08-06 dogfood proved it behaviourally — three separate agents
// independently routed around the rule (absolute paths, a scratch `npm init`
// project, a filesystem-wide `find / -iname axe-core`).
//
// The fix anchors imports at the plugin root, where all four browser packages
// ship as runtime `dependencies` of @cloverleaf/reference-impl. Resolution no
// longer depends on where the driver sits, so the placement rule is retired
// rather than patched. What the placement rule was *incidentally* providing
// survives as an explicit obligation: a driver outside `$WT` is not swept up by
// `git worktree remove`, so teardown must delete it.
// ---------------------------------------------------------------------------
describe('ui-reviewer prompt (D1/D1b — driver dependency resolution)', () => {
  const body = readPrompt('ui-reviewer');

  it('anchors driver imports at the plugin root', () => {
    expect(body).toContain('cloverleaf-cli plugin-root');
    expect(body).toContain('createRequire');
    // The anchor must be the plugin root — not the script's own directory,
    // which is what a bare specifier uses and what D1 proved cannot work.
    expect(body).toMatch(/createRequire\(PLUGIN_ROOT/);
  });

  it('imports playwright and axe-core through that anchor, never as bare specifiers', () => {
    expect(body).toMatch(/require\('playwright'\)/);
    expect(body).toMatch(/require\('axe-core'\)/);
    // The pre-fix forms. A bare ESM specifier resolves from the importing
    // file's own directory, so it fails wherever the driver is placed.
    expect(body).not.toMatch(/import\s+[^\n]*\bfrom\s+'(playwright|axe-core)'/);
    expect(body).not.toMatch(/import\(\s*['"](playwright|axe-core)['"]\s*\)/);
  });

  it('makes deleting the driver part of teardown', () => {
    // The retired placement rule kept drivers inside $WT, where
    // `git worktree remove --force` swept them up as a side effect. Location is
    // now unconstrained, so the cleanup has to be stated outright.
    expect(body).toContain('rm -f "$DRIVER"');
    expect(body).toMatch(/[Dd]elete every driver script you wrote/);
  });

  it('uses $WT (not $TMPDIR) as the worktree variable name', () => {
    // Carried over from CLV-36 unchanged: this one is about not clobbering the
    // system $TMPDIR, and is independent of the retired placement rule.
    expect(body).toContain('WT=$(mktemp -d)');
    expect(body).not.toContain('TMPDIR=$(mktemp -d)');
  });
});

describe('ui-reviewer prompt (#6 — no ImageMagick; visual diff is compareVisual/pixelmatch)', () => {
  const body = readPrompt('ui-reviewer');

  it('forbids ImageMagick and names compareVisual/pixelmatch as the only diff path', () => {
    // CLV-108: agent improvised `convert`/`compare`; neither exists — diff is pixelmatch.
    expect(body).toContain('There is no ImageMagick');
    expect(body).toMatch(/never shell out to/i);
    expect(body).toContain('compareVisual');
    expect(body).toMatch(/pixelmatch/i);
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

  it('describes {{qa_rules}} as a { rules: [...] } object, not a bare array', () => {
    // The qa skill injects the raw qa-rules.json contents, whose shape is an object
    // { rules: [...] } — the identical value implementer.md / reviewer.md describe for
    // {{test_rules}}. qa.md must name that object shape, not a top-level "array of ... entries".
    expect(body).toMatch(/a JSON object `\{ rules:/);
    expect(body).not.toMatch(/\{\{qa_rules\}\} — array of/);
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

  it('references cloverleaf-cli qa-report as the report generation command (CLV-65)', () => {
    // Regression guard: Task 3 (F2) decoupled QA report generation from the monorepo dist/
    // path. The prompt must document the CLI subcommand so agents invoke it portably.
    expect(body).toContain('cloverleaf-cli qa-report');
  });
});

describe('reviewer prompt (v0.5.2 #B — worktree prep)', () => {
  // Reviewer also spawns a worktree when it wants to run tests; same prep helper applies.
  const body = readFileSync(resolve(__dirname, '..', 'prompts', 'reviewer.md'), 'utf-8');

  it('invokes cloverleaf-cli prep-worktree when it creates a worktree', () => {
    expect(body).toMatch(/git worktree add[\s\S]*cloverleaf-cli prep-worktree/);
  });
});

// ---------------------------------------------------------------------------
// CLV-35: bug #2 — worktree add must use --detach <path> <sha> to avoid
// "fatal: branch … is already checked out" when running inside a walker
// worktree where named branches (feature + main) are already checked out.
// ---------------------------------------------------------------------------

describe('reviewer prompt (CLV-35 — worktree add --detach)', () => {
  const body = readFileSync(resolve(__dirname, '..', 'prompts', 'reviewer.md'), 'utf-8');

  it('every git worktree add command line uses --detach (CLV-35)', () => {
    // Check each line that starts with `git worktree add` (i.e., actual command invocations,
    // not prose references). None may be missing --detach.
    const lines = body.split('\n');
    const commandLines = lines.filter(l => /^\s*git worktree add/.test(l));
    expect(commandLines.length).toBeGreaterThan(0); // sanity: prompt must have at least one
    for (const line of commandLines) {
      expect(line).toMatch(/git worktree add\s+--detach/);
    }
  });

  it('does not contain a named-branch worktree add targeting main or cloverleaf/ (CLV-35)', () => {
    expect(body).not.toMatch(/git worktree add\s+(?!--detach)\S+\s+(main|cloverleaf\/)/);
  });
});

describe('qa prompt (CLV-35 — worktree add --detach)', () => {
  const body = readPrompt('qa');

  it('every git worktree add command line uses --detach (CLV-35)', () => {
    // Check each line that starts with `git worktree add` (i.e., actual command invocations,
    // not prose references). None may be missing --detach.
    const lines = body.split('\n');
    const commandLines = lines.filter(l => /^\s*git worktree add/.test(l));
    expect(commandLines.length).toBeGreaterThan(0); // sanity: prompt must have at least one
    for (const line of commandLines) {
      expect(line).toMatch(/git worktree add\s+--detach/);
    }
  });

  it('does not contain a named-branch worktree add targeting main or cloverleaf/ (CLV-35)', () => {
    expect(body).not.toMatch(/git worktree add\s+(?!--detach)\S+\s+(main|cloverleaf\/)/);
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

// ---------------------------------------------------------------------------
// CLV-82: Plan agent prompt — scope.files_touched instruction and
//         gate-pending summary format with edge groupings
// ---------------------------------------------------------------------------

describe('plan prompt (CLV-82 — scope.files_touched and gate-pending summary)', () => {
  const body = readPrompt('plan');

  it('contains a scope.files_touched instruction for populating per-task file paths', () => {
    // The prompt must instruct the agent to populate scope.files_touched per task.
    expect(body).toContain('scope.files_touched');
    // Must reference transcribing from the brief's Parallel-DAG conflict guidance section.
    expect(body.toLowerCase()).toMatch(/parallel.dag conflict guidance|brief.*parallel.dag|transcrib/i);
  });

  it('contains the explicit directive not to manually add edges for file overlap', () => {
    // The exact required directive string.
    expect(body).toContain('Do NOT manually add edges for file overlap. The system computes them automatically when the Plan is saved.');
  });

  it('gate-pending summary template contains Logical: and Inferred from file overlap: subsections', () => {
    expect(body).toContain('Logical:');
    expect(body).toContain('Inferred from file overlap:');
    // Both must appear inside or near a gate-pending summary context.
    // Use case-insensitive search for the section heading.
    const gatePendingIdx = body.toLowerCase().indexOf('gate-pending summary');
    expect(gatePendingIdx).toBeGreaterThan(-1);
    const logicalIdx = body.indexOf('Logical:');
    const inferredIdx = body.indexOf('Inferred from file overlap:');
    // Both subsection headings must appear after the gate-pending summary template heading.
    expect(logicalIdx).toBeGreaterThan(gatePendingIdx);
    expect(inferredIdx).toBeGreaterThan(gatePendingIdx);
  });

  it('gate-pending summary template instructs agent not to add inferred edges to task_dag.edges', () => {
    // Critical: the summary is for human review only; inferred overlap edges must NOT
    // be added to task_dag.edges (the system does that automatically).
    expect(body).toMatch(/Do NOT add these to `task_dag\.edges`|do not add.*task_dag\.edges/i);
  });
});

// ---------------------------------------------------------------------------
// CLV-19: baseline-approval sidecar — ui-reviewer prompt contract
// ---------------------------------------------------------------------------

describe('ui-reviewer prompt (CLV-19 — state.json sidecar)', () => {
  const body = readPrompt('ui-reviewer');

  it('documents writing state.json with baselines_pending: true when any result is new-baseline or dimension-mismatch', () => {
    expect(body).toMatch(/state\.json/);
    expect(body).toMatch(/baselines_pending.*true|new-baseline.*dimension-mismatch|new-baseline or dimension-mismatch/i);
  });

  it('documents writing state.json with baselines_pending: false when no new-baseline or dimension-mismatch results', () => {
    expect(body).toMatch(/baselines_pending.*false/);
  });

  it('writes state.json to .cloverleaf/runs/{taskId}/ui-review/state.json', () => {
    expect(body).toMatch(/\.cloverleaf\/runs\/\{\{taskId\}\}\/ui-review\/state\.json|runs\/\{taskId\}\/ui-review\/state\.json/);
  });

  it('documents the sidecar as a gate read by the cloverleaf-ui-review skill', () => {
    expect(body).toMatch(/cloverleaf-ui-review skill|skill.*gate|gate.*skill/i);
    expect(body).toMatch(/baselines_pending/);
  });

  it('instructs writing state.json after all browser passes complete and before teardown', () => {
    // Step 12 is the write-state step; step 13 is teardown — ordering must be preserved
    expect(body).toMatch(/before teardown|after all browser passes/i);
  });
});

// ---------------------------------------------------------------------------
// CLV-48: Session B CWD drift fix — all five agent prompts must contain
// `cd "$(git rev-parse --show-toplevel)"` as the first executable instruction.
// ---------------------------------------------------------------------------

describe('CLV-48 — CWD drift fix: all agent prompts contain cd preflight', () => {
  const PROMPT_NAMES = ['implementer', 'documenter', 'reviewer', 'ui-reviewer', 'qa'] as const;

  for (const name of PROMPT_NAMES) {
    it(`${name}.md contains cd "$(git rev-parse --show-toplevel)" as first executable instruction`, () => {
      const body = readPrompt(name);
      // Must contain the exact command.
      expect(body).toContain('cd "$(git rev-parse --show-toplevel)"');
      // The command must appear before any other bash commands that would depend on cwd.
      // Verify it appears in the early portion of the file (before the main task steps).
      const cdIndex = body.indexOf('cd "$(git rev-parse --show-toplevel)"');
      expect(cdIndex).toBeGreaterThan(-1);
    });
  }

  it('implementer.md has the cd preflight before its main task steps (step 1)', () => {
    const body = readPrompt('implementer');
    const cdIndex = body.indexOf('cd "$(git rev-parse --show-toplevel)"');
    // Step 1 starts the actual process steps; cd preflight must appear before step 1
    const step1Index = body.indexOf('\n1. Read the task');
    expect(cdIndex).toBeLessThan(step1Index);
  });

  it('reviewer.md has the cd preflight before its main task steps (step 1)', () => {
    const body = readPrompt('reviewer');
    const cdIndex = body.indexOf('cd "$(git rev-parse --show-toplevel)"');
    const step1Index = body.indexOf('\n1. Read the task');
    expect(cdIndex).toBeLessThan(step1Index);
  });

  it('qa.md has the cd preflight before the worktree setup step (step 1)', () => {
    const body = readPrompt('qa');
    const cdIndex = body.indexOf('cd "$(git rev-parse --show-toplevel)"');
    const step1Index = body.indexOf('\n1. Set up an isolated worktree');
    expect(cdIndex).toBeLessThan(step1Index);
  });

  it('ui-reviewer.md has the cd preflight before the affected_routes early-exit check (step 1)', () => {
    const body = readPrompt('ui-reviewer');
    const cdIndex = body.indexOf('cd "$(git rev-parse --show-toplevel)"');
    const step1Index = body.indexOf('{{affected_routes}}');
    expect(cdIndex).toBeLessThan(step1Index);
  });
});

describe('CLV-48 — CWD drift fix: SKILL.md Session B scenario brief uses $WORKTREE_ROOT', () => {
  const { readFileSync } = require('node:fs');
  const { resolve } = require('node:path');
  const skillBody = readFileSync(
    resolve(__dirname, '..', 'skills', 'cloverleaf-run-plan', 'SKILL.md'),
    'utf-8',
  );

  it('Session B scenario brief text explicitly references $WORKTREE_ROOT', () => {
    // The brief must embed the $WORKTREE_ROOT variable so Session B knows
    // the absolute path it was launched into.
    expect(skillBody).toContain('$WORKTREE_ROOT');
  });

  it('Session B scenario brief includes `cd "$WORKTREE_ROOT"` as the first preflight instruction', () => {
    // The brief must contain the explicit cd instruction so Session B runs it
    // before any task steps, regardless of inherited cwd.
    expect(skillBody).toContain('cd "$WORKTREE_ROOT"');
  });

  it('$WORKTREE_ROOT appears in the session brief template section (not just prose)', () => {
    // Extract the "Session brief template" section from the skill body.
    const sectionMatch = skillBody.match(/## Session brief template\n([\s\S]*?)(?:\n## |$)/);
    expect(sectionMatch).not.toBeNull();
    const sectionBody = sectionMatch![1];
    // The section must contain a fenced code block with $WORKTREE_ROOT and the cd instruction.
    expect(sectionBody).toContain('$WORKTREE_ROOT');
    expect(sectionBody).toContain('cd "$WORKTREE_ROOT"');
    // Verify they appear inside a code fence (not just in prose).
    const fenceMatch = sectionBody.match(/^```[^\n]*\n([\s\S]*?)\n^```/m);
    expect(fenceMatch).not.toBeNull();
    const fenceContent = fenceMatch![1];
    expect(fenceContent).toContain('$WORKTREE_ROOT');
    expect(fenceContent).toContain('cd "$WORKTREE_ROOT"');
  });
});

// ---------------------------------------------------------------------------
// CLV-106: security-reviewer prompt — Return contract with verdict enum
// ---------------------------------------------------------------------------

describe('security-reviewer prompt (CLV-106 — Return contract verdict enum)', () => {
  const body = readPrompt('security-reviewer');

  it('names verdict as a required envelope field and enumerates pass, bounce, and escalate in order', () => {
    expect(body).toMatch(/verdict[\s\S]*pass[\s\S]*bounce[\s\S]*escalate/i);
  });

  it('documents the severity → verdict mapping (blocker → escalate, error|warning → bounce, info|none → pass)', () => {
    expect(body).toMatch(/blocker[\s\S]*escalate/i);
    expect(body).toMatch(/error[\s\S]*warning[\s\S]*bounce/i);
    expect(body).toMatch(/info[\s\S]*pass/i);
  });

  it('notes that the host skill (not the agent) persists the verdict via set-task-field', () => {
    expect(body).toMatch(/set-task-field/);
    expect(body).toMatch(/host skill|cloverleaf-security-review/i);
  });
});

describe('followup #4 — tsx module-load recipe: reviewer + qa prompts', () => {
  const PROMPT_NAMES = ['reviewer', 'qa'] as const;

  for (const name of PROMPT_NAMES) {
    it(`${name}.md documents the npx tsx module-load recipe`, () => {
      const body = readPrompt(name);
      // Names the blessed tool (appears in both the prose and the example).
      expect(body).toContain('npx tsx');
      // Canonical recipe lead — a unique marker that survives reordering.
      // (F2: prompts are now generalized — TypeScript-specific guidance is gated under
      // "TypeScript projects" but the ERR_MODULE_NOT_FOUND rationale note was removed.)
      expect(body).toContain('Loading or running a module directly');
      // Rationale anchor: both prompts must still explain WHY npx tsx is needed
      // (.ts sources + .mjs emit → bare .js import resolves to neither).
      expect(body).toContain('resolves to neither');
    });
  }
});

describe('chair.md — built-in council chair (Slice 2)', () => {
  const body = readFileSync(resolve(__dirname, '..', 'prompts', 'chair.md'), 'utf-8');
  it('documents the pass/bounce/escalate + forward output contract', () => {
    expect(body).toContain('"verdict"');
    expect(body).toContain('"forward"');
    expect(body).toContain('"rationale"');
    expect(body).toMatch(/verdict[\s\S]*pass[\s\S]*bounce[\s\S]*escalate/i);
  });
  it('states the escalate invariant (may raise, never lower)', () => {
    expect(body).toMatch(/never lower|cannot lower|only raise|raise a bounce/i);
  });
  it('substitutes the member verdicts + task', () => {
    expect(body).toContain('{{member_verdicts}}');
    expect(body).toContain('{{task}}');
  });
  it('reviews verdicts, not code', () => {
    expect(body).toMatch(/verdicts,? not code/i);
  });
});

// ---------------------------------------------------------------------------
// F7/D5 — the safe command-capture idiom, pinned across every prompt that judges
// a long command's exit status.
//
// F7 established `cmd > file 2>&1; echo "EXIT=$?"` because `cmd | tail` reports
// *tail's* exit status, so a failing run reads as success. It was written into
// implementer/reviewer/qa and pinned by no test at all — so when `ui-reviewer.md`
// was left out, nothing noticed. The 2026-08-06 dogfood caught it behaviourally:
// the ui member improvised `npm ci 2>&1 | tail -5` in all three council passes,
// while reviewer and qa — same run, same agent — used the safe form every time.
// The difference was the prompt, not the agent. Fixing only ui-reviewer.md would
// leave the class open for the next prompt that grows a long command, so the
// idiom becomes a contract here.
//
// ## Coverage bounds — what a green run does NOT prove
//
// CAPTURE_PROMPTS is a registry, not a sweep: a NEW prompt that runs a
// load-bearing command is covered only once it is added here. The negative check
// below is the sweep half, and it is deliberately narrow — it pins the exact
// `2>&1 | tail` redirect-then-pipe signature the dogfood observed. A document
// could still model `cmd | tail` with no redirect and pass. Nor does the sweep
// forbid pipelines generally: `cmd 2>/dev/null | grep -q .` in
// `skills/cloverleaf-run-plan` is a deliberate boolean test whose exit status is
// *meant* to be the last command's. Green means "no registered prompt lost the
// idiom, and no shipped prompt or skill models the observed anti-pattern", not
// "no document can mis-capture an exit status".
// ---------------------------------------------------------------------------
describe('F7/D5 — safe command capture is modelled wherever exit status is load-bearing', () => {
  // Prompts that instruct the agent to run a command and judge its success.
  // documenter/chair/plan/researcher/security-reviewer run no such command.
  const CAPTURE_PROMPTS = ['implementer', 'reviewer', 'qa', 'ui-reviewer'] as const;

  for (const name of CAPTURE_PROMPTS) {
    const body = readPrompt(name);

    it(`${name}.md models the redirect-and-check-exit-code idiom`, () => {
      expect(body).toContain('2>&1; echo "EXIT=$?"');
    });

    it(`${name}.md warns that piping the run masks its exit status`, () => {
      expect(body).toMatch(/Capture (suite|command) results safely/);
      expect(body).toMatch(/never pipe the run through `\| tail` or `\| head`/);
      expect(body).toMatch(/reports the \*last\* command's exit status/);
    });
  }

  it('no shipped prompt or skill models the redirect-then-pipe anti-pattern (`cmd 2>&1 | tail`)', () => {
    // The exact form the ui member improvised when its own prompt offered none.
    // Swept across skills too: a skill body is read by the same agents, so the
    // idiom has to hold on both surfaces or the class stays open.
    const ANTIPATTERN = /2>&1\s*\|\s*(tail|head)\b/;
    const docs = shippedDocs();
    // Guard the guard: an empty sweep would pass vacuously.
    expect(docs.length).toBeGreaterThan(20);
    const offenders = docs.filter((p) => ANTIPATTERN.test(readFileSync(p, 'utf-8')));
    expect(offenders.map(shippedDocLabel)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// D2 — an environment variable is established by the document that reads it.
//
// `ui-reviewer.md` asserted that `PLAYWRIGHT_BROWSERS_PATH` "is set to
// ~/.cache/ms-playwright before you are invoked" and then *acted* on it: step 7
// verifies each engine binary underneath the variable, and a missing binary is
// an `escalate` condition. That precondition held only on the standalone path,
// where `skills/cloverleaf-ui-review` exports the variable before dispatch. It
// was false on the council path — `skills/cloverleaf-run`, the path that now
// actually dispatches the `ui` member, never mentions the variable at all. The
// 2026-08-06 dogfood watched agents set it by hand four times.
//
// The guards were asymmetric the same way, which is why nothing caught it:
// `tests/skills.test.ts` pinned the export on the standalone skill, no test
// asserted anything about `cloverleaf-run`, and the assertion that lived in
// `describe('ui-reviewer prompt')` pinned only the prompt's *mention* of the
// variable — a green test holding a claim that was false on the path that runs.
// That assertion is superseded by this block and removed with it.
//
// The fix makes the prompt self-sufficient (`${VAR:-default}`) instead of
// adding a second caller that must remember, because a second caller that must
// remember is precisely the drift that produced D2. That is also why there is
// no council-path assertion below: under this fix the council path has no
// obligation to discharge, and a registry of dispatchers asserting they need do
// nothing would be guard theatre. The obligation lives in the one artifact
// every dispatcher shares.
//
// The `:-` form is load-bearing beyond self-healing: `README.md` documents
// `PLAYWRIGHT_BROWSERS_PATH` as a supported override for a non-default cache
// directory, so a fix that hard-coded `~/.cache/ms-playwright` would silently
// clobber it. `install.sh` already uses the same idiom.
//
// ## Coverage bounds — what a green run does NOT prove
//
// The sweep is over documents that NAME this one variable. A document that
// reads some *other* unestablished variable passes, as does one that spells
// this one differently. It pins the shape D2 actually had — naming an
// environment variable while relying on an unstated upstream contract to fill
// it — not the general class of unestablished preconditions.
// ---------------------------------------------------------------------------
describe('D2 — PLAYWRIGHT_BROWSERS_PATH is established by whoever reads it', () => {
  const body = readPrompt('ui-reviewer');

  it('ui-reviewer.md exports the variable itself, deferring to a caller that set it', () => {
    expect(body).toContain(
      'export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"',
    );
  });

  it('ui-reviewer.md no longer claims a caller set the variable before dispatch', () => {
    // The false precondition itself. It read as fact, so a member acting on an
    // empty variable could return a spurious `escalate` and stop a UI task.
    expect(body).not.toMatch(/PLAYWRIGHT_BROWSERS_PATH[^\n]*before you are invoked/);
  });

  it('no shipped prompt or skill names the variable without also setting it', () => {
    const docs = shippedDocs();
    // Guard the guard: an empty sweep would pass vacuously.
    expect(docs.length).toBeGreaterThan(20);
    const offenders = docs.filter((p) => {
      const text = readFileSync(p, 'utf-8');
      return text.includes('PLAYWRIGHT_BROWSERS_PATH') && !/PLAYWRIGHT_BROWSERS_PATH=/.test(text);
    });
    expect(offenders.map(shippedDocLabel)).toEqual([]);
  });

  it('every shipped prompt or skill that sets the variable defers to an existing value', () => {
    // The forward-looking half of the council-path obligation. A dispatcher is
    // free to set the variable — `cloverleaf-ui-review` does, to spare the
    // subagent a cache lookup — but it must not overwrite an operator's
    // non-default cache directory, which `README.md` documents as supported.
    // `cloverleaf-ui-review` hard-coded `~/.cache/ms-playwright` and did exactly
    // that; if `cloverleaf-run` ever grows the same step, this catches it.
    const SAFE = 'PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-';
    const docs = shippedDocs();
    expect(docs.length).toBeGreaterThan(20);
    const offenders = docs.filter((p) =>
      readFileSync(p, 'utf-8')
        .split('\n')
        .some((line) => line.includes('PLAYWRIGHT_BROWSERS_PATH=') && !line.includes(SAFE)),
    );
    expect(offenders.map(shippedDocLabel)).toEqual([]);
  });

  it('no shipped prompt or skill assigns a tilde inside double quotes', () => {
    // `VAR="~/x"` yields a literal `~` directory: the shell expands `~` only
    // when it is unquoted. The obvious transcription of this fix is exactly
    // that mistake, so the trap is swept rather than merely mentioned.
    const docs = shippedDocs();
    expect(docs.length).toBeGreaterThan(20);
    const offenders = docs.filter((p) => /="~\//.test(readFileSync(p, 'utf-8')));
    expect(offenders.map(shippedDocLabel)).toEqual([]);
  });
});

/**
 * The fenced shell blocks of a markdown doc — the commands a doc *models*, as
 * distinct from its prose, which may name a command precisely in order to
 * forbid it. Untagged fences count as shell: the shipped docs open ~40 of them.
 */
function shellBlocks(text: string): string[] {
  const SHELL_LANGS = new Set(['', 'bash', 'sh', 'shell']);
  const blocks: string[] = [];
  const fence = /```([a-z]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text)) !== null) {
    if (SHELL_LANGS.has(m[1])) blocks.push(m[2]);
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// D4 — an order to kill a process ships with the handle to kill by.
//
// Nothing in this package ever modelled `pkill`; the defect was an absence.
// `skills/cloverleaf-ui-review` ordered the *orchestrator* to "always teardown
// preview server + worktree on error" — but the orchestrator starts neither.
// The subagent creates the worktree (`ui-reviewer.md` step 2) and backgrounds
// the dev server (step 3), so `$WT` and `$SERVER_PID` live in a different
// agent's shell. Ordered to kill something it had no handle on, the agent
// improvised from the one anchor it did hold, the port it allocated:
// `pkill -f "port=44953"`. That pattern also matches the command line of the
// shell running it, so the shell kills itself — exit 144, and every command
// after it in the same compound statement silently never runs. The 2026-08-06
// dogfood watched this five times; three of them skipped the `rm -rf` /
// `git worktree remove` that followed, leaving worktrees registered.
//
// So the fix is not a prohibition. It is supplying the missing form and
// correcting who is being ordered: `ui-reviewer.md` already models the right
// shape (`SERVER_PID=$!` … `kill $SERVER_PID`), and the two sites that ordered
// a kill without naming a handle now either name one or hand the duty back to
// the agent that holds it. The prohibition rides along as the reason.
//
// ## Coverage bounds — what a green run does NOT prove
//
// The sweep is scoped to *fenced shell blocks*, not prose. A doc that names
// `pkill` in order to forbid it is the fix, not the defect — and the prose this
// patch adds does exactly that, which is why a whole-file sweep would have had
// to be weakened or would have failed on its own fix. So it pins "no shipped
// doc MODELS a pattern kill" and says nothing about prose. It also pins only
// the `pkill` spelling: `killall`, `kill $(pgrep -f …)`, and `fuser -k` are the
// same mistake and would pass.
// ---------------------------------------------------------------------------
describe('D4 — a teardown order names the handle it kills by', () => {
  const prompt = readPrompt('ui-reviewer');
  const skill = readFileSync(resolve(SKILLS, 'cloverleaf-ui-review', 'SKILL.md'), 'utf-8');

  it('no shipped prompt or skill models a pattern kill in a shell block', () => {
    const docs = shippedDocs();
    // Guard the guard, twice. This sweep passed vacuously before the fix —
    // nothing shipped `pkill` then either — so it must be shown to be looking
    // at a non-empty document set AND at non-empty shell blocks. A fence regex
    // that silently matched nothing would read exactly like a pass.
    expect(docs.length).toBeGreaterThan(20);
    const blocks = docs.flatMap((p) => shellBlocks(readFileSync(p, 'utf-8')));
    expect(blocks.length).toBeGreaterThan(100);
    const offenders = docs.filter((p) =>
      shellBlocks(readFileSync(p, 'utf-8')).some((b) => /\bpkill\b/.test(b)),
    );
    expect(offenders.map(shippedDocLabel)).toEqual([]);
  });

  it('ui-reviewer.md captures the server PID and tears down by it', () => {
    // The reference form the other two sites point at. Pinned so it cannot be
    // removed out from under them.
    expect(prompt).toContain('SERVER_PID=$!');
    expect(prompt).toContain('kill $SERVER_PID');
  });

  it('ui-reviewer.md says why a pattern kill would abort the rest of teardown', () => {
    // The `rm -f "$DRIVER"` and `git worktree remove` that follow the kill are
    // exactly what got skipped, so the reason has to travel with the form.
    expect(prompt).toMatch(/never by command-line pattern/i);
    expect(prompt).toMatch(/exit 144/);
  });

  it('ui-reviewer.md step 4 names the handle instead of saying "kill it"', () => {
    // Ordering a kill at the one moment the agent doubts its PID is good is
    // where it reaches for a pattern instead.
    expect(prompt).not.toMatch(/fails to start in 30s, kill it/);
    expect(prompt).toMatch(/fails to start in 30s[^\n]*\$SERVER_PID/);
  });

  it('cloverleaf-ui-review gives teardown to the agent that holds the handles', () => {
    // The orchestrator holds neither `$SERVER_PID` nor `$WT`; its own cleanup
    // is bounded to what it can reach from the repo root.
    expect(skill).not.toMatch(/^- Always teardown preview server \+ worktree on error\.$/m);
    expect(skill).toMatch(/\$SERVER_PID/);
    expect(skill).toMatch(/worktree prune/);
  });

  it('cloverleaf-ui-review forbids the pattern kill and gives the reason', () => {
    // Named literally: the prohibition has to fire at the moment the agent is
    // about to type it, which a paraphrase would not do.
    expect(skill).toMatch(/pkill -f/);
    expect(skill).toMatch(/exit 144/);
  });
});

// ---------------------------------------------------------------------------
// D6 — a captured baseline contains only what ships.
//
// Step 3 started the preview with `npm run dev`, so Astro's dev server injected
// its dev toolbar into every page the ui member screenshotted, and every tracked
// baseline carried it: a dark pill over the bottom-centre of the frame. Dev-only
// UI absent from production, occluding the exact region a bottom-of-page
// regression appears in, and coupling each baseline to the Astro version that
// drew it. Pre-existing, not a regression — the oldest tracked baselines have it.
//
// The fix disables the toolbar rather than changing what is served. Two other
// routes were priced and rejected. Capturing against `npm run preview` needs a
// prior build, and `site/package.json`'s build is `astro check && astro build`,
// so an unrelated type error would fail a purely visual review; it also assumes
// the UI directory has a `preview` script, which `ui-paths.json` — scoping that
// directory to anything — does not guarantee. Setting `devToolbar: { enabled:
// false }` in `site/astro.config.mjs` repairs only this repo's own site and
// leaves every adopter's config untouched, which is the shape D1's fix was
// rejected for. Astro's preference is project-scoped by default: run inside the
// throwaway worktree it turns the toolbar off for that capture alone, writing
// into a directory step 13 deletes, and it removes the element from the DOM
// rather than hiding it — so the axe pass in step 8c also stops attributing the
// toolbar's own violations to the site.
//
// ## Coverage bounds — what a green run does NOT prove
//
// No assertion here looks at a PNG. Proving "no toolbar in the baseline" needs a
// browser, a server and a capture run; these pin the *instruction*, not the
// pixels, and that limit is real rather than papered over.
//
// The sweep matches one document today, because `ui-reviewer.md` is the only
// shipped doc that starts a dev server. It exists so the second one cannot
// arrive without the disable. It is scoped to fenced shell blocks for the same
// reason D4's is: `skills/cloverleaf-ui-review` names `astro dev` in prose in
// order to forbid a pattern kill, so a whole-file sweep would demand a toolbar
// disable from a document that starts no server. It keys on the `npm run dev` /
// `astro dev` spellings, so a doc that starts a server as `vite`, `next dev` or
// a Makefile target would pass.
// ---------------------------------------------------------------------------
describe('D6 — a captured baseline contains only what ships', () => {
  const prompt = readPrompt('ui-reviewer');
  const DEV_SERVER = /\b(?:npm run dev|astro dev)\b/;
  const DISABLE = 'astro preferences disable devToolbar';

  /** Every fenced shell block, across all shipped docs, that starts a dev server. */
  function devServerBlocks(): Array<{ label: string; block: string }> {
    return shippedDocs().flatMap((p) =>
      shellBlocks(readFileSync(p, 'utf-8'))
        .filter((b) => DEV_SERVER.test(b))
        .map((block) => ({ label: shippedDocLabel(p), block })),
    );
  }

  it('every block that starts a dev server disables the toolbar first', () => {
    // Ordering is the rule, not mere presence: Astro decides whether to inject
    // the toolbar when the dev server boots, so a disable issued afterwards
    // leaves an already-running server still injecting it.
    //
    // Scoped to the block that starts the server rather than the file, because a
    // file-wide check is satisfied by prose that merely *mentions* the disable
    // while the modelled command sequence still starts the server undisabled.
    const docs = shippedDocs();
    // Guard the guard, twice. An empty document set and a fence matcher that
    // silently matched nothing both read exactly like a pass.
    expect(docs.length).toBeGreaterThan(20);
    const blocks = devServerBlocks();
    expect(blocks.length).toBeGreaterThan(0);
    const offenders = blocks.filter(({ block }) => {
      const disableAt = block.indexOf(DISABLE);
      return disableAt === -1 || disableAt > block.search(DEV_SERVER);
    });
    expect(offenders.map((o) => o.label)).toEqual([]);
  });

  it('ui-reviewer.md is the doc that sweep is holding', () => {
    // The sweep goes vacuous for the one document that matters if step 3 is ever
    // rewritten to start the server outside a fence, or under a spelling
    // DEV_SERVER does not know. Then `blocks.length > 0` could still pass on some
    // future doc while ui-reviewer.md quietly slipped out of coverage.
    expect(devServerBlocks().map((o) => o.label)).toContain('prompts/ui-reviewer.md');
  });

  it('no shipped doc models the preference globally', () => {
    // `--global` writes to the operator's home, outside anything teardown
    // deletes, and changes every other Astro project on the machine. The
    // worktree-scoped default is the whole reason this route beats editing a
    // tracked astro config, so the escape hatch is swept, not just warned about.
    //
    // Fenced, for D4's reason: step 3's prose forbids `--global` by naming it,
    // because a prohibition has to fire at the moment the agent is about to type
    // it. A whole-file sweep failed on this patch's own fix.
    const docs = shippedDocs();
    expect(docs.length).toBeGreaterThan(20);
    const blocks = docs.flatMap((p) => shellBlocks(readFileSync(p, 'utf-8')));
    expect(blocks.length).toBeGreaterThan(100);
    const offenders = docs.filter((p) =>
      shellBlocks(readFileSync(p, 'utf-8')).some((b) => /astro preferences[^\n]*--global/.test(b)),
    );
    expect(offenders.map(shippedDocLabel)).toEqual([]);
  });

  it('ui-reviewer.md carries the reason and the non-Astro fallback', () => {
    // D4's lesson: the reason has to travel with the form, or the next agent
    // reads the command as ceremony and drops it. And the member cannot assume
    // its UI directory is Astro, so a failed disable needs a stated next move
    // rather than a silently contaminated baseline.
    expect(prompt).toMatch(/only what ships/i);
    expect(prompt).toMatch(/project-scoped/i);
    expect(prompt).toMatch(/not an Astro project/i);
    // The fallback has to be an *action*, not just the condition named — the
    // one-line fence comment satisfies the check above on its own, so without
    // this the member could be told it is off-Astro and nothing to do about it.
    expect(prompt).toMatch(/emit an `info` finding/);
  });
});
