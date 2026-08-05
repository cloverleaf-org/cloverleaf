---
name: cloverleaf-implement
description: Run the Implementer agent on a task. Dispatches a subagent to produce code + tests on a new branch, then advances state pending → tactical-plan → implementing (stops at implementing for every risk_class). Usage — /cloverleaf-implement <TASK-ID>.
---

# Cloverleaf — implement

The user has invoked this skill with a TASK-ID (e.g., `DEMO-001`).

## Steps

1. Capture the argument. If no TASK-ID was provided, report usage and stop.

2. Load the task:
   ```
   cloverleaf-cli load-task <repo_root> <TASK-ID>
   ```
   Parse the JSON. Verify `status === "pending"` OR `status === "implementing"` (the second case is a re-run after a delivery-council bounce). If neither, report the current status and ask the user to use the correct command for that state.

3. Load any outstanding feedback:
   ```
   cloverleaf-cli latest-feedback <repo_root> <TASK-ID>
   ```
   Capture the output. If present and the latest verdict is `bounce`, pass it into the subagent.

3b. Load the project's test rules (consumer override or shipped default):
   ```bash
   if [ -f "<repo_root>/.cloverleaf/config/qa-rules.json" ]; then
     cat "<repo_root>/.cloverleaf/config/qa-rules.json"
   else
     cat "$(cloverleaf-cli plugin-root)/config/qa-rules.json"
   fi
   ```
   Capture the output as `test_rules`.

4. Dispatch the Implementer subagent via the Task tool:
   - `subagent_type`: `general-purpose`
   - `model`: `sonnet`
   - Prompt: the contents of `$(cloverleaf-cli plugin-root)/prompts/implementer.md`, with placeholders substituted:
     - `{{task}}` → the full task JSON (pretty-printed)
     - `{{feedback}}` → the feedback JSON if present, else the literal string `null`
     - `{{repo_root}}` → absolute path to the current repo
     - `{{base_branch}}` → `main` (or the current default branch)
     - `{{test_rules}}` → the test rules JSON captured in step 3b

   **Dispatch conventions:** invoke the Task tool in foreground mode (its default — do NOT pass `run_in_background: true`). The Task tool returns the subagent's final message as a string in the result. Do NOT use Bash `sleep` to poll an output file — the harness blocks foreground `sleep`, and background dispatch is unnecessary here because the foreground Task tool already blocks until the subagent finishes.

5. Parse the subagent's response. Expect JSON of the form `{"status": "done", "branch": "...", "files_changed": [...], "summary": "..."}` or `{"status": "blocked", "reason": "..."}`.

6. On `blocked`: report the reason and stop. Do NOT advance status.

7. On `done`: walk the state machine. First, switch back to main:

   ```bash
   cd <repo_root>
   git checkout main
   ```

   If this fails (uncommitted changes on main, detached HEAD, etc.), report the error and stop without advancing state.

8. Walk the state machine. The walk is the **same for every `risk_class`** — the collapsed
   council FSM has a single delivery spine (`pending → tactical-plan → implementing → …`),
   so the Implementer always ends at `implementing`. `risk_class` still selects the
   downstream council profile (delivery-fast / delivery-full); it no longer branches the walk.

   The walk still issues **tactical-plan** and **implement** as two distinct `advance-status`
   calls (below), but both run in this one dispatch with no pause between them — this skill
   does **not** stop at `tactical-plan`. A decisive `task.plan_review` checkpoint between them
   is **not currently wired**: see `/cloverleaf-run` §3a/§3b, which document the limitation and
   do not attempt to bind one against the shipped default.

   If the current task status is `pending`:
   ```
   cloverleaf-cli advance-status <repo_root> <TASK-ID> tactical-plan agent   # produce the tactical plan
   cloverleaf-cli advance-status <repo_root> <TASK-ID> implementing agent    # implement; STOP here
   ```
   Stop at `implementing`. The Documenter (high-risk) or the runner (low-risk) advances
   `implementing → documenting` next; the delivery council then owns `documenting → council`.

   If the current task status was `implementing` (loop-back after a council bounce):
   No state advance — re-implement in place. The council already moved state back to
   `implementing`, and the batched feedback is in `.cloverleaf/feedback/`. The task stays
   at `implementing` after this re-run.

9. Commit the state changes:
   ```
   cd <repo_root>
   git add .cloverleaf/
   git commit -m "cloverleaf: <TASK-ID> → implementing"
   ```
   (On a loop-back re-run there may be nothing staged — that is expected; skip the commit
   if `git diff --cached --quiet`.)

10. Report:
    - "✓ Implementer done. Branch `<branch>`. State → implementing."
    - "Files changed: <comma-separated>."
    - "Currently on: `main`."
    - "Next: `/cloverleaf-document <TASK-ID>` (high-risk docs) — for low-risk the runner advances `implementing → documenting`; the delivery council then runs."

## Rules

- Never push the branch or modify remote state.
- If any `advance-status` call fails (illegal transition), stop and report.
- The skill's working directory is the consumer's repo root.
