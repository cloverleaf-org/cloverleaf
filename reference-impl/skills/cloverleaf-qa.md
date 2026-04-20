---
name: cloverleaf-qa
description: Run the QA agent on a task in the `qa` state (full pipeline only). Dispatches a subagent to run per-package test suites against an isolated worktree; emits feedback envelope with results; advances qa → final-gate on pass or loops back to implementing on bounce. Usage — /cloverleaf-qa <TASK-ID>.
---

# Cloverleaf — qa

## Steps

0. Ensure you are on `main`. If not, `git checkout main`. If main has uncommitted changes, stop and report.

1. Capture the TASK-ID argument.

2. Load the task:
   ```
   cloverleaf-cli load-task <repo_root> <TASK-ID>
   ```
   Verify `status === "qa"`. If not, report and stop.

3. Confirm feature branch exists: `git rev-parse --verify cloverleaf/<TASK-ID>`.

4. Load QA rules JSON:
   ```bash
   cat ~/.claude/plugins/cloverleaf/config/qa-rules.json
   ```
   Capture for the subagent as `qa_rules`.

5. Compute diff:
   ```bash
   git diff main..cloverleaf/<TASK-ID>
   ```

6. Dispatch the QA subagent via the Task tool:
   - `subagent_type`: `general-purpose`
   - `model`: `sonnet`
   - Prompt: contents of `~/.claude/plugins/cloverleaf/prompts/qa.md` with substitutions for `{{task}}`, `{{diff}}`, `{{branch}}`, `{{base_branch}}`, `{{repo_root}}`, `{{qa_rules}}` (the JSON loaded in step 4).

7. Parse response: expect `{"verdict": "pass"|"bounce"|"escalate", "summary", "findings", "results"}`.

8. Branch on verdict:

   **Pass:**
   ```
   cloverleaf-cli advance-status <repo_root> <TASK-ID> final-gate agent --path=full_pipeline
   ```
   Commit: `git add .cloverleaf/ && git commit -m "cloverleaf: <TASK-ID> qa passed → final-gate"`.
   Report: "✓ QA passed (`<passed>/<total>` tests). State → final-gate. Next: `/cloverleaf-merge <TASK-ID>`."

   **Bounce:**
   1. Write feedback envelope: `echo '<json>' > /tmp/cloverleaf-fb-q.json`
   2. `cloverleaf-cli write-feedback <repo_root> <TASK-ID> /tmp/cloverleaf-fb-q.json --prefix=q`
   3. `cloverleaf-cli advance-status <repo_root> <TASK-ID> implementing agent --path=full_pipeline`
   4. Commit: `git add .cloverleaf/ && git commit -m "cloverleaf: <TASK-ID> qa bounced → implementing"`.
   5. Report: "✗ QA bounced. `<failed>/<total>` tests failed. State → implementing. Next: `/cloverleaf-implement <TASK-ID>`."

   **Escalate:**
   1. `cloverleaf-cli advance-status <repo_root> <TASK-ID> escalated agent`
   2. Commit: `git add .cloverleaf/ && git commit -m "cloverleaf: <TASK-ID> qa escalated"`.
   3. Report: "✗ QA escalated. Review infrastructure and retry manually."

## Rules

- Never push. Read-only. Do not modify source.
- On illegal state transition, report and stop.
