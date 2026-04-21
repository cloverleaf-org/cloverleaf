---
name: cloverleaf-document
description: Run the Documenter agent on a task in the `implementing` state (full pipeline only). Dispatches a subagent to add doc-only commits to the feature branch, then advances implementing → documenting → review. Usage — /cloverleaf-document <TASK-ID>.
---

# Cloverleaf — document

## Steps

0. Ensure you are on `main`. State is authoritative on main. Run:

   ```bash
   cd <repo_root>
   current=$(git rev-parse --abbrev-ref HEAD)
   if [ "$current" != "main" ]; then git checkout main; fi
   ```

   If main has uncommitted changes, stop and report — the user must clean up first.

1. Capture the TASK-ID argument.

2. Load the task:
   ```
   ~/.claude/plugins/cloverleaf/bin/cloverleaf-cli load-task <repo_root> <TASK-ID>
   ```
   Verify `status === "implementing"`. Verify `risk_class === "high"`. If either check fails, report and stop.

3. Confirm feature branch exists: `git rev-parse --verify cloverleaf/<TASK-ID>`. If missing, report the discrepancy and stop.

4. Compute the diff (without checking out):
   ```bash
   git diff main..cloverleaf/<TASK-ID>
   ```
   Capture the output for the subagent.

5. Dispatch the Documenter subagent via the Task tool:
   - `subagent_type`: `general-purpose`
   - `model`: `sonnet`
   - Prompt: contents of `~/.claude/plugins/cloverleaf/prompts/documenter.md` with substitutions:
     - `{{task}}` → full task JSON (pretty-printed)
     - `{{diff}}` → diff output
     - `{{branch}}` → `cloverleaf/<TASK-ID>`
     - `{{base_branch}}` → `main`
     - `{{repo_root}}` → absolute path

6. Parse the subagent's response. Expect JSON of the form `{"commits_added": N, "files_changed": [...], "summary": "..."}`.

7. On failure to parse or response with invalid shape: report the response and stop without advancing state.

8. Advance state:
   ```
   cloverleaf-cli advance-status <repo_root> <TASK-ID> documenting agent
   cloverleaf-cli advance-status <repo_root> <TASK-ID> review agent
   ```

9. Commit state changes:
   ```bash
   cd <repo_root>
   git add .cloverleaf/
   git commit -m "cloverleaf: <TASK-ID> documented → review"
   ```

10. Report:
    - "✓ Documenter done. `<commits_added>` doc commit(s) added. State → review."
    - "Files changed: `<comma-separated files_changed>`."
    - "Next: `/cloverleaf-review <TASK-ID>`."

## Rules

- Never push.
- Do not modify source code — Documenter is doc-only.
- If any `advance-status` call fails, stop and report.
- The skill's working directory is the consumer's repo root.
