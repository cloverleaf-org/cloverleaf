# Conformance

The Cloverleaf Interoperability Standard defines three levels of conformance. Levels are role-based and strict supersets: an L2 implementer is also L1-conformant; an L3 implementer is also L2-conformant.

## Levels

### L1 — Producer

**Role:** emits valid Cloverleaf documents.

An L1 implementer produces JSON that validates against the core Work Item schemas. Use this level if you are writing an adapter that exports Cloverleaf documents from another system (e.g. a Jira exporter, a static-site generator, a CLI stub).

**Scope:**

- Schemas: `project`, `work-item`, `rfc`, `spike`, `plan`, `task`
- Validators: `id-pattern`
- Agent contracts: none
- State machines: none

### L2 — Exchange

**Role:** L1 plus participation in workflow events, DAGs, and feedback roundtrips.

An L2 implementer can not only produce documents but also consume and emit status-transition events, build and validate dependency DAGs, roundtrip feedback envelopes, and track relationships across projects. Use this level for an IDE plugin, a tracker integration, or a review tool.

**Scope (adds to L1):**

- Schemas: `feedback`, `problem`, `status-transition-event`, `status-transitions`, `dependency-dag`
- Validators: `cross-project-ref`, `dag-acyclic`, `plan-tasks-match-dag`, `relationship-mirror`, `status-by-type`, `status-transition-legality`
- State machines: all four (`rfc`, `spike`, `plan`, `task`)

### L3 — Host

**Role:** L2 plus driving the full methodology end-to-end.

An L3 implementer implements the agent contracts, handles gate decisions, and enforces path rules and risk classification. Use this level if you are building a full Cloverleaf orchestrator (e.g. a Claude Code integration, a SaaS runner).

**Scope (adds to L2):**

- Schemas: `gate-decision-event`, `extensions`, `path-rules`, `risk-classifier-rules`
- Validators: `gate-decision-validity`
- Agent contracts: all seven (`researcher`, `plan`, `implementer`, `documenter`, `reviewer`, `ui-reviewer`, `qa`)

## Running the conformance suite

From the `standard/` directory:

```bash
npm install
npm run validate:examples                # full suite (equivalent to --level=3)
npm run validate:examples -- --level=1   # L1 only
npm run validate:examples -- --level=2   # L1 + L2
npm run validate:examples -- --level=3   # L1 + L2 + L3 (same as default)
```

A successful run exits 0 with a line count of passing checks. A failing run prints each failure and exits nonzero.

## Declaring a level

To claim a level for your implementation:

1. Run the filtered suite (`npm run validate:examples -- --level=N`) against your fixtures.
2. Add your own test suite that exercises your implementation against the level's schemas, validators, and contracts.
3. Publish a conformance statement in your project's README citing the specific Cloverleaf Standard version and level — e.g. *"Implements Cloverleaf Standard 0.3.0 at L2."*

There is no central registry or badge program in v0.3. Self-declaration is the mechanism; the filtered conformance suite is the evidence.

## Adding a new schema, validator, contract, state machine, or scenario

Every artifact must be assigned to a level in `conformance/level-map.ts`. Unassigned artifacts fail the level-map coverage test and block CI.

When adding a new artifact:

1. Pick the correct level (see the Level partition in each section above).
2. Add it to the corresponding map in `conformance/level-map.ts` (`SCHEMA_LEVEL`, `VALIDATOR_LEVEL`, `CONTRACT_LEVEL`, `STATE_MACHINE_LEVEL`, or `SCENARIO_LEVELS`).
3. For a schema: create `examples/valid/<name>/` and `examples/invalid/<name>/` as usual, plus `.meta.json` sidecars per fixture with `{ "levels": ["L_N"], "fixture_of": "<name>.schema.json" }`.
4. Run `npm test` and `npm run validate:examples -- --level=N` to verify.

Level changes between versions follow SemVer: see `docs/versioning.md`.
