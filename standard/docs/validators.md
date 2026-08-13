# Cloverleaf Reference Validators

Runtime invariants that JSON Schema cannot express. Each validator is a pure function.

The TypeScript reference implementation lives under `standard/validators/`. This doc describes the algorithms in language-agnostic pseudocode so implementers in Rust, Go, Python, etc. can ship identical semantics.

All validators return a `ValidationResult`:

```
ValidationResult = Ok | Violations(Violation[])
Violation = { rule, message, path?, workItemId?, severity: "error" | "warning" }
```

---

## #1 — DAG acyclicity

**Purpose:** Ensure a Dependency DAG has no cycles.
**Input:** `DependencyDAG { nodes: WorkItemRef[], edges: {from,to}[] }`
**Returns:** `Ok` if acyclic; `Violations` listing each cycle.

**Algorithm (DFS with recursion stack):**
1. Build adjacency list keyed by `refKey(ref) = project + "::" + id`.
2. For each unvisited node, DFS with a recursion stack.
3. If a node is revisited while still on the stack, a cycle exists; slice the stack from that node to form the cycle path.
4. Aggregate all cycles into violations.

**Edge cases:**
- Self-loops (`A → A`) count as cycles.
- Disconnected subgraphs are processed independently.
- Nodes with no edges are trivially acyclic.

**Reference impl:** `validators/dag-acyclic.ts`

---

## #2 — Plan tasks match DAG

**Purpose:** The set of `plan.tasks[].id` (lifted to refs with the plan's project) must equal the set of `plan.task_dag.nodes`.
**Input:** `Plan`
**Returns:** Violations for every id in one set missing from the other.

**Algorithm:**
1. Build `taskKeys = { refKey({project: plan.project, id: t.id}) for t in plan.tasks }`.
2. Build `dagKeys = { refKey(n) for n in plan.task_dag.nodes }`.
3. For each key in `taskKeys \ dagKeys`, add violation "task id missing from DAG".
4. For each key in `dagKeys \ taskKeys`, add violation "DAG node missing from tasks".

**Edge cases:**
- Empty plans are handled by `minItems: 1` at the schema level.

**Reference impl:** `validators/plan-tasks-match-dag.ts`

---

## #3 — Status by type

**Purpose:** A Work Item's `status` must be in the allowed enum for its concrete type.
**Input:** `WorkItem`
**Returns:** Violation if status is not allowed, else Ok.

**Algorithm:**
1. Look up allowed statuses for `wi.type`:
   - `rfc`: drafting, spike-in-flight, planning, gate-pending, approved, rejected, abandoned
   - `spike`: pending, running, completed, abandoned
   - `plan`: drafting, gate-pending, approved, rejected
   - `task`: pending, tactical-plan, implementing, documenting, review, automated-gates, ui-review, qa, final-gate, merged, rejected, escalated
2. If `wi.status` not in allowed, violation.

**Reference impl:** `validators/status-by-type.ts`

---

## #4 — Relationship mirror consistency

**Purpose:** If A has `blocks` pointing at B, B must have `is_blocked_by` pointing at A (and analogously for each inverse pair).
**Input:** `WorkItem` + `registry: Map<refKey, WorkItem>` containing all known items
**Returns:** Violations for each unmirrored relationship.

**Algorithm:**
1. For each relationship `{type, target}` on `item`:
   a. Look up `target` in `registry`. If missing, skip (validator #6 will flag).
   b. Compute `inverse(type)` from the fixed mapping:
      - `blocks ↔ is_blocked_by`
      - `duplicates ↔ duplicate_of`
      - `supersedes ↔ superseded_by`
      - `split_from ↔ split_to`
      - `relates_to ↔ relates_to` (symmetric)
   c. Check target has a relationship with `{type: inverse, target: itemRef}`. If missing, violation.

**Edge cases:**
- `relates_to` is symmetric; the inverse IS itself.
- Missing registry entries are the concern of validator #6.

**Reference impl:** `validators/relationship-mirror.ts`

---

## #5 — ID pattern

**Purpose:** A Work Item's `id` must match its project's `id_pattern`.
**Input:** `WorkItem`, `Project`
**Returns:** Violation if mismatch.

**Algorithm:**
1. If `wi.project != project.key`, violation (wrong project supplied).
2. Compute pattern: `project.id_pattern` if set, else default `^{escaped(project.key)}-\d+$`.
3. Test `wi.id` against the compiled regex. If no match, violation.

**Reference impl:** `validators/id-pattern.ts`

---

## #6 — Cross-project reference resolution

**Purpose:** Every `workItemRef.project` must appear in the loaded project registry.
**Input:** `WorkItemRef`, `Project[]`
**Returns:** Violation if `ref.project` not in registry.

**Algorithm:**
1. Build `known = { p.key for p in projects }`.
2. If `ref.project` not in `known`, violation.

**Reference impl:** `validators/cross-project-ref.ts`

---

## #7 — Gate decision validity

**Purpose:** Only certain decisions are valid for each gate type.
**Input:** `GateDecisionEvent`
**Returns:** Violation if `(gate, decision)` pair is not allowed.

**Allowed matrix:**

| Gate | Allowed decisions |
|---|---|
| `rfc_strategy_gate` | approve, reject, revise, abandon |
| `task_batch_gate` | approve, reject, revise, split |
| `per_task_plan_review` | approve, reject |
| `final_approval_gate` | approve, reject, escalate |

**Reference impl:** `validators/gate-decision-validity.ts`

---

## #8 — Status transition legality

**Purpose:** A status transition event is legal iff the state machine for the Work Item type contains a matching transition and the actor kind is allowed.
**Input:** `StatusTransitionEvent`, `StatusTransitions` (the state machine for `event.work_item_type`), optional `Task`
**Returns:** Violation if no matching transition.

**Algorithm:**
1. If `event.work_item_type != stateMachine.type`, violation.
2. Find transition `t` in `stateMachine.transitions` where:
   - `t.from == event.from_status`
   - `t.to == event.to_status`
   - If `t.allowed_actors` set, `event.actor.kind in t.allowed_actors`
3. If no matching transition, violation.

**Edge cases:**
- The optional `Task` is accepted for signature symmetry with the security-gate validator and is not read by this rule; pass it or omit it.
- `any → escalated` transitions are universal (listed per-state in the machine).

**Reference impl:** `validators/status-transition-legality.ts`

---

## #9 — Security gate

**Purpose:** When a state-machine transition is annotated `security_gate: true` and the task has `security_class === "high"`, the transition is only legal if `security_review_verdict === "pass"`.
**Input:** `StatusTransitionEvent`, `StatusTransitions`, optional `Task`
**Returns:** `Ok` if the gate does not apply or is satisfied; `Violations` if a high-security task attempts a guarded transition without a passing verdict.

**Algorithm:**
1. If `workItem` is absent or `workItem.type !== "task"`, return Ok (non-task items are not subject to the security gate).
2. Locate the transition `t` in `stateMachine.transitions` where `t.from == event.from_status` and `t.to == event.to_status`. If not found or `t.security_gate !== true`, return Ok.
3. If `workItem.security_class !== "high"`, return Ok (rule only applies to high-security tasks).
4. If `workItem.security_review_verdict === "pass"`, return Ok.
5. Otherwise, return Violations with rule `"security-gate"`, severity `"error"`, and a message naming the blocked transition and the current verdict.

**Edge cases:**
- Tasks with `security_class` absent or `"low"` are always Ok regardless of verdict.
- A verdict of `null`, `"bounce"`, or `"escalate"` all fail the gate; only `"pass"` satisfies it.

**Guarded transitions:** none in the shipped machines. The collapsed task FSM annotates no transition with `security_gate` (0.8.0 moved that guarantee to a blocking security council member plus a recorded-verdict backstop). This validator is retained as a general primitive for consumer state machines that do annotate one; `schemas/status-transitions.schema.json` declares the optional `security_gate` property so such a machine validates, and `examples/valid/status-transitions/security-gate.json` is a worked example.

**Reference impl:** `validators/security-gate.ts`
