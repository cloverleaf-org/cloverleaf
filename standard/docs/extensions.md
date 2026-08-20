# Extensions Guide

Teams need to layer their own metadata onto Cloverleaf documents (priority, sprint, labels, custom workflow data) without breaking the contract that AI agents rely on. The `extensions` field exists for this.

## Rules

1. **All extensions live under the `extensions` field** of a schema that declares one. Which schemas those are, and why, is set out under [Where the hatch is available](#where-the-hatch-is-available).
2. **Keys are namespaced** as `team.field` (e.g., `acme.priority`). Keys without a dot are forbidden — they would collide with potential future mandatory fields.
3. **Agents ignore unknown extension keys.** Conformant agents must not error when they encounter an extension they don't recognize. This is what makes extensions forward-compatible.
4. **Extensions cannot override mandatory fields.** Don't redefine `definition_of_done` under `extensions.acme.dod` — use the mandatory field.

## Where the hatch is available

Not every schema accepts extensions, and the split is deliberate rather than incidental.

**Descriptive documents are extensible. Behavioural configuration is closed, so that a typo fails loudly.** A document describes something a team is doing, and no two teams describe it identically — so those schemas carry the hatch. A configuration file is *read by the engine*, and there `additionalProperties: false` is what turns a misspelled `counsil_profiles` into an error instead of a silently ignored key. Closing those files is a feature, not an oversight: the failure mode a hatch would introduce is a profile that never applies and never explains why.

Protocol messages and generated artifacts are closed for the same reason — a consumer that invents a field on a `feedback` envelope or a `council-result` is expressing something no other implementation will read.

### Schemas that carry the hatch

- `work-item` — the abstract parent of the trackable units below.
- `rfc` — a Discovery proposal.
- `spike` — a Discovery research task.
- `plan` — the finalized RFC, Task DAG and Tasks.
- `task` — a Delivery work unit.
- `project` — per-project descriptive metadata (`key`, `name`, `description`, `id_pattern`). **Not a Work Item**, and the reason this list exists: `project.json` is the file a team is most likely to annotate, and its hatch is correct.

### Schemas that are deliberately closed

**Behavioural configuration** — read by the engine, where an unrecognised key must fail rather than be ignored:

- `council-config` — review-council profiles and per-gate bindings.
- `path-rules` — path-glob → reviewer-role mappings.
- `risk-classifier-rules` — tunable rules for the deterministic Risk Classifier.

**Protocol messages** — exchanged between agents, where an invented field is one nothing else reads:

- `feedback` — the structured feedback envelope.
- `gate-decision-event` — emitted when a gate renders a decision.
- `status-transition-event` — emitted when a Work Item changes status.

**Generated or structural artifacts** — written by Cloverleaf, or describing the Standard itself:

- `council-result` — the council audit artifact.
- `dependency-dag` — the Task dependency graph emitted by breakdown.
- `status-transitions` — the declaration of legal transitions for a Work Item type.
- `extensions` — this mechanism's own meta-schema.

### Two schemas that accept arbitrary properties for other reasons

`problem` and `work-item` set `additionalProperties: true`, which is not the same thing as carrying the hatch:

- `problem` is RFC 7807, whose §3.2 *mandates* prefixed extension members. It already ships `cloverleaf.failure_class` and `cloverleaf.work_item_id`.
- `work-item` is the abstract parent of RFC, Spike, Plan and Task. Closing it would reject its own children, each of which adds fields of its own.

Neither is an invitation to add unnamespaced fields to a Work Item; rule 2 still applies.

## Project-defined linting

Each project may emit its own JSON Schema for the contents of its extension keys. Example:

```json
{
  "$id": "https://acme.com/cloverleaf-extensions.schema.json",
  "type": "object",
  "properties": {
    "acme.priority": { "type": "string", "enum": ["P0", "P1", "P2", "P3"] },
    "acme.sprint": { "type": "string", "pattern": "^\\d{4}-Q[1-4]-S\\d{2}$" }
  }
}
```

The Standard does not validate extension contents; that's a project concern.
