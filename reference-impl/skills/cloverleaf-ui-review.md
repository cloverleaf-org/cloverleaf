---
name: cloverleaf-ui-review
description: Run the UI Reviewer agent on a task in the `ui-review` state (full pipeline only). Dispatches a subagent to run Playwright + axe-core against a local preview of the feature branch; emits feedback envelope; advances ui-review → qa on pass or loops back to implementing on bounce. Usage — /cloverleaf-ui-review <TASK-ID>.
---

# Cloverleaf — ui-review

## Steps

0. Ensure you are on `main`. State is authoritative on main. Run:

   ```bash
   cd <repo_root>
   current=$(git rev-parse --abbrev-ref HEAD)
   if [ "$current" != "main" ]; then git checkout main; fi
   ```

   If main has uncommitted changes, stop and report.

1. Capture the TASK-ID argument.

2. Load the task:
   ```
   ~/.claude/plugins/cloverleaf/bin/cloverleaf-cli load-task <repo_root> <TASK-ID>
   ```
   Verify `status === "ui-review"`. If not, report and stop.

3. Confirm feature branch exists: `git rev-parse --verify cloverleaf/<TASK-ID>`. If missing, report and stop.

4. Allocate a free `preview_port` via Node:
   ```bash
   PREVIEW_PORT=$(node -e "const net=require('net');const s=net.createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})")
   ```

5. Compute diff for the subagent context:
   ```bash
   git diff main..cloverleaf/<TASK-ID>
   ```

6. Dispatch the UI Reviewer subagent via the Task tool:
   - `subagent_type`: `general-purpose`
   - `model`: `sonnet`
   - Prompt: contents of `~/.claude/plugins/cloverleaf/prompts/ui-reviewer.md` with substitutions for `{{task}}`, `{{diff}}`, `{{branch}}`, `{{base_branch}}`, `{{repo_root}}`, `{{preview_port}}`.

7. Parse the subagent's response. Expect `{"verdict": "pass"|"bounce"|"escalate", "summary": "...", "findings": [...]}`.

8. Branch on verdict:

   **Pass:**
   ```
   cloverleaf-cli advance-status <repo_root> <TASK-ID> qa agent --path=full_pipeline
   ```
   Commit: `git add .cloverleaf/ && git commit -m "cloverleaf: <TASK-ID> ui-review passed → qa"`.
   Report: "✓ UI Review passed. State → qa. Next: `/cloverleaf-qa <TASK-ID>`."

   **Bounce:**
   1. Write feedback envelope to temp file: `echo '<envelope-json>' > /tmp/cloverleaf-fb-u.json`
   2. `cloverleaf-cli write-feedback <repo_root> <TASK-ID> /tmp/cloverleaf-fb-u.json --prefix=u` — captures path like `.cloverleaf/feedback/<TASK-ID>-u<N>.json`.
   3. `cloverleaf-cli advance-status <repo_root> <TASK-ID> implementing agent --path=full_pipeline`
   4. Commit: `git add .cloverleaf/ && git commit -m "cloverleaf: <TASK-ID> ui-review bounced → implementing"`.
   5. Report: "✗ UI Review bounced. Findings: <summarize by severity>. State → implementing. Next: `/cloverleaf-implement <TASK-ID>`."

   **Escalate:**
   1. `cloverleaf-cli advance-status <repo_root> <TASK-ID> escalated agent`
   2. Commit: `git add .cloverleaf/ && git commit -m "cloverleaf: <TASK-ID> ui-review escalated"`.
   3. Report: "✗ UI Review escalated (infrastructure issue). Review and retry manually."

## Rules

- Never push.
- Do not modify source code — UI Reviewer is read-only.
- Always teardown preview server + worktree on error.
- On illegal state transition, report and stop without partial commits.
