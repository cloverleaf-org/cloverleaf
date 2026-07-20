---
name: cloverleaf-review
description: Run the Reviewer council member on a task's feature branch as a standalone one-off. Emit-only — it dispatches the reviewer prompt against `main..cloverleaf/<TASK-ID>`, writes a feedback envelope, and reports the verdict (pass/bounce) for the delivery council or a human to apply. It does NOT advance the task FSM. Usage — /cloverleaf-review <TASK-ID>.
---

# Cloverleaf — review (emit-only council member)

The delivery states `review`/`automated-gates` no longer exist — the `@cloverleaf/standard` task FSM
collapsed them into a single `council` phase (Council Slice 4). The Reviewer is now a **council member**
that the runner (`/cloverleaf-run`) dispatches and aggregates alongside the other members. A single member
cannot drive the multi-member council to merge (that would bypass the others' gating), so this standalone
skill is **emit-only**: it runs the reviewer prompt against the task's branch, emits the feedback envelope,
and reports the verdict. **It does not advance the FSM** — the council or a human applies the aggregated
verdict via `apply-council-verdict`.

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
   Light guard only: confirm the task exists and is not in a terminal status (`merged`/`rejected`/`escalated`).
   Do NOT hard-require any particular state — this skill reviews the branch, not a specific FSM state.
   If the task is terminal, report the current status and stop.

3. The Implementer's branch is `cloverleaf/<TASK-ID>`. Confirm it exists: `git rev-parse --verify cloverleaf/<TASK-ID>`. If missing, report the discrepancy and stop. Do NOT check out this branch; stay on main.

4. Compute the diff without checking out:
   ```bash
   git diff main..cloverleaf/<TASK-ID>
   ```
   Capture this output for the subagent.

4b. Load the project's test rules (consumer override or shipped default):
   ```bash
   if [ -f "<repo_root>/.cloverleaf/config/qa-rules.json" ]; then
     cat "<repo_root>/.cloverleaf/config/qa-rules.json"
   else
     cat "$(cloverleaf-cli plugin-root)/config/qa-rules.json"
   fi
   ```
   Capture the output as `test_rules`.

5. Dispatch the Reviewer subagent via the Task tool:
   - `subagent_type`: `general-purpose`
   - `model`: `sonnet`
   - Prompt: contents of `$(cloverleaf-cli plugin-root)/prompts/reviewer.md` with substitutions for `{{task}}`, `{{branch}}`, `{{base_branch}}`, `{{repo_root}}`, `{{diff}}`, `{{test_rules}}`.

   **Dispatch conventions:** invoke the Task tool in foreground mode (its default — do NOT pass `run_in_background: true`). The Task tool returns the subagent's final message as a string in the result. Do NOT use Bash `sleep` to poll an output file — the harness blocks foreground `sleep`, and background dispatch is unnecessary here because the foreground Task tool already blocks until the subagent finishes.

6. Parse the subagent's response. Expect a feedback envelope JSON of the form `{"verdict": "pass"|"bounce", "summary": "...", "findings": [...]}`. Validate shape: verdict must be `pass` or `bounce`; if `bounce`, findings must have at least one entry with `severity` (one of `blocker|error|warning|info`) and `message`.

7. **Emit the envelope + report the verdict (no FSM advance).**

   Persist the feedback envelope so the council/human can read it, regardless of verdict:
   1. Write the feedback envelope to a temp file: `echo '<envelope-json>' > /tmp/cloverleaf-fb-r.json`.
   2. `cloverleaf-cli write-feedback <repo_root> <TASK-ID> /tmp/cloverleaf-fb-r.json` — captures the path like `.cloverleaf/feedback/<TASK-ID>-r<N>.json`.
   3. Commit the persisted feedback file:
      ```bash
      cd <repo_root>
      git add .cloverleaf/feedback/
      git commit -m "cloverleaf: <TASK-ID> reviewer verdict (emit-only)"
      ```

   Then report the verdict — do **NOT** run `advance-status`:

   **Pass:** "✓ Reviewer verdict: **pass**. Feedback emitted to `.cloverleaf/feedback/<TASK-ID>-r<N>.json`. This is one council member's verdict — the delivery council (`/cloverleaf-run <TASK-ID>`) or a human applies the aggregated verdict (`apply-council-verdict`); this skill does not advance the FSM."

   **Bounce:** "✗ Reviewer verdict: **bounce**. Findings: <summarize findings by severity>. Feedback emitted to `.cloverleaf/feedback/<TASK-ID>-r<N>.json`. The delivery council or a human applies the verdict (a council bounce loops the task back to `implementing`); this skill does not advance the FSM."

## Rules

- Never push.
- Do not modify source code — the reviewer is read-only.
- Emit-only: never call `advance-status`. This is one council member's verdict; the council/human applies it.
