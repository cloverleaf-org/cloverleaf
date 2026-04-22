---
name: cloverleaf-discover
description: End-to-end Discovery orchestrator. Drives RFC → (Spikes) → Plan → gates → task materialisation. Blocks on human gate decisions (rfc_strategy_gate, task_batch_gate). On Plan approval, materialises tasks and asks whether to kick off /cloverleaf-run on the first DAG root. Usage — /cloverleaf-discover <brief-file>.
---

# Cloverleaf — discover (Discovery orchestrator)

The user has invoked this skill with a brief file path (e.g., `docs/briefs/cross-browser-ui-review.md`).

## Branch discipline

Each sub-skill runs from `main`. Between steps, confirm branch is `main` before proceeding. All sub-skills return the user to `main`.

## Per-agent bounce budget (in-session counters)

```
MAX_RESEARCHER_BOUNCES = 3
MAX_PLAN_BOUNCES       = 3
MAX_REVISE_LOOPS       = 3
```

These counters live in-session; `/cloverleaf-discover` rerun resets.

## Steps

1. Capture `<brief-file>` as `$BRIEF_FILE`. Verify file exists:
   ```bash
   [ -f "$BRIEF_FILE" ] || { echo "Brief file not found: $BRIEF_FILE" >&2; exit 1; }
   ```

2. Verify branch is `main`:
   ```bash
   [ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || { echo "Run /cloverleaf-discover from main" >&2; exit 1; }
   ```

3. **Create the RFC** — inline `/cloverleaf-new-rfc $BRIEF_FILE` steps. Capture the printed RFC ID as `$RFC_ID`.

4. **Draft RFC (Researcher draftRfc)** — begin revise loop:
   ```
   revise_loops = 0
   ```
   Loop:
   - Inline `/cloverleaf-draft-rfc $RFC_ID` steps. Researcher runs with per-invocation bounce budget MAX_RESEARCHER_BOUNCES.
   - On bounce exhaustion: dump state to `.cloverleaf/runs/$RFC_ID/discover-crash.json` and halt.
   - Reload the RFC. Its new status is either `spike-in-flight` (unknowns non-empty) or `planning` (unknowns empty).

5. **If RFC status is `spike-in-flight`** — run every pending spike linked to this RFC:
   ```bash
   for each spike in .cloverleaf/spikes/*.json where parent_rfc.id === $RFC_ID AND status === "pending":
     inline /cloverleaf-spike <SPIKE_ID> steps.
     On bounce exhaustion for any spike: dump state and halt.
   ```

   After all spikes complete, **always re-invoke `/cloverleaf-draft-rfc $RFC_ID`**. The Researcher sees the completed spikes and may revise the RFC body. Then transition RFC explicitly:
   ```
   cloverleaf-cli advance-rfc <repo_root> $RFC_ID drafting agent
   cloverleaf-cli advance-rfc <repo_root> $RFC_ID planning agent
   ```

   Rationale: redundant redraft is cheap; avoids introducing an off-contract "rfc_revision_required" boolean. The human gate at step 7 catches any missed revisions.

6. **(if RFC status is `planning`, skip step 5; proceed directly)**

7. **Gate: rfc_strategy_gate** — transition RFC to gate-pending:
   ```
   cloverleaf-cli advance-rfc <repo_root> $RFC_ID gate-pending agent rfc_strategy_gate
   ```

   Prompt human (blocking readline):
   ```
   RFC $RFC_ID at rfc_strategy_gate: approve / reject / revise [reason]? > _
   ```

   Parse input. On:
   - `approve` → inline `/cloverleaf-gate $RFC_ID approve` steps. Continue to step 8.
   - `reject [reason]` → inline `/cloverleaf-gate $RFC_ID reject [reason]` steps. Exit with summary.
   - `revise [reason]` → inline `/cloverleaf-gate $RFC_ID revise [reason]` steps. `revise_loops += 1`. If `revise_loops >= MAX_REVISE_LOOPS`, dump state and halt. Else loop back to step 4.

8. **Plan breakdown** — inline `/cloverleaf-breakdown $RFC_ID` steps. Per-invocation bounce budget MAX_PLAN_BOUNCES. Capture `$PLAN_ID`. On bounce exhaustion: dump state and halt.

9. **Gate: task_batch_gate** — Plan is already in `gate-pending` (set by breakdown). Prompt:
   ```
   PLN $PLAN_ID at task_batch_gate: approve / reject [reason]? > _
   ```

   On:
   - `approve` → inline `/cloverleaf-gate $PLAN_ID approve` steps. Continue.
   - `reject [reason]` → inline `/cloverleaf-gate $PLAN_ID reject [reason]` steps. Exit with summary.

10. **Materialise tasks**:
    ```bash
    OUT=$(cloverleaf-cli materialise-tasks <repo_root> $PLAN_ID)
    TASK_IDS=$(echo "$OUT" | jq -r '.task_ids[]')
    ```

    On materialise-tasks failure (cycle, AJV error): the CLI's error message names the failing task. Transition the Plan back by rejecting:
    ```
    cloverleaf-cli emit-gate-decision <repo_root> $PLAN_ID task_batch_gate reject system --comment="materialisation failed: <error>"
    cloverleaf-cli advance-plan <repo_root> $PLAN_ID rejected human task_batch_gate
    ```
    Halt.

11. **Compute DAG roots**:
    ```bash
    PLAN_JSON=$(cloverleaf-cli load-plan <repo_root> $PLAN_ID)
    # Roots: nodes[] entries not appearing as `to` in any edge.
    ROOTS=$(echo "$PLAN_JSON" | jq -r '
      .task_dag.nodes[] | .id as $nid
      | ($nid as $n | .task_dag.edges | map(.to.id) | index($n)) // $nid
    ' | ...)
    # Simpler: use set-difference via jq; or compute in-app.
    ```

    v0.5 simplified rule: pick the FIRST root only (first `nodes[]` entry whose `id` does not appear in any `edges[].to.id`). Defer multi-root walk to v0.6.

12. **Prompt to kick off first root** (blocking readline):
    ```
    N tasks materialised: $TASK_IDS.
    DAG roots: $ROOTS.
    Run first root via /cloverleaf-run now? [y/N] > _
    ```

    On `y` or `yes` (case-insensitive): inline `/cloverleaf-run <FIRST_ROOT>` steps. On anything else: exit with summary.

13. **Exit summary**:
    - RFC ID + final status
    - Spike IDs + findings summary (if any)
    - Plan ID + task count
    - Materialised task IDs
    - Whether first root was invoked (and its outcome if so)

## Notes

- v0.5 prompts only for the FIRST DAG root. Multi-root concurrent Delivery is v0.6 scope.
- All bounces and revise loops halt cleanly with a state dump at `.cloverleaf/runs/<RFC_ID>/discover-crash.json`. No partial work is left in an inconsistent state — the gate_decision events and work-item status are always coherent.
- The readline prompts are compatible with the user's session-bridging tool for automated dogfooding.
