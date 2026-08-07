---
name: cloverleaf-ui-review
description: Run the UI Reviewer council member on a task's feature branch as a standalone one-off. Computes diff-affected routes via CLI; if empty, skips axe and emits a trivial pass. Otherwise dispatches a subagent with Playwright + axe-core scoped to those routes, capturing per-engine visual baselines. Emit-only — it writes a feedback envelope + reports the verdict (and surfaces baselines_pending) for the delivery council or a human to apply. It does NOT advance the task FSM. Usage — /cloverleaf-ui-review <TASK-ID>.
---

# Cloverleaf — ui-review (emit-only council member)

The delivery states `ui-review`/`qa` no longer exist — the `@cloverleaf/standard` task FSM collapsed the delivery
gates into a single `council` phase (Council Slice 4). The UI Reviewer is now a **council member** that the runner
(`/cloverleaf-run`) dispatches and aggregates alongside the other members. A single member cannot drive the
multi-member council forward (that would bypass the others' gating), so this standalone skill is **emit-only**: it
computes the affected routes, dispatches the UI reviewer prompt (capturing per-engine visual baselines), emits the
feedback envelope, and reports the verdict. **It does not advance the FSM** — the council or a human applies the
aggregated verdict via `apply-council-verdict`.

**Baselines still gate at the council.** The per-engine (cross-browser) baseline capture and the `baselines_pending`
sidecar mechanism survive unchanged: when the UI reviewer captures new or resized baselines it sets
`baselines_pending=true` via `write-ui-review-state`. The old `ui-review → qa` hold moved to the **council pass**:
the runner holds a council `pass` at `baselines_pending` until `/cloverleaf-approve-baselines <TASK-ID>` clears it and
re-runs the council. This standalone skill just **surfaces** `baselines_pending` in its report; it does not advance
the FSM.

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
   Light guard only: confirm the task exists and is not terminal (`merged`/`rejected`/`escalated`). Do NOT hard-require any particular state — this skill reviews the branch, not a specific FSM state. If the task is terminal, report and stop.

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

6. **Empty-set early-exit.** If `AFFECTED` is `[]`, skip the subagent entirely — there are no renderable routes to check, so the UI member's verdict is a trivial `pass`. Do NOT advance the FSM:
   ```bash
   cd <repo_root>
   git add .cloverleaf/
   git diff --cached --quiet || git commit -m "cloverleaf: <TASK-ID> ui-review skipped (no renderable routes)"
   ```
   Report: "✓ UI Reviewer verdict: **pass** (skipped — no renderable routes affected). This is one council member's verdict — the delivery council (`/cloverleaf-run <TASK-ID>`) or a human applies the aggregated verdict; this skill does not advance the FSM."
   Stop here.

7. Allocate a free preview port:
   ```bash
   PREVIEW_PORT=$(node -e "const net=require('net');const s=net.createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})")
   ```

8. Compute diff:
   ```bash
   git diff main..cloverleaf/<TASK-ID>
   ```

9. **Browser cache env var.** Before the Task-tool dispatch, export the Playwright cache location so the subagent inherits it. This keeps Playwright from re-downloading ~300 MB of browser binaries inside the worktree.

   ```bash
   export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
   ```

   Defer to a value the operator already set — `README.md` documents `PLAYWRIGHT_BROWSERS_PATH` as a supported override for a non-default cache directory, and hard-coding `~/.cache/ms-playwright` here would silently discard it. `ui-reviewer.md` runs the same expression itself, so this step is an optimisation, not a precondition the member depends on.

10. Dispatch the UI Reviewer subagent via the Task tool:
    - `subagent_type`: `general-purpose`
    - `model`: `sonnet`
    - Prompt: contents of `$(cloverleaf-cli plugin-root)/prompts/ui-reviewer.md` with substitutions:
      - `{{task}}`, `{{diff}}`, `{{branch}}`, `{{base_branch}}`, `{{repo_root}}`, `{{preview_port}}`
      - `{{taskId}}` → the TASK-ID from step 1 (**required** — the prompt roots its run artifacts and the `state.json` sidecar at `{{repo_root}}/.cloverleaf/runs/{{taskId}}/ui-review/`. Left unsubstituted, the sidecar lands under a literal `{{taskId}}` directory, step 12's `read-ui-review-state` finds nothing, `baselines_pending` reads `false`, and the human baseline-approval gate silently passes with unapproved baselines)
      - `{{affected_routes}}` → the value of `$AFFECTED` (verbatim — may be `"all"`, a JSON array, or `[]` but step 6 handled `[]` already)
      - `{{ui_review_config}}` → JSON-stringified result of `cloverleaf-cli ui-review-config <repo_root>` (used by the subagent to scope viewport sizes, thresholds, and axe rule overrides)

    Substitute **every** `{{…}}` token above before dispatch: `ui-reviewer.md` declares exactly these nine, and none may reach the subagent literal.

    **Dispatch conventions:** invoke the Task tool in foreground mode (its default — do NOT pass `run_in_background: true`). The Task tool returns the subagent's final message as a string in the result. Do NOT use Bash `sleep` to poll an output file — the harness blocks foreground `sleep`, and background dispatch is unnecessary here because the foreground Task tool already blocks until the subagent finishes.

11. Parse the subagent's response. Expect `{"verdict": "pass"|"bounce"|"escalate", "summary": "...", "findings": [...]}`.

12. **Read the baseline-approval sidecar** (after the subagent completes, regardless of verdict — the per-engine baseline capture + `baselines_pending` mechanism survives the collapse):
    ```bash
    UI_STATE=$(cloverleaf-cli read-ui-review-state <repo_root> <TASK-ID>)
    BASELINES_PENDING=$(echo "$UI_STATE" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).baselines_pending ? 'true' : 'false')")
    ```
    Or more concisely:
    ```bash
    BASELINES_PENDING=$(cloverleaf-cli read-ui-review-state <repo_root> <TASK-ID> | node -e "const s=require('fs').readFileSync('/dev/stdin','utf-8'); process.stdout.write(JSON.parse(s).baselines_pending?'true':'false')")
    ```

13. **Emit the verdict + envelope (no FSM advance).**

    Persist artifacts + the feedback envelope, then report the verdict and surface `baselines_pending`. **Never call `advance-status`** — the council/human applies the aggregated verdict.

    **Pass:**
    1. Commit artifacts: `git add .cloverleaf/ && (git diff --cached --quiet || git commit -m "cloverleaf: <TASK-ID> ui-review verdict (emit-only)")`.
    2. Report, branching on `BASELINES_PENDING`:

       - If `BASELINES_PENDING` is `true`:
         > "✓ UI Reviewer verdict: **pass** (no a11y errors), but **baselines_pending** is true: one or more new or resized visual baselines were captured and require human approval.
         > This is one council member's verdict — the delivery council (`/cloverleaf-run <TASK-ID>`) or a human applies the aggregated verdict; this skill does not advance the FSM. The runner holds a council **pass** at `baselines_pending`: inspect the new baseline images, then run `/cloverleaf-approve-baselines <TASK-ID>` (which clears the flag) so the re-run's council pass applies."

       - If `BASELINES_PENDING` is `false` (or state.json is absent):
         > "✓ UI Reviewer verdict: **pass** (no a11y errors, no baselines pending). This is one council member's verdict — the delivery council (`/cloverleaf-run <TASK-ID>`) or a human applies the aggregated verdict (`apply-council-verdict`); this skill does not advance the FSM."

    **Bounce:**
    1. Write feedback: `echo '<envelope-json>' > /tmp/cloverleaf-fb-u.json`
    2. `cloverleaf-cli write-feedback <repo_root> <TASK-ID> /tmp/cloverleaf-fb-u.json --prefix=u`
    3. Commit the persisted feedback file:
       ```bash
       cd <repo_root>
       git add .cloverleaf/feedback/
       git commit -m "cloverleaf: <TASK-ID> ui-review feedback"
       ```
    4. Report: "✗ UI Reviewer verdict: **bounce**. Findings: <summary by severity>. Feedback emitted to `.cloverleaf/feedback/<TASK-ID>-u<N>.json`. The delivery council or a human applies the verdict (a council bounce loops the task back to `implementing`); this skill does not advance the FSM."

    **Escalate:**
    1. Write feedback: `echo '<envelope-json>' > /tmp/cloverleaf-fb-u.json`
    2. `cloverleaf-cli write-feedback <repo_root> <TASK-ID> /tmp/cloverleaf-fb-u.json --prefix=u`
    3. Commit the persisted feedback file:
       ```bash
       cd <repo_root>
       git add .cloverleaf/feedback/
       git commit -m "cloverleaf: <TASK-ID> ui-review feedback"
       ```
    4. Report: "✗ UI Reviewer verdict: **escalate** (infrastructure issue). Feedback emitted to `.cloverleaf/feedback/<TASK-ID>-u<N>.json`. The council or a human applies the verdict (a council escalate → `escalated`); this skill does not advance the FSM. Review and retry manually."

## Rules

- Never push.
- Do not modify source code — UI Reviewer is read-only.
- **The subagent owns preview-server and worktree teardown** (`ui-reviewer.md` step 13) — including on error. It holds the only handles: `$SERVER_PID` from the backgrounded dev server and `$WT` from `git worktree add`. Neither variable exists in your shell; you never created either resource.
- Your own cleanup is bounded to what you can reach from the repo root: `git -C <repo_root> worktree prune` clears any worktree registration the subagent left behind.
- **Never kill by command-line pattern.** `pkill -f "astro dev"` — or `pkill -f "port=$PREVIEW_PORT"` — also matches the command line of the shell running it, so the shell kills itself: exit 144, and every command after it in the same compound statement silently never runs. Cleanup that looked issued never ran.
- If `$PREVIEW_PORT` is still listening after the subagent returns, report the port rather than killing blind.
- Empty-set early-exit (step 6) skips the browser entirely — no Playwright invocation, no worktree — and emits a trivial `pass`.
- Emit-only: never call `advance-status`. This is one council member's verdict; the council/human applies it.
