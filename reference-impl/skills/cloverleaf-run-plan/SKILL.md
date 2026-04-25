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

   b. **For each ready task**, isolate it in its own git worktree and spawn a claw-drive Session B rooted in that worktree. A shared `cwd` across concurrent sessions is **unsafe** — each Session B's `/cloverleaf-run` mutates HEAD via `git checkout -b cloverleaf/<TASK-ID>`, and parallel Sessions on one working tree irreparably clobber each other's branches and state. Worktrees give each Session its own working directory so code + state commits on the task branch are fully isolated; the walker (in the primary repo, on `main`) handles the final merge serially.

      Per ready task:

      ```bash
      WT="/tmp/walker-<PLAN-ID>-<TASK-ID>"
      rm -rf "$WT"  # idempotent: clean any leftover from a prior run
      git -C <repo_root> worktree add "$WT" -b cloverleaf/<TASK-ID> main
      ```

      Then `mcp__claw-drive__start_session` with:

      - `cwd`: `$WT` (NOT `<repo_root>`)
      - `decision_timeout_seconds`: `3600`
      - `scenario_brief`: constructed for this task (see "Session brief template" below — critically, the brief instructs Session B to stop **before** invoking `/cloverleaf-merge`; the walker merges on main in step 5e).
      - `policy`: the v0.6 walker policy (see "Walker policy" below).

      Record the returned `session_id`, `worktree_path`, and `branch_name` in walk-state with `state: "running"`, `started_at: <now>`, `last_seq: 0`. Persist via `walk-state-write`.

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

   e. **Drain the final-gate queue serially and merge on main.** Session B does NOT invoke `/cloverleaf-merge` — it stops at automated-gates (fast lane) or final-gate (full pipeline) and reports. The walker performs the merge on main in the primary repo. For each queued task:

      1. Print a full summary to the driver:
         ```
         ⏵ <TASK-ID> ready to merge (<fast lane | full pipeline>)
           Reviewer: <summary>
           UI Reviewer: <summary or "skipped">
           QA: <summary or "n/a for fast lane">
           Session <session_id>, worktree <worktree_path>

           Confirm merge? (y/N, or ask a question)
         ```
      2. Read the user's response.
      3. If it matches `^y(es)?$|^Y(ES)?$` → perform the merge in the primary repo:
         ```bash
         cd <repo_root>
         git checkout main
         git merge --no-ff cloverleaf/<TASK-ID> -m "cloverleaf: <TASK-ID> merged (<fast_lane | full_pipeline>)"
         ```
         Then advance state and commit:
         ```bash
         # Fast lane:
         cloverleaf-cli emit-gate-decision <repo_root> <TASK-ID> human_merge approve human
         cloverleaf-cli advance-status <repo_root> <TASK-ID> merged human human_merge fast_lane
         # Full pipeline (task is already at final-gate):
         cloverleaf-cli emit-gate-decision <repo_root> <TASK-ID> final_approval_gate approve human
         cloverleaf-cli advance-status <repo_root> <TASK-ID> merged human final_approval_gate full_pipeline
         ```
         ```bash
         git add .cloverleaf/ && git commit -m "cloverleaf: <TASK-ID> merged"
         ```
         Capture the merge commit SHA. Mark task `state: "merged"` with `merge_commit` in walk-state. Send `y` (informational) back to Session B so it can record the outcome and exit, but the walker is the authoritative merge-performer.
         **Tear down the worktree**: `git -C <repo_root> worktree remove --force <worktree_path>`. Delete the branch is optional (keep if useful for post-hoc inspection).
      4. If it matches `^n(o)?$|^N(O)?$` → mark task `state: "awaiting_final_gate"`. Send `n` to Session B. **Keep the worktree** so the user can re-run `/cloverleaf-merge <TASK-ID>` manually pointing at it, or fix and retry. Continue with the next queued task.
      5. Otherwise → forward the user's text as a user turn to Session B via `mcp__claw-drive__send_turn` (it's a question). Wait for the session's next `turn_completed`. Print the answer. **Re-surface the same y/N prompt** (with the Q&A appended to shown context). Loop until step 3 or 4 fires.

      Final-gate drain is strictly serial across tasks — one prompt, one decision, then the next. The merge itself is sequential on main for the same reason: two concurrent `git merge --no-ff` on main would race, even if the feature branches are independent.

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
You are driving <TASK-ID> Delivery via /cloverleaf-run inside a dedicated
git worktree at <worktree_path>. The worktree is checked out to branch
cloverleaf/<TASK-ID> (already created from main). Task risk_class: <class>.

Plan: invoke `/cloverleaf-run <TASK-ID>`.

**DO NOT invoke `/cloverleaf-merge`**. Fast lane stops after `/cloverleaf-review`
lands the task at `automated-gates`. Full pipeline stops after QA/UI-Review
lands the task at `final-gate`. Report status + summaries at that point and
exit cleanly. The walker runs in the primary repo on `main` and performs the
real `git merge --no-ff` itself after human approval — the worktree's main
branch can't be checked out concurrently, which is why the walker owns the
merge. If `/cloverleaf-run` would normally invoke `/cloverleaf-merge`
internally (fast-lane orchestrator), interrupt before that step and exit.

All four v0.5.2+v0.5.3+v0.5.4+v0.5.5 dogfood fixes are in place:
- /cloverleaf-merge actor: human final_approval_gate full_pipeline.
- cloverleaf-cli prep-worktree is idempotent.
- Documenter runs `git status --porcelain` and stages every modified doc.
- cloverleaf-ui-review uses /cloverleaf-approve-baselines (fully-qualified).

Expected: zero interventions until you reach automated-gates / final-gate,
then exit.

Do not push. Do not publish. Report merge + state commit SHAs on completion.
```

## Walker policy

The walker spawns each Session B with a conservative auto-approve policy (Read/Glob/Grep, git-read, cloverleaf-cli, npm/npx/node, common compound scripts, prep-worktree, mkdir -p, etc.) and an auto-reject list covering sudo, `rm -rf /`, git push, npm publish, destructive disk ops. Anything else escalates to the walker for human-in-the-loop handling.

The concrete policy JSON is the same one used during the CLV-16..CLV-20 dogfood runs; see `.cloverleaf/claw-drive-policy.json` in the repo for the starting template.

## Rules

- Never push. Never publish.
- Always persist walk-state via `cloverleaf-cli walk-state-write` (atomic). Never write the file directly.
- Always treat the on-disk `.cloverleaf/tasks/<id>.json` status as the source of truth AFTER a task's branch has been merged; before that, the task's state lives on `cloverleaf/<TASK-ID>` in its worktree (walk-state is authoritative for the walker's scheduling decisions during the walk).
- **Every ready task runs in its own git worktree.** Sharing `cwd` across concurrent sessions is unsafe — parallel `git checkout` / `commit` races corrupt branches and state. The walker creates a worktree per task, passes it to Session B as `cwd`, and owns the final merge serially on main.
- Session B must NOT invoke `/cloverleaf-merge`. The walker performs the merge in the primary repo, on main, as the authoritative merge-performer.
- Escalations surface immediately; they do NOT queue behind the final-gate drain.
- Final-gate drain is serial across tasks — one prompt, one decision.
- The walker exits after the loop reports the final status; it does not auto-retry escalated tasks.
