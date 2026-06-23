---
name: cloverleaf-run
description: End-to-end orchestrator. Reads task.risk_class to dispatch fast lane (implement → review → merge) or full pipeline (implement → document → review → [ui-review?] → qa → final-merge). Per-agent bounce counters (max 3 each). Usage — /cloverleaf-run <TASK-ID>.
---

# Cloverleaf — run (orchestrator)

## Branch discipline

`<repo_root>` is `$(git rev-parse --show-toplevel)` of your current working directory. In walker context (Session B inside `$WORKTREE_ROOT`), this is the worktree path, NOT the primary repo. Pass `<repo_root>` explicitly to every `cloverleaf-cli` invocation, and run `git add .cloverleaf/ && git commit` from `<repo_root>` so state-advance commits land on the worktree's current branch (`cloverleaf/<TASK-ID>` in walker mode).

Do NOT `git checkout main` from a walker worktree — main is held by the primary repo. To compare against main, use `git diff main..HEAD` or `git show main:<path>`. Sub-skills run from the worktree's current branch and stay on it; the walker (in the primary repo) does the final merge to main itself after all tasks reach final-gate.

## Per-agent bounce budget

```
MAX_REVIEWER_BOUNCES    = 3
MAX_UI_REVIEWER_BOUNCES = 3
MAX_QA_BOUNCES          = 3
MAX_SECURITY_BOUNCES    = 3
```

These counters live in-session (not persisted). Rerunning `/cloverleaf-run` resets.

## Security gate (both lanes)

Run this immediately after the task reaches `automated-gates` (Reviewer passed) and BEFORE the lane's next move (fast lane: merge; full pipeline: detect-ui-paths). Initialize `security_bounces = 0` at orchestrator start (alongside the other bounce counters).

```bash
cloverleaf-cli classify-security <repo_root> <TASK-ID> --branch cloverleaf/<TASK-ID>
```

Parse the JSON. If `classify-security` exits non-zero or emits unparseable output, do NOT silently skip security review (fail-open is unsafe for a security gate). Warn to the user and treat the task as `effective: "high"` — i.e. proceed into security-review anyway (fail toward more scrutiny). If `/cloverleaf-security-review` then cannot run either (e.g. branch/tooling broken), surface the failure and stop rather than merging unreviewed.

If `effective == "low"` → skip the gate, proceed with the lane.

If `effective == "high"`:
- If `declared == "low"` (under-classification: `diff_detected` true), you may proactively run `classify-security` to confirm, but the writeback to `security_class: "high"` is now mechanical — the CLI handles it automatically when `advance-status` moves the task to `security-review`. No manual scripting of the writeback is required.
- `cloverleaf-cli advance-status <repo_root> <TASK-ID> security-review agent`; commit.
- Inline `/cloverleaf-security-review <TASK-ID>` steps. Reload the task:
  - `status == "automated-gates"` → security review passed; proceed with the lane.
  - `status == "implementing"` → bounced. `security_bounces += 1`. If `security_bounces >= MAX_SECURITY_BOUNCES`, escalate (section 6). Else re-enter the implement→review loop (fast lane section 4 / full pipeline section 5.1), which re-runs the security gate on its next pass.
  - `status == "escalated"` → the security reviewer found a blocker; stop and surface to the user (a human must review `.cloverleaf/feedback/`). This is the security reviewer's own escalation, distinct from a bounce-budget exhaustion.

### Refusal and recover

In v0.8.1, `advance-status` from `automated-gates` to any post-gate state (`ui-review`, `qa`, `merged`) may exit with **exit code 2** when the task is high-security and has no pass verdict recorded (`security_review_verdict` is absent or not `"pass"`). This is a **security-gate refusal** — the CLI is enforcing that high-security tasks must pass security review before proceeding.

Recovery sequence:
1. Advance the task to `security-review` first: `cloverleaf-cli advance-status <repo_root> <TASK-ID> security-review agent`; commit.
2. Run `/cloverleaf-security-review <TASK-ID>` to execute the security review.
3. Retry the original `advance-status` call. If the review passed, the CLI will now allow the transition.

## Steps

1. Capture TASK-ID.

2. Load task: `cloverleaf-cli load-task <repo_root> <TASK-ID>`. Verify `status === "pending"`. If not, report and stop.

3. **Council gate detection (opt-in).** Run `cloverleaf-cli council-plan <repo_root> <TASK-ID> task.review` and parse the JSON plan. If `plan.source === "consumer"` **and** `plan.profile !== null`, the project has opted into a configured review council — drive the review phase via **section 7 (Council review path)** instead of the hardcoded reviewer/security/ui/qa steps in sections 4/5. Otherwise (`source: "default"`, or no `task.review` binding) proceed exactly as today:
   - `task.risk_class === "low"` → section 4 (Fast Lane)
   - `task.risk_class === "high"` → section 5 (Full Pipeline)

   When the council path is active it still uses the Implementer (and, for the full pipeline, the Documenter) to produce the branch; only the review→merge portion is council-driven.

### 4. Fast Lane

Initialize `reviewer_bounces = 0`, `security_bounces = 0`.

Loop:
  a. Inline `/cloverleaf-implement <TASK-ID>` steps.
  b. Inline `/cloverleaf-review <TASK-ID>` steps.
  c. Reload task. If `status === "automated-gates"`: pass! Break loop.
  d. If `status === "implementing"`: Reviewer bounced. `reviewer_bounces += 1`. If `reviewer_bounces >= MAX_REVIEWER_BOUNCES`, escalate (section 6). Else continue loop.
  e. Else: unexpected state. Report and stop.

After loop (status `automated-gates`): run the **Security gate (both lanes)** (above). Then inline `/cloverleaf-merge <TASK-ID>`.

### 5. Full Pipeline

Initialize `reviewer_bounces = 0`, `ui_reviewer_bounces = 0`, `qa_bounces = 0`, `security_bounces = 0`.

5.1. **Implementer → Documenter → Reviewer loop:**

Loop:
  a. Inline `/cloverleaf-implement <TASK-ID>` steps.
  b. Inline `/cloverleaf-document <TASK-ID>` steps.
  c. Inline `/cloverleaf-review <TASK-ID>` steps.
  d. Reload task. If `status === "automated-gates"`: pass! Exit this loop.
  e. If `status === "implementing"`: Reviewer bounced. `reviewer_bounces += 1`. If `reviewer_bounces >= MAX_REVIEWER_BOUNCES`, escalate. Else continue loop.
  f. Else: unexpected. Report and stop.

**Security gate.** Run the **Security gate (both lanes)** (above) now, before UI-path detection. Then continue to 5.2.

5.2. **UI-path detection and conditional UI Review:**

```bash
cloverleaf-cli detect-ui-paths <repo_root> <TASK-ID>
```

If output is `true`:
  - Advance: `cloverleaf-cli advance-status <repo_root> <TASK-ID> ui-review agent --path=full_pipeline`. Commit.
  - UI-review loop:
    a. Inline `/cloverleaf-ui-review <TASK-ID>` steps.
    b. Reload task. If `status === "qa"`: pass! Exit UI-review loop.
    c. If `status === "implementing"`: UI Reviewer bounced. `ui_reviewer_bounces += 1`. If `>= MAX_UI_REVIEWER_BOUNCES`, escalate. Else return to section 5.1 (Implementer re-runs, which then re-documents, re-reviews).
    d. Else: unexpected. Report and stop.

If output is `false`: skip UI review. Advance: `cloverleaf-cli advance-status <repo_root> <TASK-ID> qa agent --path=full_pipeline`. Commit.

5.3. **QA loop:**

Loop:
  a. Inline `/cloverleaf-qa <TASK-ID>` steps.
  b. Reload task. If `status === "final-gate"`: pass! Exit loop.
  c. If `status === "implementing"`: QA bounced. `qa_bounces += 1`. If `qa_bounces >= MAX_QA_BOUNCES`, escalate. Else return to section 5.1.
  d. Else: unexpected. Report and stop.

5.4. **Final merge:** Inline `/cloverleaf-merge <TASK-ID>` steps (branches to full-pipeline gate per state).

### 6. Escalation

- `cloverleaf-cli advance-status <repo_root> <TASK-ID> escalated agent`
- Commit: `git add .cloverleaf/ && git commit -m "cloverleaf: <TASK-ID> escalated (bounce budget exhausted)"`.
- Report: "✗ Escalated `<TASK-ID>`. Review `.cloverleaf/feedback/` and either refine the task or take over manually. Counters: reviewer=<N>, ui_reviewer=<N>, qa=<N>, security=<N>."

### 7. Council review path (opt-in; active when council-plan source is "consumer")

Initialize `council_bounces = 0`.

7.1 **Produce the branch.** Run the Implementer (`/cloverleaf-implement <TASK-ID>` steps); for `risk_class: "high"` also run the Documenter (`/cloverleaf-document <TASK-ID>` steps). The task reaches `review`.

7.2 **Run the council members (verdict-only).** Re-run `cloverleaf-cli council-plan <repo_root> <TASK-ID> task.review` to get `plan.rounds`, `plan.aggregation`, `plan.on_round_bounce`. For each round **in order**, for each member in the round, dispatch the member's prompt as a **read-only** subagent and capture its `{verdict, summary, findings}` envelope — do **not** advance state:
   - `reviewer` → `prompts/reviewer.md`, feedback prefix `r`
   - `security` → `prompts/security-reviewer.md`, prefix `s`
   - `ui` → `prompts/ui-reviewer.md`, prefix `u`
   - `qa` → `prompts/qa.md`, prefix `q`

   **Dispatch conventions:** invoke the Task tool in foreground (default — never `run_in_background`); do not poll with foreground `sleep`. Substitute `{{task}}`, `{{branch}}` (`cloverleaf/<TASK-ID>`), `{{base_branch}}` (`main`), `{{repo_root}}`, `{{diff}}` (`git diff main..cloverleaf/<TASK-ID>`).

   Persist each member's envelope: `echo '<envelope>' > /tmp/clv-council-<member>.json && cloverleaf-cli write-feedback <repo_root> <TASK-ID> /tmp/clv-council-<member>.json --prefix=<r|s|u|q>`. Collect a members array `[{ "member": "<id>", "verdict": "<pass|bounce|escalate>", "blocking": <plan member blocking>, "weight": <plan member weight> }]`.

   **Short-circuit:** if any member returns `escalate`, stop immediately. Otherwise, after each round, if `plan.on_round_bounce === "stop"` and any **blocking** member in that round returned `bounce`, stop before the next round. Always finish the members already running in the current round (batched).

7.3 **Aggregate.** Map `plan.aggregation` to the CLI rule argument: a string passes through; `{ "quorum": k }` → `quorum:k`. Run `cloverleaf-cli aggregate-verdicts '<members-json>' <rule>` and capture the council verdict JSON.

7.4 **Apply.** Run `cloverleaf-cli apply-council-verdict <repo_root> <TASK-ID> task.review '<council-verdict-json>'`. Commit: `git add .cloverleaf/ && git commit -m "cloverleaf: <TASK-ID> council review (<verdict>)"`.

7.5 **Branch on the task's new status (reload with `load-task`):**
   - `automated-gates` (fast lane pass) or `final-gate` (full pipeline pass) → proceed to the merge: inline `/cloverleaf-merge <TASK-ID>`.
   - `implementing` (bounce) → `council_bounces += 1`. If `council_bounces >= 3`, escalate (section 6). Else return to 7.1.
   - `escalated` → stop and surface to the user (review `.cloverleaf/feedback/` and `.cloverleaf/runs/<TASK-ID>/council/task.review.json`).

The council result artifact at `.cloverleaf/runs/<TASK-ID>/council/task.review.json` records per-member verdicts, the aggregate, and the security basis (incl. an omitted or out-voted `security` member). On any member-dispatch failure or unparseable envelope, stop and report — never treat a failed member as a pass.

## Rules

- Each agent has its own 3-bounce budget. Bounces from different agents do NOT share counters.
- On any sub-skill error or escalation, orchestrator stops with clear message.
- Human merge gate is NOT skipped; confirmation is still required at merge time.
