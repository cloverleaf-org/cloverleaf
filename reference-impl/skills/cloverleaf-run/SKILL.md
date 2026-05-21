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

Parse the JSON. If `effective == "low"` → skip the gate, proceed with the lane.

If `effective == "high"`:
- If `declared == "low"` (under-classification: `diff_detected` true), write back: load the task, set `security_class: "high"`, save it, then commit `cloverleaf: <TASK-ID> security_class → high (diff-detected)`.
- `cloverleaf-cli advance-status <repo_root> <TASK-ID> security-review agent`; commit.
- Inline `/cloverleaf-security-review <TASK-ID>` steps. Reload the task:
  - `status == "automated-gates"` → security review passed; proceed with the lane.
  - `status == "implementing"` → bounced. `security_bounces += 1`. If `security_bounces >= MAX_SECURITY_BOUNCES`, escalate (section 6). Else re-enter the implement→review loop (fast lane section 4 / full pipeline section 5.1), which re-runs the security gate on its next pass.
  - `status == "escalated"` → the security reviewer found a blocker; stop and surface to the user (a human must review `.cloverleaf/feedback/`). This is the security reviewer's own escalation, distinct from a bounce-budget exhaustion.

## Steps

1. Capture TASK-ID.

2. Load task: `cloverleaf-cli load-task <repo_root> <TASK-ID>`. Verify `status === "pending"`. If not, report and stop.

3. Read `task.risk_class`:
   - `"low"` → go to section 4 (Fast Lane)
   - `"high"` → go to section 5 (Full Pipeline)

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
- Report: "✗ Escalated `<TASK-ID>`. Review `.cloverleaf/feedback/` and either refine the task or take over manually. Counters: reviewer=<N>, ui_reviewer=<N>, qa=<N>."

## Rules

- Each agent has its own 3-bounce budget. Bounces from different agents do NOT share counters.
- On any sub-skill error or escalation, orchestrator stops with clear message.
- Human merge gate is NOT skipped; confirmation is still required at merge time.
