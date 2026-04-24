---
name: cloverleaf-run-plan
description: Autonomous DAG walker for Cloverleaf Plans. Given a PLAN-ID in status `gate-approved`, drives each task in the plan's task_dag through Delivery concurrently by spawning one claw-drive Session B per ready task. Default max_concurrent is 3. Surfaces only escalations and per-task final-gate approvals to the human. Resumable across invocations. Usage — /cloverleaf-run-plan <PLAN-ID> [--max-concurrent=N] [--reset].
---

# Cloverleaf — run-plan

## Steps

0. **Pre-flight.**

   ```bash
   cd <repo_root>
   current=$(git rev-parse --abbrev-ref HEAD)
   if [ "$current" != "main" ]; then git checkout main; fi
   git status --short
   ```

   If `main` has uncommitted changes, stop and report — the user must clean up first.

1. Capture the `<PLAN-ID>` argument and optional flags:

   - `--max-concurrent=N` — cap simultaneous sessions. Default `3`. Setting `--max-concurrent=1` yields serial behaviour.
   - `--reset` — wipe `.cloverleaf/runs/plan/<PLAN-ID>/walk-state.json` and start fresh.

2. **Guard against cycles.**

   ```bash
   cloverleaf-cli dag-detect-cycle <repo_root> <PLAN-ID>
   ```

   If non-zero exit, stop. The malformed Plan needs to be fixed first.

3. **Load or initialise walk-state.**

   On `--reset`, `rm -f <repo_root>/.cloverleaf/runs/plan/<PLAN-ID>/walk-state.json`. Then:

   ```bash
   if ! cloverleaf-cli walk-state-read <repo_root> <PLAN-ID> > /tmp/walk-state-<PLAN-ID>.json 2>/dev/null; then
     cat > /tmp/walk-state-<PLAN-ID>.json <<EOF
   {
     "plan_id": "<PLAN-ID>",
     "started": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
     "max_concurrent": <MAX_CONCURRENT>,
     "tasks": {}
   }
   EOF
     cloverleaf-cli walk-state-write <repo_root> /tmp/walk-state-<PLAN-ID>.json
   fi
   ```

4. **Resumability: reconcile running sessions.**

   For each task in the walk-state with `state === "running"`:

   - Query `claw-drive sessions` — is the session still live?
     - **Still running** → keep it, start the watch monitor from `last_seq`.
     - **Stopped cleanly** → check the task's on-disk status:
       - `merged` → update walk-state `state: "merged"`.
       - Anything else → mark `state: "pending"` for re-scheduling.
     - **Stopped with error** → mark `state: "pending"`.

   Atomic walk-state writes: every update goes through `cloverleaf-cli walk-state-write`.

5. **Schedule loop.** Repeat until no running sessions AND no ready tasks:

   a. **Compute ready tasks.**

      ```bash
      cloverleaf-cli dag-ready-tasks <repo_root> <PLAN-ID> <MAX_CONCURRENT>
      ```

      Returns a newline-separated list of task IDs that are `pending`, have all ancestors `merged`, and fit within free concurrency slots.

   b. **For each ready task**, spawn a claw-drive Session B via the MCP tool `mcp__claw-drive__start_session`:

      - `cwd`: `<repo_root>`
      - `decision_timeout_seconds`: `3600`
      - `scenario_brief`: constructed for this task (see "Session brief template" below).
      - `policy`: the v0.6 walker policy (see "Walker policy" below).

      Record the returned `session_id` in walk-state with `state: "running"`, `started_at: <now>`, `last_seq: 0`. Persist via `walk-state-write`.

   c. **Monitor live sessions.** Start `claw-drive watch <session_id> --since <last_seq>` for each running session. Merge the streams into a single notification feed (e.g., the Monitor tool, or `claw-drive watch` run per-session in the background with a filter).

   d. **Handle events.**

      - **tool_decision_required** → let the walker policy decide (auto-approve per rules, defer to user for anything not covered).
      - **turn_completed with final-gate prompt text** → push onto the final-gate queue.
      - **Escalation detected** (assistant text contains `escalated` / Reviewer/QA/UI-Reviewer bounce cap / git merge abort) → **surface to user immediately** with:
        > ⚠️ `<TASK-ID>` escalated at `<agent>` (reason: `<detail>`). Session `<session_id>`. Descendants in this Plan are now blocked until you unstick it.
        > To unstick: read feedback at `.cloverleaf/feedback/<TASK-ID>-*.json`, fix the issue, and run `/cloverleaf-run <TASK-ID>` manually. The walker will re-check on its next tick — when the task reaches `merged`, it'll pick up descendants automatically.
        Mark the task `state: "escalated"` in walk-state; do NOT queue it behind final-gate approvals; continue other branches.
      - **session_stopped** → reconcile as in step 4.
      - **Per-session idle > 30 min** → surface to user for inspection; do NOT auto-kill.

   e. **Drain the final-gate queue serially.** For each queued prompt:

      1. Print a full summary to the driver:
         ```
         ⏵ <TASK-ID> ready to merge (full pipeline)
           Reviewer: <summary>
           UI Reviewer: <summary or "skipped">
           QA: <summary>
           Session <session_id>

           Confirm merge? (y/N, or ask a question)
         ```
      2. Read the user's response.
      3. If it matches `^y(es)?$|^Y(ES)?$` → send `y` back via `mcp__claw-drive__send_turn`, await the session's merge-complete turn, mark task `state: "merged"` with `merge_commit` extracted from the session output.
      4. If it matches `^n(o)?$|^N(O)?$` → send `n`, mark task `state: "awaiting_final_gate"`, continue.
      5. Otherwise → send the user's text as a user turn (it's a question). Wait for the session's next `turn_completed`. Print the answer. **Re-surface the same y/N prompt** (with the Q&A appended to shown context). Loop until step 3 or 4 fires.

      Final-gate drain is strictly serial across tasks — one prompt, one decision, then the next.

   f. **Exit check.** If no running sessions AND `dag-ready-tasks` returned empty AND the final-gate queue is empty, break the loop.

6. **Report.**

   - `merged: [ ... ]` — with merge-commit SHAs.
   - `escalated: [ ... ]` — with reason per task.
   - `awaiting_final_gate: [ ... ]` — user said `n`; re-invoke `/cloverleaf-merge <TASK-ID>` to retry.
   - `unreachable: [ ... ]` — descendants of escalated tasks.

   If every task in the plan's `task_dag.nodes` has `state: "merged"`, print: "✓ Plan `<PLAN-ID>` complete."

## Session brief template

The walker constructs a per-task `scenario_brief` roughly like:

```
You are driving CLV-<TASK-ID> Delivery via /cloverleaf-run. Task is pending, risk_class: <class>.

Plan: invoke `/cloverleaf-run CLV-<TASK-ID>`.

All four v0.5.2+v0.5.3+v0.5.4+v0.5.5 dogfood fixes are in place:
- /cloverleaf-merge actor: human final_approval_gate full_pipeline.
- cloverleaf-cli prep-worktree is idempotent.
- Documenter runs `git status --porcelain` and stages every modified doc.
- cloverleaf-ui-review uses /cloverleaf-approve-baselines (fully-qualified).

Expected: zero interventions until the final-gate approval prompt.

Do not push. Do not publish. Report merge + state commit SHAs on completion.
```

## Walker policy

The walker spawns each Session B with a conservative auto-approve policy (Read/Glob/Grep, git-read, cloverleaf-cli, npm/npx/node, common compound scripts, prep-worktree, mkdir -p, etc.) and an auto-reject list covering sudo, `rm -rf /`, git push, npm publish, destructive disk ops. Anything else escalates to the walker for human-in-the-loop handling.

The concrete policy JSON is the same one used during the CLV-16..CLV-20 dogfood runs; see `.cloverleaf/claw-drive-policy.json` in the repo for the starting template.

## Rules

- Never push. Never publish.
- Always persist walk-state via `cloverleaf-cli walk-state-write` (atomic). Never write the file directly.
- Always treat the on-disk `.cloverleaf/tasks/<id>.json` status as the source of truth; walk-state is a cache.
- Escalations surface immediately; they do NOT queue behind the final-gate drain.
- Final-gate drain is serial across tasks — one prompt, one decision.
- The walker exits after the loop reports the final status; it does not auto-retry escalated tasks.
