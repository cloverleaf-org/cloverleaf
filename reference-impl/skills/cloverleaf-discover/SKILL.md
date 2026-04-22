---
name: cloverleaf-discover
description: End-to-end Discovery orchestrator. Drives RFC → (Spikes) → Plan → gates → task materialisation. Blocks on human gate decisions (rfc_strategy_gate, task_batch_gate). On Plan approval, materialises tasks and asks whether to kick off /cloverleaf-run on the first DAG root. Usage — /cloverleaf-discover <brief-file>.
---

# Cloverleaf — discover (Discovery orchestrator)

The user has invoked this skill with a brief file path (e.g., `docs/briefs/cross-browser-ui-review.md`).

## Branch discipline

Each sub-skill runs from `main`. Between steps, confirm branch is `main` before proceeding. All sub-skills return the user to `main`.

## Per-agent bounce budget (in-session)

- **Researcher and Plan agent bounces are budgeted inside the sub-skills** (`/cloverleaf-draft-rfc`, `/cloverleaf-spike`, `/cloverleaf-breakdown`), each with a 3-bounce per-invocation budget. The orchestrator invokes each sub-skill once per step — if a sub-skill exhausts its budget, it halts, and the orchestrator treats that as a hard halt and dumps state.
- **Revise loops are budgeted in the orchestrator:**
  ```
  MAX_REVISE_LOOPS = 3
  ```
  Resets on each `/cloverleaf-discover` invocation.

## Steps

1. Capture `<brief-file>` as `$BRIEF_FILE`. Verify file exists:
   ```bash
   [ -f "$BRIEF_FILE" ] || { echo "Brief file not found: $BRIEF_FILE" >&2; exit 1; }
   ```

2. Verify branch is `main`:
   ```bash
   [ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || { echo "Run /cloverleaf-discover from main" >&2; exit 1; }
   ```

3. **Create the RFC** — invoke `/cloverleaf-new-rfc $BRIEF_FILE`. Capture the printed RFC ID as `$RFC_ID`.

   Initialise revise loop counter:
   ```
   revise_loops = 0
   ```

4. **Draft RFC (Researcher draftRfc)** — invoke `/cloverleaf-draft-rfc $RFC_ID`. Researcher runs with a per-invocation bounce budget (3 bounces inside draft-rfc).
   - On bounce exhaustion (draft-rfc exits non-zero): dump state to `.cloverleaf/runs/$RFC_ID/discover-crash.json` and halt.
   - Reload the RFC. Its new status is either `spike-in-flight` (unknowns non-empty) or `planning` (unknowns empty).

5. **Conditional on RFC status after step 4:**
   - If `planning`: skip the spike loop below; proceed to step 6.
   - If `spike-in-flight`: run every pending spike linked to this RFC:
     ```bash
     for each spike in .cloverleaf/spikes/*.json where parent_rfc.id === $RFC_ID AND status === "pending":
       invoke /cloverleaf-spike <SPIKE_ID>.
     ```

     If `/cloverleaf-spike` exits non-zero or leaves the spike in a non-`completed` status after returning, treat that as bounce exhaustion: dump state to `.cloverleaf/runs/$RFC_ID/discover-crash.json` (including the spike ID) and halt. The orchestrator does NOT resume partially-run spike trees — if any spike is unresolved, the whole Discovery halts.

     After all spikes complete:

     1. Transition RFC spike-in-flight → drafting:
        ```
        cloverleaf-cli advance-rfc <repo_root> $RFC_ID drafting agent
        ```
     2. Re-invoke `/cloverleaf-draft-rfc $RFC_ID` — Researcher sees the completed spikes and may revise the RFC body. draft-rfc itself re-transitions the RFC to `spike-in-flight` (if new unknowns emerge — should not happen the second time since spikes were answered) or `planning` (expected path).

     Rationale: redundant redraft is cheap; avoids introducing an off-contract "rfc_revision_required" boolean. The human gate at step 6 catches any missed revisions.

6. **Gate: rfc_strategy_gate** — transition RFC to gate-pending:
   ```
   cloverleaf-cli advance-rfc <repo_root> $RFC_ID gate-pending agent rfc_strategy_gate
   ```

   Prompt human (blocking readline):
   ```
   RFC $RFC_ID at rfc_strategy_gate: approve / reject / revise [reason]? > _
   ```

   Parse input. On:
   - `approve` → invoke `/cloverleaf-gate $RFC_ID approve`. Continue to step 7.
   - `reject [reason]` → invoke `/cloverleaf-gate $RFC_ID reject [reason]`. Exit with summary.
   - `revise [reason]` → invoke `/cloverleaf-gate $RFC_ID revise [reason]`. `revise_loops += 1`. If `revise_loops >= MAX_REVISE_LOOPS`, dump state and halt. Else loop back to step 4.

7. **Plan breakdown** — invoke `/cloverleaf-breakdown $RFC_ID`. Per-invocation bounce budget (3 bounces inside breakdown). Capture `$PLAN_ID`. On bounce exhaustion: dump state and halt.

8. **Gate: task_batch_gate** — Plan is already in `gate-pending` (set by breakdown). Prompt:
   ```
   PLN $PLAN_ID at task_batch_gate: approve / reject [reason]? > _
   ```

   On:
   - `approve` → invoke `/cloverleaf-gate $PLAN_ID approve`. Continue.
   - `reject [reason]` → invoke `/cloverleaf-gate $PLAN_ID reject [reason]`. Exit with summary.

9. **Materialise tasks**:
   ```bash
   OUT=$(cloverleaf-cli materialise-tasks <repo_root> $PLAN_ID)
   TASK_IDS=$(echo "$OUT" | jq -r '.task_ids[]')
   ```

   On materialise-tasks failure (cycle detected, or AJV validation error):
   - The error message from `cloverleaf-cli` identifies the failing task.
   - `materialiseTasksFromPlan` is atomic: the cycle-check and AJV pre-validation run BEFORE any file write, so no task files were created.
   - The Plan remains in `approved` status (the gate was legitimately approved; the materialisation issue is with the Plan's own task DAG, not the gate decision).
   - Dump state to `.cloverleaf/runs/$PLAN_ID/materialise-crash.json` and halt.
   - Operator investigation typically leads to a new `/cloverleaf-breakdown` run to produce a corrected Plan (the rejected path is via the ORIGINAL gate, not a post-approval state correction).

10. **Compute DAG roots**:
    ```bash
    PLAN_JSON=$(cloverleaf-cli load-plan <repo_root> $PLAN_ID)

    # DAG roots = nodes whose id never appears as `to.id` in any edge.
    # v0.5 picks the FIRST root only; multi-root concurrent Delivery is v0.6.
    FIRST_ROOT=$(echo "$PLAN_JSON" | jq -r '
      (.task_dag.edges | map(.to.id)) as $targets
      | [.task_dag.nodes[] | select(.id as $n | ($targets | index($n)) | not) | .id][0]
    ')
    ```

    v0.5 simplified rule: pick the FIRST root only (first `nodes[]` entry whose `id` does not appear in any `edges[].to.id`). Defer multi-root walk to v0.6.

11. **Prompt to kick off first root** (blocking readline):
    ```
    N tasks materialised: $TASK_IDS.
    DAG roots: $FIRST_ROOT.
    Run first root via /cloverleaf-run now? [y/N] > _
    ```

    On `y` or `yes` (case-insensitive): invoke `/cloverleaf-run <FIRST_ROOT>`. On anything else: exit with summary.

12. **Exit summary**:
    - RFC ID + final status
    - Spike IDs + findings summary (if any)
    - Plan ID + task count
    - Materialised task IDs
    - Whether first root was invoked (and its outcome if so)

## Notes

- v0.5 prompts only for the FIRST DAG root. Multi-root concurrent Delivery is v0.6 scope.
- All bounces and revise loops halt cleanly with a state dump at `.cloverleaf/runs/<RFC_ID>/discover-crash.json`. No partial work is left in an inconsistent state — the gate_decision events and work-item status are always coherent.
- The readline prompts are compatible with the user's session-bridging tool for automated dogfooding.
- "Invoke `/cloverleaf-X`" means spawn the sub-skill via the Skill tool — do NOT re-enter `/cloverleaf-discover` recursively. Sub-skills run in-process (same session) and return control to this orchestrator.
