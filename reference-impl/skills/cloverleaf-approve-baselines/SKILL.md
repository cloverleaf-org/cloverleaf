---
name: cloverleaf-approve-baselines
description: Human baseline-approval gate for the Cloverleaf UI Review pipeline. When the UI Reviewer captures new or resized visual baselines it sets baselines_pending=true in .cloverleaf/runs/{taskId}/ui-review/state.json and blocks the ui-review → qa transition. Run this skill after inspecting the new baseline images to approve them and allow the task to advance to qa. Usage — /cloverleaf-approve-baselines <TASK-ID>.
---

# Cloverleaf — approve-baselines

## Trigger condition

This skill is invoked **only** when the `cloverleaf-ui-review` skill reports that `baselines_pending` is `true` — i.e., the UI Reviewer captured at least one `new-baseline` or `dimension-mismatch` result during its run, meaning one or more baseline PNGs under `.cloverleaf/baselines/{browser}/` were created or replaced.

Do not run this skill if the task is not in `ui-review` status or if `state.json` already has `baselines_pending: false`.

## Effect

1. Writes `baselines_pending: false` to `.cloverleaf/runs/{taskId}/ui-review/state.json`.
2. Advances the task from `ui-review` → `qa` via the normal agent transition.
3. Commits the updated state and status to the feature branch.

---

## Steps

0. Pre-flight:

   ```bash
   cd <repo_root>
   current=$(git rev-parse --abbrev-ref HEAD)
   if [ "$current" != "main" ]; then git checkout main; fi
   ```

   If main has uncommitted changes, stop and report.

1. Capture the TASK-ID argument.

2. Load the task and verify status:
   ```bash
   cloverleaf-cli load-task <repo_root> <TASK-ID>
   ```
   Verify `status === "ui-review"`. If not, report and stop.

3. Read the current ui-review state:
   ```bash
   cloverleaf-cli read-ui-review-state <repo_root> <TASK-ID>
   ```
   If `baselines_pending` is already `false` (or the file is absent), report that no approval is needed and stop.

4. Present the new baseline images to the human for review. The baselines live at:
   ```
   <repo_root>/.cloverleaf/baselines/{browser}/{slug}-{viewport}.png
   ```
   List the files that were modified since the last commit on the feature branch:
   ```bash
   git diff --name-only main..cloverleaf/<TASK-ID> -- .cloverleaf/baselines/
   ```
   Display the list. Ask the human to confirm they have reviewed the images and approve the baselines before proceeding.

5. Once approved, write `baselines_pending: false`:
   ```bash
   cloverleaf-cli write-ui-review-state <repo_root> <TASK-ID> false
   ```

6. Advance the task to qa:
   ```bash
   cloverleaf-cli advance-status <repo_root> <TASK-ID> qa agent '' full_pipeline
   ```

7. Commit the changes to the feature branch:
   ```bash
   cd <repo_root>
   git add .cloverleaf/
   git commit -m "cloverleaf: <TASK-ID> baselines approved → qa"
   ```

8. Report:
   > "✓ Baselines approved. `baselines_pending` cleared. State → qa. Next: `/cloverleaf-qa <TASK-ID>`."

---

## Rules

- Never push.
- Do not modify source code or test files.
- Do not skip step 4 — the human must acknowledge the baseline images before approval is recorded.
- On illegal state transition, report and stop without partial commits.
