---
name: cloverleaf-draft-rfc
description: Invoke the Researcher agent (operation=draftRfc) to populate an RFC body from its brief. Emits zero or more Spike work items from the RFC's unknowns[]. Transitions the RFC drafting → spike-in-flight (if unknowns exist) or drafting → planning (if no unknowns). Usage — /cloverleaf-draft-rfc <RFC-ID>.
---

# Cloverleaf — draft RFC

The user has invoked this skill with an RFC-ID (e.g., `CLV-009`).

## Steps

1. Capture `<RFC-ID>` as `$RFC_ID`. If missing, report usage and stop.

2. Load the RFC:
   ```
   cloverleaf-cli load-rfc <repo_root> <RFC-ID>
   ```
   Parse the JSON. Verify `status === "drafting"`. If not, report and stop.

3. Load the discovery config:
   ```bash
   CFG=$(cloverleaf-cli discovery-config --repo-root <repo_root>)
   DOC_CTX=$(echo "$CFG" | jq -r .docContextUri)
   ```

4. Gather re-draft context (optional — used when re-invoked after spikes):
   - `PRIOR_RFC`: the current RFC JSON (for a re-draft, same content)
   - `COMPLETED_SPIKES`: for each spike ref linked to this RFC (via spike's `parent_rfc` field), if `status === "completed"`, include its findings/recommendation. Build a JSON array. If none, use `[]`.

   Find all spikes for this RFC by scanning `.cloverleaf/spikes/*.json` for files whose `parent_rfc.id === $RFC_ID`. Use jq. If none, the array is empty.

5. Dispatch the Researcher subagent via the Task tool:
   - `subagent_type`: `general-purpose`
   - `model`: `sonnet`
   - Prompt: contents of `$(cloverleaf-cli plugin-root)/prompts/researcher.md`, with placeholders substituted:
     - `{{operation}}` → `draftRfc`
     - `{{brief}}` → the RFC's `problem` field (seeded by `/cloverleaf-new-rfc`)
     - `{{doc_context_uri}}` → `$DOC_CTX`
     - `{{repo_root}}` → absolute path to the current repo
     - `{{prior_rfc}}` → `PRIOR_RFC` JSON (or the literal string `null` for first draft)
     - `{{completed_spikes}}` → `COMPLETED_SPIKES` JSON array (or `[]`)
     - `{{spike}}` → (unused for draftRfc; substitute `null`)

6. Parse subagent's response: expected JSON conforming to `rfc.schema.json`. Required fields: `id`, `type: "rfc"`, `status: "drafting"`, `owner`, `project`, `title`, `problem`, `solution`, `unknowns` (array of strings), `acceptance_criteria`, `out_of_scope`.

   If output fails schema validation: bounce. Budget: 3 bounces per invocation. On budget exhaustion: report and stop without advancing state.

7. Ensure output `id === $RFC_ID` and `project === <original>`. If the subagent changed them, override back.

8. Save the populated RFC:
   ```bash
   cloverleaf-cli save-rfc <repo_root> /tmp/rfc-draft-$RFC_ID.json
   ```

9. Inspect `rfc.unknowns[]`:

   **If `unknowns.length > 0`:** create one Spike per unknown:
   ```bash
   for unknown in rfc.unknowns:
     SPIKE_ID=$(cloverleaf-cli next-work-item-id <repo_root> <project>)
     cat > /tmp/spike-$SPIKE_ID.json <<EOF
     {
       "type": "spike",
       "project": "<project>",
       "id": "$SPIKE_ID",
       "status": "pending",
       "owner": { "kind": "agent", "id": "researcher" },
       "title": "<first 80 chars of unknown>",
       "parent_rfc": { "project": "<project>", "id": "$RFC_ID" },
       "question": "<unknown>",
       "method": "research"
     }
     EOF
     cloverleaf-cli save-spike <repo_root> /tmp/spike-$SPIKE_ID.json
   ```

   Then transition RFC:
   ```
   cloverleaf-cli advance-rfc <repo_root> <RFC-ID> spike-in-flight agent
   ```

   **If `unknowns.length === 0`:** transition RFC directly to planning:
   ```
   cloverleaf-cli advance-rfc <repo_root> <RFC-ID> planning agent
   ```

10. Clean up temp files. Commit state files under `.cloverleaf/`:
    ```bash
    git add .cloverleaf/rfcs/ .cloverleaf/spikes/ .cloverleaf/events/
    git commit -m "cloverleaf: draft RFC $RFC_ID + spike emission"
    ```

11. Report: RFC body populated; N spikes created (list IDs); RFC status now `spike-in-flight` or `planning`.

## Notes

- This skill does NOT prompt for human input. It's a pure agent step.
- The orchestrator (`/cloverleaf-discover`) invokes this plus manages bounces and gates.
- For a re-draft after spikes complete, invoke this skill again with the same RFC-ID — it will pick up completed spikes and may revise the RFC body.
