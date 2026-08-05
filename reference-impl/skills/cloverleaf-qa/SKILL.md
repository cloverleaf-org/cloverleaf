---
name: cloverleaf-qa
description: Run the QA council member on a task's feature branch as a standalone one-off. Dispatches a subagent to run per-package test suites against an isolated worktree. Emit-only — it writes a feedback envelope with the test results and reports the verdict (pass/bounce/escalate) for the delivery council or a human to apply. It does NOT advance the task FSM. Usage — /cloverleaf-qa <TASK-ID>.
---

# Cloverleaf — qa (emit-only council member)

The delivery states `qa`/`final-gate` are no longer entered by a standalone QA gate — the `@cloverleaf/standard`
task FSM collapsed the delivery gates into a single `council` phase (Council Slice 4). QA is now a **council member**
that the runner (`/cloverleaf-run`) dispatches and aggregates alongside the other members. A single member cannot
drive the multi-member council to `final-gate` (that would bypass the others' gating), so this standalone skill is
**emit-only**: it runs the QA prompt against the task's branch, emits the feedback envelope with the test results,
and reports the verdict. **It does not advance the FSM** — the council or a human applies the aggregated verdict via
`apply-council-verdict` (a council pass is what advances `council → final-gate`).

## Steps

0. Pre-flight: ensure you are on `main` and clean stale feedback temp files from previous runs (prevents /tmp leakage between tasks). If not on main, `git checkout main`. If main has uncommitted changes, stop and report.

   ```bash
   rm -f /tmp/cloverleaf-fb-r.json /tmp/cloverleaf-fb-u.json /tmp/cloverleaf-fb-q.json
   ```

1. Capture the TASK-ID argument.

2. Load the task:
   ```
   cloverleaf-cli load-task <repo_root> <TASK-ID>
   ```
   Light guard only: confirm the task exists and is not terminal (`merged`/`rejected`/`escalated`). Do NOT hard-require any particular state — this skill reviews the branch, not a specific FSM state. If the task is terminal, report and stop.

3. Confirm feature branch exists: `git rev-parse --verify cloverleaf/<TASK-ID>`.

4. Ensure required directories exist:
   ```bash
   mkdir -p <repo_root>/.cloverleaf/runs/<TASK-ID>/qa
   ```

5. Load QA rules JSON:
   ```bash
   # Consumer override takes precedence over the package default.
   if [ -f "<repo_root>/.cloverleaf/config/qa-rules.json" ]; then
     cat "<repo_root>/.cloverleaf/config/qa-rules.json"
   else
     cat $(cloverleaf-cli plugin-root)/config/qa-rules.json
   fi
   ```
   Capture for the subagent as `qa_rules`.

6. Compute diff:
   ```bash
   git diff main..cloverleaf/<TASK-ID>
   ```

7. Dispatch the QA subagent via the Task tool:
   - `subagent_type`: `general-purpose`
   - `model`: `sonnet`
   - Prompt: contents of `$(cloverleaf-cli plugin-root)/prompts/qa.md` with substitutions for `{{task}}`, `{{diff}}`, `{{branch}}`, `{{base_branch}}`, `{{repo_root}}`, `{{qa_rules}}` (the JSON loaded in step 5).

   **Dispatch conventions:** invoke the Task tool in foreground mode (its default — do NOT pass `run_in_background: true`). The Task tool returns the subagent's final message as a string in the result. Do NOT use Bash `sleep` to poll an output file — the harness blocks foreground `sleep`, and background dispatch is unnecessary here because the foreground Task tool already blocks until the subagent finishes.

8. Parse response: expect `{"verdict": "pass"|"bounce"|"escalate", "summary", "findings"}`. There is no separate `results` field — the aggregate test counts are folded into the end of `summary` (e.g., "Test counts: passed 153, failed 0, total 153.").

9. **Emit the envelope + report the verdict (no FSM advance).**

   Persist the feedback envelope — verdict, summary (including the aggregate test counts), and findings — so the council/human can read it, regardless of verdict:
   1. Write the feedback envelope: `echo '<json>' > /tmp/cloverleaf-fb-q.json`
   2. `cloverleaf-cli write-feedback <repo_root> <TASK-ID> /tmp/cloverleaf-fb-q.json --prefix=q`
   3. Commit the persisted feedback file:
      ```bash
      cd <repo_root>
      git add .cloverleaf/feedback/
      git commit -m "cloverleaf: <TASK-ID> qa verdict (emit-only)"
      ```

   Then report the verdict — do **NOT** run `advance-status`:

   **Pass:** "✓ QA verdict: **pass** — `<summary>`. Feedback emitted to `.cloverleaf/feedback/<TASK-ID>-q<N>.json`. This is one council member's verdict — the delivery council (`/cloverleaf-run <TASK-ID>`) or a human applies the aggregated verdict (`apply-council-verdict`, a council pass advances `council → final-gate`); this skill does not advance the FSM."

   **Bounce:** "✗ QA verdict: **bounce** — `<summary>`. Feedback emitted to `.cloverleaf/feedback/<TASK-ID>-q<N>.json`. The delivery council or a human applies the verdict (a council bounce loops the task back to `implementing`); this skill does not advance the FSM."

   **Escalate:** "✗ QA verdict: **escalate** (infrastructure issue) — `<summary>`. Feedback emitted to `.cloverleaf/feedback/<TASK-ID>-q<N>.json`. The council or a human applies the verdict (a council escalate → `escalated`); this skill does not advance the FSM. Review infrastructure and retry manually."

## Rules

- Never push. Read-only. Do not modify source.
- Emit-only: never call `advance-status`. This is one council member's verdict; the council/human applies it.
