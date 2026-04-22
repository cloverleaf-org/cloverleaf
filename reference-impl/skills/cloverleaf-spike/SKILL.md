---
name: cloverleaf-spike
description: Run a single Spike via the Researcher agent (operation=runSpike). Advances pending → running → completed with findings + recommendation. Usage — /cloverleaf-spike <SPIKE-ID>.
---

# Cloverleaf — run Spike

The user has invoked this skill with a SPIKE-ID (e.g., `CLV-010`).

## Steps

1. Capture `<SPIKE-ID>` as `$SPIKE_ID`. If missing, report usage and stop.

2. Load the spike:
   ```
   cloverleaf-cli load-spike <repo_root> <SPIKE-ID>
   ```
   Verify `status === "pending"`. If not, report and stop.

3. Transition pending → running:
   ```
   cloverleaf-cli advance-spike <repo_root> <SPIKE-ID> running agent
   ```

4. Load discovery config:
   ```bash
   DOC_CTX=$(cloverleaf-cli discovery-config --repo-root <repo_root> | jq -r .docContextUri)
   ```

5. Dispatch the Researcher subagent via the Task tool:
   - `subagent_type`: `general-purpose`
   - `model`: `sonnet`
   - Prompt: contents of `$(cloverleaf-cli plugin-root)/prompts/researcher.md`, with placeholders:
     - `{{operation}}` → `runSpike`
     - `{{spike}}` → the full spike JSON (from step 2, with status now `running`)
     - `{{doc_context_uri}}` → `$DOC_CTX`
     - `{{repo_root}}` → absolute path to the current repo
     - `{{brief}}` → `null` (unused for runSpike)
     - `{{prior_rfc}}`, `{{completed_spikes}}` → `null`

6. Parse subagent response. Expected: the spike JSON with `status: "completed"`, `findings: string`, `recommendation: string`. Schema: `spike.schema.json` (validated by save-spike).

   If output fails schema validation: bounce. Budget: 3 bounces. On exhaustion: report and stop without advancing to completed.

7. Save the completed spike:
   ```
   cloverleaf-cli save-spike <repo_root> /tmp/spike-$SPIKE_ID.json
   ```

8. Transition running → completed:
   ```
   cloverleaf-cli advance-spike <repo_root> <SPIKE-ID> completed agent
   ```

9. Commit:
   ```bash
   git add .cloverleaf/spikes/ .cloverleaf/events/
   git commit -m "cloverleaf: spike $SPIKE_ID completed"
   ```

10. Report: spike findings summary.

## Notes

- Orchestrator (`/cloverleaf-discover`) loops this for every spike in the RFC's `unknowns[]` (materialised as Spike work items by `/cloverleaf-draft-rfc`) before re-drafting the RFC.
- If `method === "prototype"` or `method === "benchmark"`: the Researcher agent describes what to prototype/benchmark, not implement it. v0.5 does not build prototypes — that's Delivery's job.
