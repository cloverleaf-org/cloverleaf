---
name: cloverleaf-review
description: Run the Reviewer agent on a task in the `review` state. Emits a feedback envelope; advances to `automated-gates` on pass or loops back to `implementing` on bounce. Usage — /cloverleaf-review <TASK-ID>.
---

# Cloverleaf — review

## Steps

0. Pre-flight: ensure you are on `main` and clean stale feedback temp files from previous runs (prevents /tmp leakage between tasks):

   ```bash
   cd <repo_root>
   current=$(git rev-parse --abbrev-ref HEAD)
   if [ "$current" != "main" ]; then git checkout main; fi
   ```

   If main has uncommitted changes, stop and report — the user must clean up first.

   ```bash
   rm -f /tmp/cloverleaf-fb-r.json /tmp/cloverleaf-fb-u.json /tmp/cloverleaf-fb-q.json
   ```

1. Capture the TASK-ID argument.

2. Load the task:
   ```
   cloverleaf-cli load-task <repo_root> <TASK-ID>
   ```
   Verify `status === "review"`. If not, report the current status and stop.

3. The Implementer's branch is `cloverleaf/<TASK-ID>`. Confirm it exists: `git rev-parse --verify cloverleaf/<TASK-ID>`. If missing, report the discrepancy and stop. Do NOT check out this branch; stay on main.

4. Compute the diff without checking out:
   ```bash
   git diff main..cloverleaf/<TASK-ID>
   ```
   Capture this output for the subagent.

5. Dispatch the Reviewer subagent via the Task tool:
   - `subagent_type`: `general-purpose`
   - `model`: `sonnet`
   - Prompt: contents of `$(cloverleaf-cli plugin-root)/prompts/reviewer.md` with substitutions for `{{task}}`, `{{branch}}`, `{{base_branch}}`, `{{repo_root}}`, `{{diff}}`.

6. Parse the subagent's response. Expect a feedback envelope JSON of the form `{"verdict": "pass"|"bounce", "summary": "...", "findings": [...]}`. Validate shape: verdict must be `pass` or `bounce`; if `bounce`, findings must have at least one entry with `severity` (one of `blocker|error|warning|info`) and `message`.

7. Branch on verdict:

   **Pass:**
   ```
   cloverleaf-cli advance-status <repo_root> <TASK-ID> automated-gates agent
   ```
   Commit: `git add .cloverleaf/ && git commit -m "cloverleaf: <TASK-ID> review passed → automated-gates"`.
   Report: "✓ Review passed. State → automated-gates. Next: `/cloverleaf-merge <TASK-ID>`."

   **Bounce:**
   1. Write the feedback envelope to a temp file: `echo '<envelope-json>' > /tmp/cloverleaf-fb-r.json`.
   2. `cloverleaf-cli write-feedback <repo_root> <TASK-ID> /tmp/cloverleaf-fb-r.json` — captures the path like `.cloverleaf/feedback/<TASK-ID>-r<N>.json`.
   3. Commit the persisted feedback file (was missing pre-v0.4.1 — bug #3):
      ```bash
      cd <repo_root>
      git add .cloverleaf/feedback/
      git commit -m "cloverleaf: <TASK-ID> review feedback"
      ```
   4. `cloverleaf-cli advance-status <repo_root> <TASK-ID> implementing agent` — loops back.
   5. Commit: `git add .cloverleaf/ && git commit -m "cloverleaf: <TASK-ID> review bounced → implementing"`.
   6. Report: "✗ Review bounced. Findings: <summarize findings by severity>. State → implementing. Next: `/cloverleaf-implement <TASK-ID>`."

## Rules

- Never push.
- Do not modify source code — the reviewer is read-only.
- On illegal state transition, report and stop without partial commits.
