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
   if [ "$current" != "main" ]; then git -C <repo_root> checkout main; fi
   git status --short
   ```

   If `main` has uncommitted changes, stop and report — the user must clean up first.

1. Capture the `<PLAN-ID>` argument and optional flags:

   - `--max-concurrent=N` — cap simultaneous sessions. Default `3` (resolved via `cloverleaf-cli walker-default-concurrency`). Setting `--max-concurrent=1` yields serial behaviour.
   - `--reset` — wipe `.cloverleaf/runs/plan/<PLAN-ID>/walk-state.json` and start fresh.

   Resolve `MAX` and print exactly one startup info line:

   ```bash
   if [ -n "$MAX_FLAG" ]; then
     MAX="$MAX_FLAG"
     echo "max_concurrent=$MAX (from --max-concurrent flag)"
   else
     if ! MAX=$(cloverleaf-cli walker-default-concurrency); then
       echo "ERROR: cloverleaf-cli walker-default-concurrency failed."
       echo "Fix or remove \`~/.config/cloverleaf/walker.json\` and retry."
       exit 1
     fi
     cloverleaf-cli walker-default-concurrency --explain
   fi
   ```

   If `cloverleaf-cli walker-default-concurrency` exits non-zero (e.g. malformed `${XDG_CONFIG_HOME:-$HOME/.config}/cloverleaf/walker.json`), the walker stops and reports the error: **Fix or remove `~/.config/cloverleaf/walker.json` and retry.** This mirrors the step-0 uncommitted-changes stop-and-report pattern.

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
      WT="${XDG_CACHE_HOME:-$HOME/.cache}/cloverleaf/walker/<PLAN-ID>-<TASK-ID>"
      mkdir -p "$(dirname "$WT")"
      rm -rf "$WT"  # idempotent: clean any leftover from a prior run
      git -C <repo_root> worktree add "$WT" -b cloverleaf/<TASK-ID> main
      cloverleaf-cli prep-worktree <repo_root> "$WT"
      ```

      Then `mcp__claw-drive__start_session` with:

      - `cwd`: `$WT` (NOT `<repo_root>`)
      - `decision_timeout_seconds`: `3600`
      - `scenario_brief`: constructed for this task (see "Session brief template" below — critically, the brief instructs Session B to stop **before** invoking `/cloverleaf-merge`; the walker merges on main in step 5e).
      - `policy`: the v0.6 walker policy (see "Walker policy" below).

      Record the returned `session_id`, `worktree_path`, and `branch_name` in walk-state with `state: "running"`, `started_at: <now>`, `last_seq: 0`. Persist via `walk-state-write`.

      Immediately after `mcp__claw-drive__start_session` returns, attach a Monitor tool stream for the new session:

      ```
      Monitor(
        watch_command: "claw-drive watch <session_id> --since 0 --idle-after 600",
        persistent: true,
        timeout_ms: 3600000
      )
      ```

      This ensures the walker receives all child events without requiring Session A nudges. The `persistent: true` flag keeps the stream open across turns; `timeout_ms: 3600000` caps the watch at one hour.

   c. **Monitor live sessions.** Each child session is already watched via the persistent Monitor stream attached in step 5b. When resuming after a walker restart (step 4), re-attach the Monitor with `--since <last_seq>` for each session still in `state: "running"`:

      ```
      Monitor(
        watch_command: "claw-drive watch <session_id> --since <last_seq> --idle-after 600",
        persistent: true,
        timeout_ms: 3600000
      )
      ```

      The `--idle-after 600` flag instructs claw-drive to emit a synthetic `idle` event if a session produces no output for 600 seconds (10 minutes), enabling the walker to detect stalled sessions without polling.

   d. **Handle events.** Dispatch each incoming Monitor event by type:

      - **`idle`** (`silent_for_ms >= 600000`) — the session has been silent for 10 minutes. For each child session emitting this event, check terminal state:
        ```bash
        claw-drive status <child_session_id>
        ```
        Read `last_token` from the status response, then branch:
        - `last_token` is `[DONE]` → treat as terminal; proceed with drain (same as `session_stopped` → stopped cleanly).
        - `last_token` is `[NEEDS-INPUT]` → the session is waiting for user input; surface to the user for a decision and send a reply via `mcp__claw-drive__send_turn`.
        - Status output matches the transient-5xx pattern (`5\d\d\b`, `API Error: 5\d\d`, or `temporarily unavailable`) → invoke `mcp__claw-drive__send_turn` with message `'API recovered. Retry the last operation.'` to trigger self-healing.
        - None of the above → the session is still working; continue waiting; do NOT auto-kill.
        - **Per-session idle > 30 min** (no `idle` event received, wall-clock elapsed) → surface to user for inspection; do NOT auto-kill.

      - **`tool_decision_required`** → let the walker policy decide (auto-approve per rules, defer to user for anything not covered).

      - **`turn_completed [DONE]`** → the session has finished its current turn with a `[DONE]` terminal token. If the on-disk task status is `final-gate` or `automated-gates`, push onto the final-gate queue. Otherwise continue monitoring.

      - **`turn_completed [NEEDS-INPUT]`** → the session is paused waiting for a user reply. Surface the assistant's last message to the driver and send the user's response via `mcp__claw-drive__send_turn`.

      - **`session_stopped`** → reconcile as in step 4.

      - **Escalation detected** (assistant text contains `escalated` / Reviewer/QA/UI-Reviewer bounce cap / git merge abort) → **surface to user immediately** with:
        > ⚠️ `<TASK-ID>` escalated at `<agent>` (reason: `<detail>`). Session `<session_id>`. Descendants in this Plan are now blocked until you unstick it.
        > To unstick: read feedback at `.cloverleaf/feedback/<TASK-ID>-*.json`, fix the issue, and run `/cloverleaf-run <TASK-ID>` manually. The walker will re-check on its next tick — when the task reaches `merged`, it'll pick up descendants automatically.
        Mark the task `state: "escalated"` in walk-state; do NOT queue it behind final-gate approvals; continue other branches.

      **Transient-5xx self-healing.** Whenever any event's content (assistant text, error field, or status output) matches the pattern `5\d\d\b|API Error: 5\d\d|temporarily unavailable`, invoke:
      ```
      mcp__claw-drive__send_turn(session_id: <session_id>, text: "API recovered. Retry the last operation.")
      ```
      This covers transient API errors (e.g. HTTP 503, `API Error: 503`) and the `temporarily unavailable` service message without requiring a Session A nudge from the human.

   e. **Drain the final-gate queue serially and merge on main.** Session B does NOT invoke `/cloverleaf-merge` — it stops at automated-gates (fast lane) or final-gate (full pipeline) and reports. The walker performs the merge on main in the primary repo. For each queued task:

      **Scope check (BEFORE the y/N prompt).** Run `cloverleaf-cli check-scope` and capture its output and exit code:

      ```bash
      SCOPE_JSON=$(cloverleaf-cli check-scope <repo_root> <TASK-ID> --branch cloverleaf/<TASK-ID> 2>/dev/null)
      SCOPE_EXIT=$?
      ```

      - **If exit 0**: parse the JSON. If `contested[]` is non-empty:
        - **Skip the y/N prompt entirely.**
        - Mark the task `state: "escalated"` in walk-state via `walk-state-write`.
        - Surface the following message to the driver (the literal contested-escalation message template):
          ```
          ⚠️ <TASK-ID> escalated: scope-contested merge. Files contested with sibling task(s): <list of file:owned_by pairs>. Walker will not auto-resolve. Inspect the Plan decomposition (CLV-86 vs CLV-87 etc.) and either (a) re-decompose so each contested file is owned by exactly one task, or (b) merge the colliding tasks into one. Re-run /cloverleaf-run-plan <PLAN-ID> after fixing.
          ```
        - Continue to the next queued task. Do NOT proceed to the merge prompt.
      - **If exit non-zero (tooling failure)**: print a warning and fall through to the existing merge flow without scope enforcement (**warn-and-proceed**):
        ```
        ⚠️ check-scope failed (exit N) — falling through to existing merge flow without scope enforcement.
        ```
      - **If exit 0 and `contested[]` is empty**: proceed normally to the summary + y/N prompt below. Retain the parsed `extension[]` array from the JSON for use in the post-merge auto-extend block.

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

         First, **guard against conflict markers** — scan every file changed on the task branch for unresolved conflict markers before attempting the merge:
         ```bash
         git -C <repo_root> checkout main
         CHANGED_FILES=$(git -C <repo_root> diff --name-only main..cloverleaf/<TASK-ID>)
         if [ -n "$CHANGED_FILES" ] && echo "$CHANGED_FILES" | xargs grep -l -E '^(<{7}|={7}|>{7})' 2>/dev/null | grep -q .; then
           echo "ERROR: conflict markers found in changed files — aborting merge for <TASK-ID>"
           echo "$CHANGED_FILES" | xargs grep -l -E '^(<{7}|={7}|>{7})' 2>/dev/null
           # Do NOT proceed; mark task escalated and surface to user
         else
           git -C <repo_root> merge --no-ff cloverleaf/<TASK-ID> -m "cloverleaf: <TASK-ID> merged (<fast_lane | full_pipeline>)"
         fi
         ```

         If conflict markers are found, abort the merge: mark task `state: "escalated"` in walk-state, surface to the user with the list of affected files, and do NOT advance state. Continue with the next queued task.

         After a **successful** `git merge --no-ff`, advance state and commit:
         ```bash
         # Fast lane:
         cloverleaf-cli emit-gate-decision <repo_root> <TASK-ID> human_merge approve human
         cloverleaf-cli advance-status <repo_root> <TASK-ID> merged human human_merge fast_lane
         # Full pipeline (task is already at final-gate):
         cloverleaf-cli emit-gate-decision <repo_root> <TASK-ID> final_approval_gate approve human
         cloverleaf-cli advance-status <repo_root> <TASK-ID> merged human final_approval_gate full_pipeline
         ```
         ```bash
         git -C <repo_root> add .cloverleaf/ && git -C <repo_root> commit -m "cloverleaf: <TASK-ID> merged"
         ```
         Capture the merge commit SHA:
         ```bash
         MERGE_COMMIT=$(git -C <repo_root> rev-parse HEAD)
         ```
         Immediately update walk-state to record the successful merge (bug #7 fix — walk-state must reflect `merged` state):
         ```bash
         # Write a temporary walk-state JSON with state: "merged" and merge_commit, then persist atomically
         # (build the updated walk-state object in-memory and call walk-state-write)
         cloverleaf-cli walk-state-write <repo_root> <updated-walk-state-json-path>
         # The updated walk-state sets tasks["<TASK-ID>"].state = "merged"
         #                           and tasks["<TASK-ID>"].merge_commit = "$MERGE_COMMIT"
         ```
         **Post-merge auto-extend.** If the `extension[]` array captured from the earlier `cloverleaf-cli check-scope` call was non-empty, invoke `extend-scope` and commit the amended task doc:

         ```bash
         cloverleaf-cli extend-scope <repo_root> <TASK-ID> --add <file1> --add <file2> ... --reason "auto-extended post-merge: files touched but undeclared"
         git -C <repo_root> add .cloverleaf/tasks/<TASK-ID>.json .cloverleaf/runs/plan/<PLAN-ID>/audit.jsonl
         git -C <repo_root> commit -m "cloverleaf: <TASK-ID> scope auto-extended (+N files)"
         ```

         where N is the count of files in `extension[]`.

         Send `y` (informational) back to Session B so it can record the outcome and exit, but the walker is the authoritative merge-performer.
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

   ## Next steps (release publishing)

   Once all tasks are merged, run the following commands in order to tag and publish the release:

   ```bash
   git -C <repo_root> tag -a reference-impl-v<VERSION> -m "reference-impl v<VERSION>"
   git -C <repo_root> push origin main
   git -C <repo_root> push origin reference-impl-v<VERSION>
   (cd reference-impl && npm publish --access public)
   gh release create reference-impl-v<VERSION> --title "reference-impl v<VERSION>" --notes-from-tag
   ```

## Session brief template

The walker constructs a per-task `scenario_brief` roughly like:

```
You are driving <TASK-ID> Delivery via /cloverleaf-run inside a dedicated
git worktree rooted at $WORKTREE_ROOT. The worktree is checked out to branch
cloverleaf/<TASK-ID> (already created from main). Task risk_class: <class>.

**Pre-flight: before any task steps, run `cd "$WORKTREE_ROOT"` to ensure your
working directory is the worktree root, not whatever directory the session
inherited.**

**DO NOT run `git checkout main` from this worktree.** The `main` branch is
held by the primary repo — attempting to check it out here will fail because
the same branch cannot be checked out in two worktrees simultaneously. To
compare your work against main, use `git diff main..HEAD` (safe diff) or
`git show main:<path>` (safe file inspection). All state-advance commits must
stay on the worktree's current branch (`cloverleaf/<TASK-ID>`).

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
- Scope-contested merges are escalated, never auto-resolved.
