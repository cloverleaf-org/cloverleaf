---
name: cloverleaf-merge
description: Human gate for merging a Cloverleaf task. Branches on state — from `automated-gates` (fast lane) via `human_merge`, or from `final-gate` (full pipeline) via `final_approval_gate`. Requires explicit user confirmation. Usage — /cloverleaf-merge <TASK-ID>.
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
   - `cloverleaf-cli advance-status <repo_root> <TASK-ID> merged human final_approval_gate full_pipeline`
   - Commit: `git add .cloverleaf/ && git commit -m "cloverleaf: <TASK-ID> merged (full pipeline)"`.

### 4. Common: report

Report:
- "✓ Merged `<TASK-ID>`. Branch `cloverleaf/<TASK-ID>` is ready for you to push and open a PR."
- "Suggested: `git push origin cloverleaf/<TASK-ID>` then open a PR against `main`."

## Rules

- Only proceed on explicit `y`, `Y`, `yes`, `YES`. Anything else: abort without state change.
- The skill does NOT push the branch or open a PR.
- Fast lane and full pipeline use distinct gates — the state machine records which path was taken.
- If the user declines, no state change and no commit.
