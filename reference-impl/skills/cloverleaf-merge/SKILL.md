---
name: cloverleaf-merge
description: Human gate for merging a Cloverleaf task. Branches on state — from `automated-gates` (fast lane) via `human_merge`, or from `final-gate` (full pipeline) via `final_approval_gate`. For full-pipeline tasks, performs a real `git merge --no-ff` of the feature branch into main before advancing state. Requires explicit user confirmation. Usage — /cloverleaf-merge <TASK-ID>.
---

# Cloverleaf — merge

## Steps

0. Ensure you are on `main`. Run:
   ```bash
   cd <repo_root>
   current=$(git rev-parse --abbrev-ref HEAD)
   if [ "$current" != "main" ]; then git checkout main; fi
   ```
   If main has uncommitted changes, stop and report.

1. Capture the TASK-ID.

2. Load the task: `cloverleaf-cli load-task <repo_root> <TASK-ID>`. Let `S` = `task.status`.

   - If `S === "automated-gates"`: this is a fast-lane merge. Proceed with section 3A.
   - If `S === "final-gate"`: this is a full-pipeline merge. Proceed with section 3B.
   - Else: report the current status and stop.

### 3A. Fast-lane confirmation

3A.1. Show to user:
> "About to merge `<TASK-ID>` (fast lane). Branch `cloverleaf/<TASK-ID>` has been reviewed and passed. Confirm merge? (y/N)"

3A.2. On explicit `y`:
   - `cloverleaf-cli emit-gate-decision <repo_root> <TASK-ID> human_merge approve human`
   - `cloverleaf-cli advance-status <repo_root> <TASK-ID> merged human human_merge fast_lane`
   - Commit: `git add .cloverleaf/ && git commit -m "cloverleaf: <TASK-ID> merged (fast lane)"`.

### 3B. Full-pipeline final approval

3B.1. Collect summaries. Read the latest feedback files:
   ```bash
   ls <repo_root>/.cloverleaf/feedback/<TASK-ID>-*.json | sort
   ```
   Extract `summary` and `verdict` from each. Group by prefix:
   - `r*.json` → Reviewer
   - `u*.json` → UI Reviewer
   - `q*.json` → QA

3B.2. Show to user:
> "About to merge `<TASK-ID>` (full pipeline). Final approval required. Summaries:
> - Reviewer: <summary>
> - UI Reviewer: <summary or 'not run'>
> - QA: <summary with results>
> Confirm merge? (y/N)"

3B.3. On explicit `y`:
   - `cloverleaf-cli emit-gate-decision <repo_root> <TASK-ID> final_approval_gate approve human`
   - Verify we are on main with a clean working tree:
     ```bash
     cd <repo_root>
     git checkout main
     git status
     # must be clean
     ```
     If not clean, stop and report.
   - Perform the real merge — brings the feature branch's Implementer commit, ui-review baseline commit, and any feedback commits into main:
     ```bash
     git merge --no-ff cloverleaf/${TASK_ID} -m "cloverleaf: ${TASK_ID} merged (full pipeline)"
     ```
     If git reports conflicts: abort and escalate.
     ```bash
     git merge --abort
     cloverleaf-cli advance-status <repo_root> ${TASK_ID} escalated agent
     ```
     Exit with a human-readable error explaining the conflict.
   - Advance task status on main (commits `.cloverleaf/tasks/${TASK_ID}.json` + event). The `final-gate → merged` transition is `allowed_actors: [human]` per the task state machine; the skill passes the gate + path as positional args:
     ```bash
     cloverleaf-cli advance-status <repo_root> ${TASK_ID} merged human final_approval_gate full_pipeline
     ```

### 4. Common: report

Report:
- "✓ Merged `<TASK-ID>`. Branch `cloverleaf/<TASK-ID>` has been merged into main."
- "Suggested: `git push origin main` to push the merge commit."

## Rules

- Only proceed on explicit `y/Y/yes/YES`. Anything else is treated as either a decline (`n/N/no/NO`) or a clarifying question (see below).
- The skill does NOT push the branch or open a PR.
- Fast lane and full pipeline use distinct gates — the state machine records which path was taken.
- Full-pipeline merges perform a real `git merge --no-ff` before advancing state — the feature branch's code, baselines, and feedback commits all land on main.
- If the user declines, no state change and no commit.

## Clarifying questions at final-gate

If the user's response to the "Confirm merge? (y/N)" prompt is **not** one of `y/Y/yes/YES` or `n/N/no/NO`, treat it as a clarifying question. Answer it from the pipeline context available to you — the Reviewer/UI Reviewer/QA summaries, the diff, the task's ACs, the feedback files — and then **re-prompt** with the same y/N question.

Loop this until the user gives a definitive y or n. Do not perform the merge until you see `y/Y/yes/YES`. Do not mark the task declined until you see `n/N/no/NO`.

This keeps manual merges and walker-driven merges (`/cloverleaf-run-plan`) consistent: the user gets to interrogate the summary before committing.
