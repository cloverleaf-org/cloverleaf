---
name: cloverleaf-ui-review
description: Run the UI Reviewer agent on a task in the `ui-review` state (full pipeline only). Computes diff-affected routes via CLI; if empty, skips axe and advances ui-review → qa. Otherwise dispatches a subagent with Playwright + axe-core scoped to those routes. Usage — /cloverleaf-ui-review <TASK-ID>.
---

# Cloverleaf — ui-review

## Steps

0. Pre-flight: ensure you are on `main` and clean stale feedback temp files from previous runs (prevents /tmp leakage between tasks):

   ```bash
   cd <repo_root>
   current=$(git rev-parse --abbrev-ref HEAD)
   if [ "$current" != "main" ]; then git checkout main; fi
   ```

   If main has uncommitted changes, stop and report.

   ```bash
   rm -f /tmp/cloverleaf-fb-r.json /tmp/cloverleaf-fb-u.json /tmp/cloverleaf-fb-q.json
   ```

1. Capture the TASK-ID argument.

2. Load the task:
   ```
   cloverleaf-cli load-task <repo_root> <TASK-ID>
   ```
   Verify `status === "ui-review"`. If not, report and stop.

3. Confirm feature branch exists: `git rev-parse --verify cloverleaf/<TASK-ID>`. If missing, report and stop.

4. Ensure required directories exist:
   ```bash
   mkdir -p <repo_root>/.cloverleaf/baselines
   mkdir -p <repo_root>/.cloverleaf/runs/<TASK-ID>/ui-review
   ```

5. Compute affected routes:
   ```bash
   AFFECTED=$(cloverleaf-cli affected-routes <repo_root> <TASK-ID>)
   ```

6. **Empty-set early-exit.** If `AFFECTED` is `[]`, skip the subagent entirely:
   ```bash
   cloverleaf-cli advance-status <repo_root> <TASK-ID> qa agent '' full_pipeline
   cd <repo_root>
   git add .cloverleaf/
   git commit -m "cloverleaf: <TASK-ID> ui-review skipped (no renderable routes) → qa"
   ```
   Report: "✓ UI Review skipped (no renderable routes affected). State → qa. Next: `/cloverleaf-qa <TASK-ID>`."
   Stop here.

7. Allocate a free preview port:
   ```bash
   PREVIEW_PORT=$(node -e "const net=require('net');const s=net.createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})")
   ```

8. Compute diff:
   ```bash
   git diff main..cloverleaf/<TASK-ID>
   ```

9. **Browser cache env var.** Before the Task-tool dispatch, ensure `PLAYWRIGHT_BROWSERS_PATH=~/.cache/ms-playwright` is exported so the subagent inherits it. This keeps Playwright from re-downloading ~300 MB of browser binaries inside the worktree.

10. Dispatch the UI Reviewer subagent via the Task tool:
    - `subagent_type`: `general-purpose`
    - `model`: `sonnet`
    - Prompt: contents of `$(cloverleaf-cli plugin-root)/prompts/ui-reviewer.md` with substitutions:
      - `{{task}}`, `{{diff}}`, `{{branch}}`, `{{base_branch}}`, `{{repo_root}}`, `{{preview_port}}`
      - `{{affected_routes}}` → the value of `$AFFECTED` (verbatim — may be `"all"`, a JSON array, or `[]` but step 6 handled `[]` already)
      - `{{ui_review_config}}` → JSON-stringified result of `cloverleaf-cli ui-review-config <repo_root>` (used by the subagent to scope viewport sizes, thresholds, and axe rule overrides)

11. Parse the subagent's response. Expect `{"verdict": "pass"|"bounce"|"escalate", "summary": "...", "findings": [...]}`.

12. **Read the baseline-approval sidecar** (after the subagent completes, regardless of verdict):
    ```bash
    UI_STATE=$(cloverleaf-cli read-ui-review-state <repo_root> <TASK-ID>)
    BASELINES_PENDING=$(echo "$UI_STATE" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).baselines_pending ? 'true' : 'false')")
    ```
    Or more concisely:
    ```bash
    BASELINES_PENDING=$(cloverleaf-cli read-ui-review-state <repo_root> <TASK-ID> | node -e "const s=require('fs').readFileSync('/dev/stdin','utf-8'); process.stdout.write(JSON.parse(s).baselines_pending?'true':'false')")
    ```

13. Branch on verdict:

    **Pass:**

    Check `BASELINES_PENDING`:

    - If `BASELINES_PENDING` is `true`:
      - Do NOT advance to `qa`.
      - Commit artifacts: `git add .cloverleaf/ && git commit -m "cloverleaf: <TASK-ID> ui-review passed (baselines pending approval)"`.
      - Report:
        > "✓ UI Review passed (no a11y errors), but **baselines_pending** is true: one or more new or resized visual baselines were captured and require human approval before advancing to qa.
        > Run `/cloverleaf-approve-baselines <TASK-ID>` to review the new baseline images and approve them, which will clear the flag and advance the task to qa."
      - Stop here (task remains in `ui-review` status).

    - If `BASELINES_PENDING` is `false` (or state.json is absent):
      ```
      cloverleaf-cli advance-status <repo_root> <TASK-ID> qa agent '' full_pipeline
      ```
      Commit: `git add .cloverleaf/ && git commit -m "cloverleaf: <TASK-ID> ui-review passed → qa"`.
      Report: "✓ UI Review passed. State → qa. Next: `/cloverleaf-qa <TASK-ID>`."

    **Bounce:**
    1. Write feedback: `echo '<envelope-json>' > /tmp/cloverleaf-fb-u.json`
    2. `cloverleaf-cli write-feedback <repo_root> <TASK-ID> /tmp/cloverleaf-fb-u.json --prefix=u`
    3. Commit the persisted feedback file (was missing pre-v0.4.1 — bug #3):
       ```bash
       cd <repo_root>
       git add .cloverleaf/feedback/
       git commit -m "cloverleaf: <TASK-ID> ui-review feedback"
       ```
    4. `cloverleaf-cli advance-status <repo_root> <TASK-ID> implementing agent '' full_pipeline`
    5. Commit: `git add .cloverleaf/ && git commit -m "cloverleaf: <TASK-ID> ui-review bounced → implementing"`.
    6. Report: "✗ UI Review bounced. Findings: <summary by severity>. State → implementing. Next: `/cloverleaf-implement <TASK-ID>`."

    **Escalate:**
    1. `cloverleaf-cli advance-status <repo_root> <TASK-ID> escalated agent`
    2. Commit: `git add .cloverleaf/ && git commit -m "cloverleaf: <TASK-ID> ui-review escalated"`.
    3. Report: "✗ UI Review escalated (infrastructure issue). Review and retry manually."

## Rules

- Never push.
- Do not modify source code — UI Reviewer is read-only.
- Always teardown preview server + worktree on error.
- Empty-set early-exit (step 6) skips the browser entirely — no Playwright invocation, no worktree.
- On illegal state transition, report and stop without partial commits.
