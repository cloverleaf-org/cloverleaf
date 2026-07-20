---
name: cloverleaf-approve-baselines
description: Human baseline-approval gate for the Cloverleaf delivery council. When the UI member captures new or resized visual baselines it sets baselines_pending=true in .cloverleaf/runs/{taskId}/ui-review/state.json, and the council runner holds the council pass until the baselines are approved. This skill is clear-only — it presents the new baseline images, records human approval, and clears baselines_pending (it drives no FSM transition). Re-run /cloverleaf-run <TASK-ID> afterwards so the delivery council can pass. Usage — /cloverleaf-approve-baselines <TASK-ID>.
---

# Cloverleaf — approve-baselines

## Trigger condition

This skill is invoked **only** when the delivery council's `ui` member reports that `baselines_pending` is `true` — i.e., the UI Reviewer captured at least one `new-baseline` or `dimension-mismatch` result during its run, meaning one or more baseline PNGs under `.cloverleaf/baselines/{browser}/` were created or replaced. The council runner (`/cloverleaf-run` §4.1) holds the council `pass` (which would advance `council → final-gate`) until `baselines_pending` is cleared.

Do not run this skill if `state.json` already has `baselines_pending: false` (there is nothing to approve).

## Effect

1. Presents the new baseline images and records human approval.
2. Writes `baselines_pending: false` to `.cloverleaf/runs/{taskId}/ui-review/state.json`.
3. Commits the updated state to the feature branch.

This skill is **clear-only**: it drives **no** FSM transition. Once `baselines_pending` is `false`, re-running `/cloverleaf-run <TASK-ID>` re-dispatches the delivery council; the `ui` member now passes and the council `pass` applies (`council → final-gate`).

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

2. Load the task (context only) and read the ui-review state to confirm there is something to approve:
   ```bash
   cloverleaf-cli load-task <repo_root> <TASK-ID>
   cloverleaf-cli read-ui-review-state <repo_root> <TASK-ID>
   ```
   Verify `baselines_pending === true`. If it is already `false` (or the state file is absent), report that no approval is needed and stop. (This skill gates on the `baselines_pending` flag, **not** on task `status` — under the collapsed council FSM the task sits at `council` while the UI member's baselines await approval.)

3. Present the new baseline images to the human for review. The baselines live at:
   ```
   <repo_root>/.cloverleaf/baselines/{browser}/{slug}-{viewport}.png
   ```
   List the files that were modified since the last commit on the feature branch:
   ```bash
   git diff --name-only main..cloverleaf/<TASK-ID> -- .cloverleaf/baselines/
   ```
   Display the list. Ask the human to confirm they have reviewed the images and approve the baselines before proceeding.

4. Once approved, clear the flag — write `baselines_pending: false`:
   ```bash
   cloverleaf-cli write-ui-review-state <repo_root> <TASK-ID> false
   ```

5. Commit the changes to the feature branch:
   ```bash
   cd <repo_root>
   git add .cloverleaf/
   git commit -m "cloverleaf: <TASK-ID> baselines approved (baselines_pending cleared)"
   ```

6. Report:
   > "✓ Baselines approved (baselines_pending cleared). Re-run `/cloverleaf-run <TASK-ID>` so the delivery council can now pass."

---

## Rules

- Never push.
- Do not modify source code or test files.
- This skill is **clear-only** — it drives **no** FSM transition (no `advance-status`). It only clears the `baselines_pending` flag; the council runner re-runs the council once the flag is `false`.
- Do not skip step 3 — the human must acknowledge the baseline images before approval is recorded.
