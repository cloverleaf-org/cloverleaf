---
name: cloverleaf-implement
description: Run the Implementer agent on a task. Dispatches a subagent to produce code + tests on a new branch, then advances state pending → tactical-plan → implementing → documenting → review. Usage — /cloverleaf-implement <TASK-ID>.
---

# Cloverleaf — implement

The user has invoked this skill with a TASK-ID (e.g., `DEMO-001`).

## Steps

1. Capture the argument. If no TASK-ID was provided, report usage and stop.

2. Load the task:
   ```
   ~/.claude/plugins/cloverleaf/bin/cloverleaf-cli load-task <repo_root> <TASK-ID>
   ```
   Parse the JSON. Verify `status === "pending"` OR `status === "implementing"` (the second case is a re-run after a Reviewer bounce). If neither, report the current status and ask the user to use the correct command for that state.

3. Load any outstanding feedback:
   ```
   ~/.claude/plugins/cloverleaf/bin/cloverleaf-cli latest-feedback <repo_root> <TASK-ID>
   ```
   Capture the output. If present and the latest verdict is `bounce`, pass it into the subagent.

4. Dispatch the Implementer subagent via the Task tool:
   - `subagent_type`: `general-purpose`
   - `model`: `sonnet`
   - Prompt: the contents of `~/.claude/plugins/cloverleaf/prompts/implementer.md`, with placeholders substituted:
     - `{{task}}` → the full task JSON (pretty-printed)
     - `{{feedback}}` → the feedback JSON if present, else the literal string `null`
     - `{{repo_root}}` → absolute path to the current repo
     - `{{base_branch}}` → `main` (or the current default branch)

5. Parse the subagent's response. Expect JSON of the form `{"status": "done", "branch": "...", "files_changed": [...], "summary": "..."}` or `{"status": "blocked", "reason": "..."}`.

6. On `blocked`: report the reason and stop. Do NOT advance status.

7. On `done`: walk the state machine. First, switch back to main:

   ```bash
   cd <repo_root>
   git checkout main
   ```

   If this fails (uncommitted changes on main, detached HEAD, etc.), report the error and stop without advancing state.

8. Run each of these CLI calls in sequence:

   If the current task status is `pending`:
   ```
   cloverleaf-cli advance-status <repo_root> <TASK-ID> tactical-plan agent
   cloverleaf-cli advance-status <repo_root> <TASK-ID> implementing agent
   cloverleaf-cli advance-status <repo_root> <TASK-ID> documenting agent
   cloverleaf-cli advance-status <repo_root> <TASK-ID> review agent
   ```

   If the current task status was `implementing` (loop-back after bounce):
   ```
   cloverleaf-cli advance-status <repo_root> <TASK-ID> documenting agent
   cloverleaf-cli advance-status <repo_root> <TASK-ID> review agent
   ```

9. Commit the state changes:
   ```
   cd <repo_root>
   git add .cloverleaf/
   git commit -m "cloverleaf: <TASK-ID> → review"
   ```

10. Report:
    - "✓ Implementer done. Branch `<branch>`. State → review."
    - "Files changed: <comma-separated>."
    - "Currently on: `main`."
    - "Next: `/cloverleaf-review <TASK-ID>`."

## Rules

- Never push the branch or modify remote state.
- If any `advance-status` call fails (illegal transition), stop and report.
- The skill's working directory is the consumer's repo root.
