---
name: cloverleaf-breakdown
description: Invoke the Plan agent (operation=breakdown) to decompose an approved RFC + completed spikes into a Plan with task_dag + inline tasks. Transitions Plan drafting → gate-pending (task_batch_gate). Usage — /cloverleaf-breakdown <RFC-ID>.
---

# Cloverleaf — Plan breakdown

The user has invoked this skill with an RFC-ID (e.g., `CLV-009`).

## Steps

1. Capture `<RFC-ID>` as `$RFC_ID`. If missing, report usage and stop.

2. Load and verify the RFC is in status `approved`:
   ```
   cloverleaf-cli load-rfc <repo_root> <RFC-ID>
   ```
   If `status !== "approved"`, report "RFC must be approved before breakdown" and stop.

3. Collect all completed Spikes for this RFC. For each `.cloverleaf/spikes/*.json`:
   - Parse the JSON.
   - If `parent_rfc.id === $RFC_ID` AND `parent_rfc.project === <rfc.project>` AND `status === "completed"`: include in the SPIKES array.
   - If zero matches, SPIKES is `[]`.

4. Load discovery config:
   ```bash
   CFG=$(cloverleaf-cli discovery-config --repo-root <repo_root>)
   DOC_CTX=$(echo "$CFG" | jq -r .docContextUri)
   PROJECT_ID=$(echo "$CFG" | jq -r .projectId)
   ```

5. Compute the next work-item ID (this is the Plan's ID):
   ```
   PLAN_ID=$(cloverleaf-cli next-work-item-id <repo_root> $PROJECT_ID)
   ```

6. Dispatch the Plan subagent via the Task tool:
   - `subagent_type`: `general-purpose`
   - `model`: `sonnet`
   - Prompt: contents of `$(cloverleaf-cli plugin-root)/prompts/plan.md`, with placeholders:
     - `{{rfc}}` → the full RFC JSON
     - `{{spikes}}` → the SPIKES JSON array
     - `{{doc_context_uri}}` → `$DOC_CTX`
     - `{{repo_root}}` → absolute path to the current repo
     - `{{path_rules}}` → `null` (v0.5 does not auto-populate path_rules; defer to v0.6)

   In the subagent context, also supply a hint that `next_id_base === $PLAN_ID`, so task IDs in `tasks[]` start at `PLAN_ID + 1`. The Plan agent allocates its own ID as `next_id_base` and task IDs sequentially after.

7. Parse subagent response — expected JSON conforming to `plan.schema.json`. Required fields: `id, type: "plan", status: "drafting", owner, project, parent_rfc, task_dag (edge-based), tasks (inline Task docs, status=pending)`. 3-bounce budget per invocation.

8. Ensure output `plan.id === $PLAN_ID`, `project === $PROJECT_ID`, `parent_rfc === { project: <rfc.project>, id: $RFC_ID }`. If the subagent drifted, override these before save.

9. Save the Plan:
   ```
   cloverleaf-cli save-plan <repo_root> /tmp/plan-$PLAN_ID.json
   ```

10. Transition drafting → gate-pending:
    ```
    cloverleaf-cli advance-plan <repo_root> $PLAN_ID gate-pending agent task_batch_gate
    ```

11. Commit:
    ```bash
    git add .cloverleaf/plans/ .cloverleaf/events/
    git commit -m "cloverleaf: plan $PLAN_ID for RFC $RFC_ID → gate-pending"
    ```

12. Print the Plan ID.

## Notes

- Tasks from `plan.tasks[]` are NOT yet materialised on disk. Materialisation happens only after a human approves via `/cloverleaf-gate $PLAN_ID approve`, which transitions the Plan to `approved`, at which point the orchestrator runs `cloverleaf-cli materialise-tasks`.
- If the RFC has no completed spikes (`unknowns[]` was empty), SPIKES is `[]` and the Plan agent works from the RFC alone.
