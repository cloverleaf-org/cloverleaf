#!/usr/bin/env bash
#
# v0.6 walker acceptance harness.
#
# Exercises the walker's data plane (lib/dag-walker.ts, lib/walk-state.ts, and
# the four `cloverleaf-cli` subcommands shipped in v0.6.0) against a synthetic
# 3-peer Plan. The walker SKILL.md itself is a markdown body that runs inside
# Session A's Claude when /cloverleaf-run-plan is invoked — that orchestration
# loop is exercised separately by the manual dogfood.
#
# Default scenario validates:
#
#   1. Cycle detection on a clean Plan exits 0 silently.
#   2. dag-ready-tasks returns all peers when nothing has run yet.
#   3. dag-ready-tasks respects the maxConcurrent cap.
#   4. Walk-state write + read round-trips faithfully.
#   5. dag-ready-tasks subtracts running sessions from the slot count.
#   6. dag-ready-tasks returns nothing when every task is merged.
#   7. Cycle detection catches a hand-crafted 2-cycle.
#
# Named scenarios (pass as first argument):
#
#   flow2-dogfood-repro  — Reproduces the Flow 2 (Under-classification at the door)
#                          sequence from the CLV-107 dogfood in the collapsed FSM.
#                          A low-declared task whose diff touches a sensitive path gets
#                          its security_class upgraded at documenting→council; the
#                          delivery council runs with a blocking security member; a
#                          security bounce returns the task to implementing.
#
#   council-optin        — Exercises the opt-in council end-to-end against a real temp
#                          repo with a consumer .cloverleaf/config/council.json. Asserts
#                          council-plan reports source=consumer, apply-council-verdict
#                          drives a council task to final-gate, and the council result
#                          artifact is written.
#
#   non-ts-consumer      — Builds a synthetic non-monorepo consumer (no standard/ or
#                          reference-impl/ subdirs) and asserts prep-worktree runs in
#                          consumer mode: no throw, worktree_setup_command ran, and
#                          prep_copy_dirs were copied. Validates F2.
#
#   council-collapse     — Slice-4 collapsed council FSM end-to-end. Asserts the shipped
#                          two-lane default (low→delivery-fast reviewer-only,
#                          high→delivery-full with a blocking security member); a council
#                          pass advances council→final-gate (fast lane unified); a security
#                          bounce returns to implementing (the v0.8.1 guarantee); and
#                          validate-council enforces kind-homogeneity.
#
# Run via `npm run acceptance:walker` from the reference-impl/ directory or
# directly: `bash scripts/acceptance-walker.sh [scenario]`.
set -euo pipefail

# ---------------------------------------------------------------------------
# scenario: flow2-dogfood-repro
#
# Description
# -----------
# Reproduces the "Under-classification at the door" scenario in the Slice-4
# collapsed FSM. A task declared as security_class="low" has a diff that touches
# a sensitive path (scripts/deploy.sh). The collapsed FSM's security guarantee
# is: advance-status documenting→council classifies the diff, detects the
# sensitive path, writes back security_class="high", and the delivery council
# (council-plan) then runs with a blocking security member. A security-member
# bounce returns the task to implementing (the v0.8.1 guarantee preserved through
# the collapse).
#
# What it demonstrates (collapsed FSM)
# -------------------------------------
#   1. advance-status documenting→council upgrades security_class to "high"
#      when the diff touches a sensitive path (classify-security writeback).
#   2. council-plan for the upgraded task selects delivery-full and includes
#      a blocking security member.
#   3. apply-council-verdict with a security bounce returns task to implementing.
#   4. apply-council-verdict with a security pass advances task to final-gate.
#
# Assertions (all must pass for exit 0)
# --------------------------------------
#   A1. advance-status documenting→council exits 0 (reclassification is
#       transparent to the caller in the collapsed FSM).
#   A2. Task security_class is "high" after the documenting→council transition.
#   A3. council-plan selects delivery-full for the high task.
#   A4. council-plan includes a blocking security member.
#   A5. apply-council-verdict (security bounce) returns task to implementing.
#   A6. A second task with pass verdict reaches final-gate.
# ---------------------------------------------------------------------------
run_council_optin() {
  echo "=== Scenario: council-optin ==="
  REPO="$(mktemp -d -t cloverleaf-council-optin.XXXXXX)"
  # shellcheck disable=SC2064
  trap "rm -rf '$REPO'" EXIT
  mkdir -p "$REPO/.cloverleaf/tasks" "$REPO/.cloverleaf/events" "$REPO/.cloverleaf/config"

  cat > "$REPO/.cloverleaf/tasks/DEMO-001.json" <<'JSON'
{ "id": "DEMO-001", "type": "task", "status": "council", "project": "DEMO", "title": "t",
  "owner": { "kind": "agent", "id": "unassigned" }, "context": { "rfc": { "project": "DEMO", "id": "DEMO-RFC-001" } },
  "acceptance_criteria": ["a"], "definition_of_done": ["d"], "risk_class": "high" }
JSON

  cat > "$REPO/.cloverleaf/config/council.json" <<'JSON'
{ "profiles": { "lean": { "rounds": [[{ "member": "reviewer" }, { "member": "qa" }]], "aggregation": "any-veto" } },
  "gates": { "task.review": "lean" } }
JSON

  COUNCIL_PLAN_OUT="$(cloverleaf-cli council-plan "$REPO" DEMO-001 task.review --changed-files=)"
  SRC="$(python3 -c "import json,sys; d=json.loads('$COUNCIL_PLAN_OUT'.strip()); print(d.get('source',''))" 2>/dev/null || \
    node -e "const d=JSON.parse(process.env.COUNCIL_PLAN_OUT||'{}'); process.stdout.write(d.source||'')" <<< "" )"
  [ "$SRC" = "consumer" ] || { echo "FAIL: expected source=consumer, got '$SRC'"; exit 1; }
  echo "✓ council-plan reports source=consumer"

  VERDICT='{"verdict":"pass","rule":"any-veto","rationale":"ok","members":[{"member":"reviewer","verdict":"pass"},{"member":"qa","verdict":"pass"}]}'
  cloverleaf-cli apply-council-verdict "$REPO" DEMO-001 task.review "$VERDICT" > /dev/null

  STATUS="$(python3 -c "import json,sys; d=json.load(open('$REPO/.cloverleaf/tasks/DEMO-001.json')); print(d.get('status',''))" 2>/dev/null || \
    node -e "const d=require('$REPO/.cloverleaf/tasks/DEMO-001.json'); process.stdout.write(d.status||'')")"
  [ "$STATUS" = "final-gate" ] || { echo "FAIL: expected final-gate, got '$STATUS'"; exit 1; }
  echo "✓ apply-council-verdict advanced task to final-gate"

  [ -f "$REPO/.cloverleaf/runs/DEMO-001/council/task.review.json" ] || { echo "FAIL: council result artifact missing"; exit 1; }
  echo "✓ council result artifact exists"

  echo "=== council-optin: all assertions passed ==="
}

# ---------------------------------------------------------------------------
# Scenario: council-chair — chair aggregation + a custom reviewer role (Slice 2).
#   Asserts: council-plan reports source=consumer + aggregation=chair + a chair
#   promptPath; a custom member resolves a promptPath under .cloverleaf/prompts;
#   chair-verdict normalizes a canned chair output to rule=chair; and
#   apply-council-verdict walks a chair bounce to implementing with forward recorded.
# ---------------------------------------------------------------------------
run_council_chair() {
  echo "=== Scenario: council-chair ==="
  local REPO PLAN RAW MEMBERS VERDICT STATUS FWD
  REPO="$(mktemp -d -t cloverleaf-council-chair.XXXXXX)"
  # shellcheck disable=SC2064
  trap "rm -rf '$REPO'" EXIT
  mkdir -p "$REPO/.cloverleaf/tasks" "$REPO/.cloverleaf/events" "$REPO/.cloverleaf/config" "$REPO/.cloverleaf/prompts"

  cat > "$REPO/.cloverleaf/tasks/DEMO-001.json" <<'JSON'
{ "id": "DEMO-001", "type": "task", "status": "council", "project": "DEMO", "title": "t",
  "owner": { "kind": "agent", "id": "unassigned" }, "context": { "rfc": { "project": "DEMO", "id": "DEMO-RFC-001" } },
  "acceptance_criteria": ["a"], "definition_of_done": ["d"], "risk_class": "high" }
JSON

  echo "# perf reviewer" > "$REPO/.cloverleaf/prompts/perf-reviewer.md"

  cat > "$REPO/.cloverleaf/config/council.json" <<'JSON'
{ "profiles": { "chaired": { "rounds": [[{ "member": "reviewer" }, { "member": "qa" },
      { "member": "perf", "prompt": "perf-reviewer.md" }]], "aggregation": "chair" } },
  "gates": { "task.review": "chaired" } }
JSON

  PLAN="$(cloverleaf-cli council-plan "$REPO" DEMO-001 task.review --changed-files=)"
  echo "$PLAN" | node -e '
    const p = JSON.parse(require("fs").readFileSync(0, "utf-8"));
    if (p.source !== "consumer") { console.error("FAIL: source", p.source); process.exit(1); }
    if (p.aggregation !== "chair") { console.error("FAIL: aggregation", p.aggregation); process.exit(1); }
    if (!p.chair || !p.chair.promptPath.endsWith("/prompts/chair.md")) { console.error("FAIL: chair.promptPath", p.chair); process.exit(1); }
    const perf = p.rounds.flat().find(m => m.member === "perf");
    if (!perf || !perf.promptPath.endsWith("/.cloverleaf/prompts/perf-reviewer.md")) { console.error("FAIL: custom promptPath", perf); process.exit(1); }
  ' || exit 1
  echo "✓ council-plan: source=consumer, aggregation=chair, custom-role + chair promptPaths resolved"

  RAW='{"verdict":"bounce","rationale":"address the perf finding","forward":["perf"]}'
  MEMBERS='[{"member":"reviewer","verdict":"pass"},{"member":"qa","verdict":"pass"},{"member":"perf","verdict":"bounce"}]'
  VERDICT="$(cloverleaf-cli chair-verdict "$RAW" "$MEMBERS")"
  echo "$VERDICT" | node -e '
    const v = JSON.parse(require("fs").readFileSync(0, "utf-8"));
    if (v.rule !== "chair") { console.error("FAIL: rule", v.rule); process.exit(1); }
    if (JSON.stringify(v.forward) !== JSON.stringify(["perf"])) { console.error("FAIL: forward", v.forward); process.exit(1); }
  ' || exit 1
  echo "✓ chair-verdict normalized the chair output to rule=chair with forward=[perf]"

  cloverleaf-cli apply-council-verdict "$REPO" DEMO-001 task.review "$VERDICT" > /dev/null \
    || { echo "FAIL: apply-council-verdict exited nonzero"; exit 1; }
  STATUS="$(node -e "process.stdout.write(require('$REPO/.cloverleaf/tasks/DEMO-001.json').status||'')")"
  [ "$STATUS" = "implementing" ] || { echo "FAIL: expected implementing, got '$STATUS'"; exit 1; }
  FWD="$(node -e "process.stdout.write(JSON.stringify(require('$REPO/.cloverleaf/runs/DEMO-001/council/task.review.json').forward||null))")"
  [ "$FWD" = '["perf"]' ] || { echo "FAIL: artifact forward, got '$FWD'"; exit 1; }
  echo "✓ apply-council-verdict: chair bounce → implementing, forward=[perf] recorded in the artifact"

  echo "=== council-chair: all assertions passed ==="
}

# ---------------------------------------------------------------------------
# Scenario: council-advisory — advisory final_gate + parallel round (Slice 3).
#   Asserts: council-plan task.final_gate reports source=consumer, mode=advisory,
#   and a multi-member (parallel) round; apply-council-verdict task.final_gate
#   POSTS an advisory artifact and drives NO transition (task stays final-gate);
#   and plan_review bounce is DECISIVE: transitions tactical-plan → pending.
# ---------------------------------------------------------------------------
run_council_advisory() {
  echo "=== Scenario: council-advisory ==="
  local REPO PLAN VERDICT STATUS MODE
  REPO="$(mktemp -d -t cloverleaf-council-advisory.XXXXXX)"
  # shellcheck disable=SC2064
  trap "rm -rf '$REPO'" EXIT
  mkdir -p "$REPO/.cloverleaf/tasks" "$REPO/.cloverleaf/events" "$REPO/.cloverleaf/config"

  cat > "$REPO/.cloverleaf/tasks/DEMO-001.json" <<'JSON'
{ "id": "DEMO-001", "type": "task", "status": "final-gate", "project": "DEMO", "title": "t",
  "owner": { "kind": "agent", "id": "unassigned" }, "context": { "rfc": { "project": "DEMO", "id": "DEMO-RFC-001" } },
  "acceptance_criteria": ["a"], "definition_of_done": ["d"], "risk_class": "high" }
JSON

  cat > "$REPO/.cloverleaf/config/council.json" <<'JSON'
{ "profiles": { "fg": { "rounds": [[{ "member": "reviewer" }, { "member": "qa" }]], "aggregation": "any-veto" } },
  "gates": { "task.final_gate": { "profile": "fg", "mode": "advisory" } } }
JSON

  PLAN="$(cloverleaf-cli council-plan "$REPO" DEMO-001 task.final_gate --changed-files=)"
  echo "$PLAN" | node -e '
    const p = JSON.parse(require("fs").readFileSync(0, "utf-8"));
    if (p.source !== "consumer") { console.error("FAIL: source", p.source); process.exit(1); }
    if (p.mode !== "advisory") { console.error("FAIL: mode", p.mode); process.exit(1); }
    if (p.rounds.flat().length < 2) { console.error("FAIL: expected a parallel (>=2) round", p.rounds); process.exit(1); }
  ' || exit 1
  echo "✓ council-plan task.final_gate: source=consumer, mode=advisory, parallel round"

  VERDICT='{"verdict":"pass","rule":"any-veto","rationale":"looks good","members":[{"member":"reviewer","verdict":"pass"},{"member":"qa","verdict":"pass"}]}'
  cloverleaf-cli apply-council-verdict "$REPO" DEMO-001 task.final_gate "$VERDICT" > /dev/null \
    || { echo "FAIL: apply-council-verdict task.final_gate exited nonzero"; exit 1; }
  STATUS="$(node -e "process.stdout.write(require('$REPO/.cloverleaf/tasks/DEMO-001.json').status||'')")"
  [ "$STATUS" = "final-gate" ] || { echo "FAIL: expected task to STAY at final-gate, got '$STATUS'"; exit 1; }
  MODE="$(node -e "process.stdout.write(require('$REPO/.cloverleaf/runs/DEMO-001/council/task.final_gate.json').mode||'')")"
  [ "$MODE" = "advisory" ] || { echo "FAIL: artifact mode, got '$MODE'"; exit 1; }
  echo "✓ apply-council-verdict task.final_gate: posted advisory artifact, no transition"

  # plan_review bounce is decisive: transitions tactical-plan → pending
  node -e "const f='$REPO/.cloverleaf/tasks/DEMO-001.json'; const t=require(f); t.status='tactical-plan'; require('fs').writeFileSync(f, JSON.stringify(t));"
  cloverleaf-cli apply-council-verdict "$REPO" DEMO-001 task.plan_review \
    '{"verdict":"bounce","rule":"any-veto","rationale":"reshape the plan","members":[{"member":"reviewer","verdict":"bounce"}]}' > /dev/null \
    || { echo "FAIL: apply-council-verdict task.plan_review exited nonzero"; exit 1; }
  STATUS="$(node -e "process.stdout.write(require('$REPO/.cloverleaf/tasks/DEMO-001.json').status||'')")"
  [ "$STATUS" = "pending" ] || { echo "FAIL: plan_review bounce should transition to pending, got '$STATUS'"; exit 1; }
  echo "✓ apply-council-verdict task.plan_review: decisive bounce → pending (tactical-plan → pending)"

  echo "=== council-advisory: all assertions passed ==="
}


run_flow2_dogfood_repro() {
  echo "=== Scenario: flow2-dogfood-repro ==="
  echo "Reproducing Flow 2 (Under-classification at the door) in the collapsed FSM."
  echo

  # ---- Setup: create a minimal git repo ----
  local REPO STATUS SECURITY_CLASS PLAN_OUT BOUNCE_EXIT PASS_EXIT
  REPO="$(mktemp -d -t cloverleaf-flow2-repro.XXXXXX)"
  # Expand REPO now so the trap string carries the literal path, not the
  # variable name (local variables are not in scope when EXIT fires).
  # shellcheck disable=SC2064
  trap "rm -rf '$REPO'" EXIT

  # Initialise git so advance-status can run git diff against a real branch.
  # Use -b main explicitly so the default branch is 'main' regardless of the
  # system's init.defaultBranch config (some systems default to 'master').
  git -C "$REPO" init -q -b main 2>/dev/null || {
    # Older git versions (<2.28) don't support -b; rename after init.
    git -C "$REPO" init -q
    git -C "$REPO" symbolic-ref HEAD refs/heads/main
  }
  git -C "$REPO" config user.email "acceptance@cloverleaf.test"
  git -C "$REPO" config user.name "Acceptance Test"

  # Create the .cloverleaf structure.
  mkdir -p "$REPO/.cloverleaf/projects" "$REPO/.cloverleaf/tasks"
  mkdir -p "$REPO/.cloverleaf/events" "$REPO/.cloverleaf/feedback"
  printf '{"key":"DEMO","name":"Demo Project"}' > "$REPO/.cloverleaf/projects/DEMO.json"

  # Seed task: low-classified at documenting (collapsed FSM: documenting → council
  # is where the security classification writeback now happens).
  cat > "$REPO/.cloverleaf/tasks/DEMO-001.json" <<'TASKEOF'
{
  "id": "DEMO-001",
  "type": "task",
  "status": "documenting",
  "owner": {"kind": "agent", "id": "unassigned"},
  "project": "DEMO",
  "title": "Dogfood reproduction task",
  "context": {"rfc": {"project": "DEMO", "id": "DEMO-RFC-001"}},
  "acceptance_criteria": ["Flow 2 recovery succeeds"],
  "definition_of_done": ["Task reaches final-gate"],
  "risk_class": "high",
  "security_class": "low",
  "security_review_verdict": null
}
TASKEOF

  # Commit the initial state on main.
  git -C "$REPO" add -A
  git -C "$REPO" commit -q -m "chore: initial repo state"

  # Create the feature branch with a sensitive file in its diff.
  # scripts/deploy.sh matches "**/deploy*.sh" in config/security-paths.json.
  git -C "$REPO" checkout -q -b cloverleaf/DEMO-001
  mkdir -p "$REPO/scripts"
  printf '#!/bin/bash\necho "Deploying..."\n' > "$REPO/scripts/deploy.sh"
  git -C "$REPO" add -A
  git -C "$REPO" commit -q -m "feat: add deploy script"

  # Return to main so advance-status can run 'git diff main..cloverleaf/DEMO-001'.
  git -C "$REPO" checkout -q main

  echo "Temp repo: $REPO"
  echo "Feature branch 'cloverleaf/DEMO-001' contains: scripts/deploy.sh"
  echo "Task starts at status=documenting, security_class=low (declared)"
  echo

  # ---- Step 1: advance documenting → council (triggers classify-security writeback) ----
  # The collapsed FSM: advance-status documenting→council classifies the diff
  # transparently (no refusal), but writes back security_class="high" when the
  # diff touches a sensitive path. The security guarantee is now council-enforced.
  echo "Step 1: advancing documenting → council (classify-security runs here)..."
  ADVANCE_EXIT=0
  cloverleaf-cli advance-status "$REPO" DEMO-001 council agent || ADVANCE_EXIT=$?

  # A1: advance must exit 0 (reclassification is transparent in the collapsed FSM).
  if [[ "$ADVANCE_EXIT" -ne 0 ]]; then
    echo "FAIL [A1]: advance-status documenting→council exited $ADVANCE_EXIT, expected 0"
    exit 1
  fi
  echo "✓ A1. advance-status documenting→council exits 0 (transparent reclassification)"

  # A2: security_class must have been written back to "high".
  SECURITY_CLASS="$(node -e "process.stdout.write(require('$REPO/.cloverleaf/tasks/DEMO-001.json').security_class||'')")"
  if [[ "$SECURITY_CLASS" != "high" ]]; then
    echo "FAIL [A2]: expected security_class=high after writeback, got: $SECURITY_CLASS"
    exit 1
  fi
  echo "✓ A2. security_class written back to 'high' (classify-security diff-detected scripts/deploy.sh)"

  # A3: council-plan selects delivery-full for the upgraded high task.
  PLAN_OUT="$(cloverleaf-cli council-plan "$REPO" DEMO-001 task.review --changed-files=scripts/deploy.sh)"
  PROFILE="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).profile||'')" "$PLAN_OUT")"
  if [[ "$PROFILE" != "delivery-full" ]]; then
    echo "FAIL [A3]: expected profile=delivery-full for high task, got: $PROFILE"
    exit 1
  fi
  echo "✓ A3. council-plan selects delivery-full for the upgraded high task"

  # A4: delivery-full includes a blocking security member.
  node -e '
    const p = JSON.parse(process.argv[1]);
    const sec = p.rounds.flat().find(x => x.member === "security");
    if (!sec || sec.blocking !== true) { console.error("FAIL [A4]: security not a blocking member", JSON.stringify(p.rounds)); process.exit(1); }
  ' "$PLAN_OUT" || exit 1
  echo "✓ A4. delivery-full profile includes a blocking security member"

  # ---- Bounce: security member vetoes ----
  echo
  echo "Bounce path: security member returns 'bounce'..."
  BOUNCE_EXIT=0
  cloverleaf-cli apply-council-verdict "$REPO" DEMO-001 task.review \
    '{"verdict":"bounce","rule":"any-veto","rationale":"sec issue","members":[{"member":"reviewer","verdict":"pass"},{"member":"security","verdict":"bounce"}]}' \
    > /dev/null || BOUNCE_EXIT=$?
  if [[ "$BOUNCE_EXIT" -ne 0 ]]; then
    echo "FAIL [A5]: apply-council-verdict (bounce) exited $BOUNCE_EXIT, expected 0"
    exit 1
  fi
  STATUS="$(node -e "process.stdout.write(require('$REPO/.cloverleaf/tasks/DEMO-001.json').status||'')")"
  if [[ "$STATUS" != "implementing" ]]; then
    echo "FAIL [A5]: expected implementing after security bounce, got: $STATUS"
    exit 1
  fi
  echo "✓ A5. security bounce → implementing (v0.8.1 guarantee preserved through the collapse)"

  # ---- Pass path: reset task to council, security passes ----
  echo
  echo "Pass path: reset task to council, security passes..."
  node -e "
    const f='$REPO/.cloverleaf/tasks/DEMO-001.json';
    const t=require(f); t.status='council';
    require('fs').writeFileSync(f, JSON.stringify(t, null, 2) + '\n');
  "
  PASS_EXIT=0
  cloverleaf-cli apply-council-verdict "$REPO" DEMO-001 task.review \
    '{"verdict":"pass","rule":"any-veto","rationale":"all good","members":[{"member":"reviewer","verdict":"pass"},{"member":"security","verdict":"pass"}]}' \
    > /dev/null || PASS_EXIT=$?
  if [[ "$PASS_EXIT" -ne 0 ]]; then
    echo "FAIL [A6]: apply-council-verdict (pass) exited $PASS_EXIT, expected 0"
    exit 1
  fi
  STATUS="$(node -e "process.stdout.write(require('$REPO/.cloverleaf/tasks/DEMO-001.json').status||'')")"
  if [[ "$STATUS" != "final-gate" ]]; then
    echo "FAIL [A6]: expected final-gate after council pass, got: $STATUS"
    exit 1
  fi
  echo "✓ A6. council pass → final-gate (unified fast-lane under final_approval_gate)"

  echo
  echo "=== flow2-dogfood-repro: all 6 assertions passed ==="
  echo "  [writeback observed] security_class upgraded to 'high' at documenting→council (A1–A2)"
  echo "  [security guarantee] delivery-full with blocking security member selected (A3–A4)"
  echo "  [bounce → implementing] v0.8.1 guarantee preserved through the collapse (A5)"
  echo "  [pass → final-gate]   council pass advances under final_approval_gate (A6)"
}

# ---------------------------------------------------------------------------
# scenario: non-ts-consumer
#
# Validates F2 (test-runner & worktree-prep agnosticism). Builds a synthetic
# NON-monorepo consumer repo (no standard/ or reference-impl/ subdirs) with a
# .cloverleaf/config/{qa-rules.json (non-npm command), discovery.json
# (worktree_setup_command)} and asserts prep-worktree runs in consumer mode:
# no throw, the setup command ran, and prep_copy_dirs were copied. Uses trivial
# shell commands so no real Python toolchain is required.
# ---------------------------------------------------------------------------
run_non_ts_consumer() {
  local REPO WT
  REPO="$(mktemp -d -t cloverleaf-non-ts-consumer.XXXXXX)"
  WT="$(mktemp -d -t cloverleaf-non-ts-wt.XXXXXX)"
  trap 'rm -rf "$REPO" "$WT"' RETURN

  mkdir -p "$REPO/.cloverleaf/config" "$REPO/fixtures"
  # A non-monorepo consumer: project files only, NO standard/ or reference-impl/.
  echo 'print("hi")' > "$REPO/app.py"
  echo '{"seed": true}' > "$REPO/fixtures/seed.json"

  cat > "$REPO/.cloverleaf/config/qa-rules.json" <<'EOF'
{ "rules": [ { "cwd": ".", "match": ["**/*.py"], "command": "sh -c 'exit 0'" } ] }
EOF
  cat > "$REPO/.cloverleaf/config/discovery.json" <<'EOF'
{ "worktree_setup_command": "sh -c 'touch .prepped'", "prep_copy_dirs": ["fixtures"] }
EOF

  # The "worktree" is a bare copy of the consumer's source files (no node_modules).
  echo 'print("hi")' > "$WT/app.py"

  echo "Non-TS consumer scratch repo: $REPO"
  echo

  # --- 1. prep-worktree runs in consumer mode without throwing ---
  if ! cloverleaf-cli prep-worktree "$REPO" "$WT"; then
    echo "FAIL: prep-worktree threw in consumer mode"; return 1
  fi
  echo "✓ 1. prep-worktree consumer mode: exit 0 (no monorepo subdirs required)"

  # --- 2. worktree_setup_command ran inside the worktree ---
  if [[ ! -f "$WT/.prepped" ]]; then
    echo "FAIL: worktree_setup_command did not run (no .prepped marker)"; return 1
  fi
  echo "✓ 2. worktree_setup_command ran in the worktree"

  # --- 3. prep_copy_dirs copied into the worktree ---
  if [[ ! -f "$WT/fixtures/seed.json" ]]; then
    echo "FAIL: prep_copy_dirs not honored in consumer mode"; return 1
  fi
  echo "✓ 3. prep_copy_dirs copied into the worktree"

  echo
  echo "non-ts-consumer scenario PASSED"
}

# ---------------------------------------------------------------------------
# Scenario: council-collapse — the Slice-4 collapsed council FSM end-to-end.
#   Asserts: the shipped two-lane default reproduces today (low→delivery-fast reviewer-only,
#   high→delivery-full with a blocking security member); a council pass advances council→final-gate
#   (fast lane unified); a security bounce returns to implementing (the v0.8.1 guarantee); and
#   validate-council enforces kind-homogeneity.
# ---------------------------------------------------------------------------
run_council_collapse() {
  echo "=== Scenario: council-collapse ==="
  local REPO PLAN STATUS
  REPO="$(mktemp -d -t cloverleaf-council-collapse.XXXXXX)"
  # shellcheck disable=SC2064
  trap "rm -rf '$REPO'" EXIT
  mkdir -p "$REPO/.cloverleaf/tasks" "$REPO/.cloverleaf/events" "$REPO/.cloverleaf/config"

  cat > "$REPO/.cloverleaf/tasks/DEMO-001.json" <<'JSON'
{ "id": "DEMO-001", "type": "task", "status": "council", "project": "DEMO", "title": "t",
  "owner": { "kind": "agent", "id": "unassigned" }, "context": { "rfc": { "project": "DEMO", "id": "DEMO-RFC-001" } },
  "acceptance_criteria": ["a"], "definition_of_done": ["d"], "risk_class": "low", "security_class": "low" }
JSON
  PLAN="$(cloverleaf-cli council-plan "$REPO" DEMO-001 task.review --changed-files=src/x.ts)"
  echo "$PLAN" | node -e '
    const p = JSON.parse(require("fs").readFileSync(0, "utf-8"));
    if (p.source !== "default") { console.error("FAIL: source", p.source); process.exit(1); }
    if (p.profile !== "delivery-fast") { console.error("FAIL: profile", p.profile); process.exit(1); }
    const m = p.rounds.flat().map(x => x.member);
    if (JSON.stringify(m) !== JSON.stringify(["reviewer"])) { console.error("FAIL: members", m); process.exit(1); }
  ' || exit 1
  echo "✓ low task → delivery-fast (reviewer only) from the shipped default"

  cloverleaf-cli apply-council-verdict "$REPO" DEMO-001 task.review \
    '{"verdict":"pass","rule":"any-veto","rationale":"ok","members":[{"member":"reviewer","verdict":"pass"}]}' > /dev/null || exit 1
  STATUS="$(node -e "process.stdout.write(require('$REPO/.cloverleaf/tasks/DEMO-001.json').status||'')")"
  [ "$STATUS" = "final-gate" ] || { echo "FAIL: expected final-gate, got '$STATUS'"; exit 1; }
  echo "✓ council pass → final-gate (fast lane unified under final_approval_gate)"

  cat > "$REPO/.cloverleaf/tasks/DEMO-002.json" <<'JSON'
{ "id": "DEMO-002", "type": "task", "status": "council", "project": "DEMO", "title": "t",
  "owner": { "kind": "agent", "id": "unassigned" }, "context": { "rfc": { "project": "DEMO", "id": "DEMO-RFC-001" } },
  "acceptance_criteria": ["a"], "definition_of_done": ["d"], "risk_class": "high", "security_class": "high" }
JSON
  cloverleaf-cli council-plan "$REPO" DEMO-002 task.review --changed-files=src/x.ts | node -e '
    const p = JSON.parse(require("fs").readFileSync(0, "utf-8"));
    if (p.profile !== "delivery-full") { console.error("FAIL: profile", p.profile); process.exit(1); }
    const sec = p.rounds.flat().find(x => x.member === "security");
    if (!sec || sec.blocking !== true) { console.error("FAIL: security not a blocking member", JSON.stringify(p.rounds)); process.exit(1); }
  ' || exit 1
  echo "✓ high+security task → delivery-full with a blocking security member"

  cloverleaf-cli apply-council-verdict "$REPO" DEMO-002 task.review \
    '{"verdict":"bounce","rule":"any-veto","rationale":"sec","members":[{"member":"reviewer","verdict":"pass"},{"member":"security","verdict":"bounce"}]}' > /dev/null || exit 1
  STATUS="$(node -e "process.stdout.write(require('$REPO/.cloverleaf/tasks/DEMO-002.json').status||'')")"
  [ "$STATUS" = "implementing" ] || { echo "FAIL: security bounce should return to implementing, got '$STATUS'"; exit 1; }
  echo "✓ security bounce → implementing (v0.8.1 guarantee preserved through the collapse)"

  # validate-council enforces kind-homogeneity: a plan gate bound to a code profile is rejected.
  cat > "$REPO/.cloverleaf/config/council.json" <<'JSON'
{ "profiles": { "p": { "rounds": [[{ "member": "reviewer" }]], "aggregation": "any-veto" } },
  "gates": { "plan.task_batch": "p" } }
JSON
  if cloverleaf-cli validate-council "$REPO" > /dev/null 2>&1; then
    echo "FAIL: validate-council accepted a plan gate bound to a code-kind profile"; exit 1
  fi
  echo "✓ validate-council rejects a kind-mismatched binding"

  echo "=== council-collapse: all assertions passed ==="
}

# ---------------------------------------------------------------------------
# Scenario dispatch
# ---------------------------------------------------------------------------
case "${1:-default}" in
  flow2-dogfood-repro)
    run_flow2_dogfood_repro
    exit 0
    ;;
  council-optin)
    run_council_optin
    exit 0
    ;;
  council-chair)
    run_council_chair
    exit 0
    ;;
  council-advisory)
    run_council_advisory
    exit 0
    ;;
  council-collapse)
    run_council_collapse
    exit 0
    ;;
  non-ts-consumer)
    run_non_ts_consumer
    exit 0
    ;;
  default|"")
    : # fall through to default scenario below
    ;;
  *)
    echo "Unknown scenario: $1"
    echo "Available scenarios: flow2-dogfood-repro, council-optin, council-chair, council-advisory, council-collapse, non-ts-consumer"
    exit 2
    ;;
esac

# ---------------------------------------------------------------------------
# Default scenario (no argument given)
# ---------------------------------------------------------------------------

REPO="$(mktemp -d -t cloverleaf-walker-acceptance.XXXXXX)"
trap 'rm -rf "$REPO"' EXIT

mkdir -p "$REPO/.cloverleaf/projects" "$REPO/.cloverleaf/plans" "$REPO/.cloverleaf/tasks"

cat > "$REPO/.cloverleaf/projects/ACC.json" <<'EOF'
{"key": "ACC", "name": "Acceptance Test"}
EOF

# Three disjoint peer tasks, no edges. Mirrors the v0.6 default scenario:
# walker spawns 3 parallel sessions when max_concurrent >= 3.
cat > "$REPO/.cloverleaf/plans/ACC-1.json" <<'EOF'
{
  "type": "plan",
  "project": "ACC",
  "id": "ACC-1",
  "status": "gate-approved",
  "owner": {"kind": "agent", "id": "plan"},
  "parent_rfc": {"project": "ACC", "id": "ACC-0"},
  "task_dag": {
    "nodes": [
      {"project": "ACC", "id": "ACC-2"},
      {"project": "ACC", "id": "ACC-3"},
      {"project": "ACC", "id": "ACC-4"}
    ],
    "edges": []
  },
  "tasks": []
}
EOF

for ID in ACC-2 ACC-3 ACC-4; do
  cat > "$REPO/.cloverleaf/tasks/$ID.json" <<EOF
{
  "id": "$ID",
  "type": "task",
  "status": "pending",
  "owner": {"kind": "agent", "id": "unassigned"},
  "project": "ACC",
  "title": "Acceptance task $ID",
  "context": {"rfc": {"project": "ACC", "id": "ACC-0"}},
  "acceptance_criteria": ["Pass acceptance"],
  "definition_of_done": ["Done"],
  "risk_class": "low"
}
EOF
done

echo "Acceptance scratch repo: $REPO"
echo

# --- 1. cycle detection on clean plan ---
if ! cloverleaf-cli dag-detect-cycle "$REPO" ACC-1; then
  echo "FAIL: dag-detect-cycle should exit 0 on clean Plan"
  exit 1
fi
echo "✓ 1. dag-detect-cycle on clean Plan: exit 0"

# --- 2. ready tasks returns all 3 roots with max=3 ---
READY=$(cloverleaf-cli dag-ready-tasks "$REPO" ACC-1 3 | sort)
EXPECTED=$(printf "ACC-2\nACC-3\nACC-4")
if [[ "$READY" != "$EXPECTED" ]]; then
  echo "FAIL: ready (max=3) returned:"
  echo "$READY"
  echo "expected:"
  echo "$EXPECTED"
  exit 1
fi
echo "✓ 2. dag-ready-tasks (max=3): all 3 peers returned"

# --- 3. concurrency cap with max=2 ---
COUNT=$(cloverleaf-cli dag-ready-tasks "$REPO" ACC-1 2 | wc -l)
if [[ "$COUNT" -ne 2 ]]; then
  echo "FAIL: ready (max=2) returned $COUNT tasks, expected 2"
  exit 1
fi
echo "✓ 3. dag-ready-tasks (max=2): 2 tasks returned (cap honoured)"

# --- 4. walk-state write + read round-trip ---
cat > "$REPO/walk-state-input.json" <<'EOF'
{
  "plan_id": "ACC-1",
  "started": "2026-04-24T00:00:00Z",
  "max_concurrent": 3,
  "tasks": {
    "ACC-2": {
      "state": "running",
      "session_id": "sess_test",
      "started_at": "2026-04-24T00:00:01Z",
      "last_seq": 0
    }
  }
}
EOF
cloverleaf-cli walk-state-write "$REPO" "$REPO/walk-state-input.json"
ROUND=$(cloverleaf-cli walk-state-read "$REPO" ACC-1 | jq -r '.tasks["ACC-2"].state')
if [[ "$ROUND" != "running" ]]; then
  echo "FAIL: walk-state round-trip read=$ROUND, expected=running"
  exit 1
fi
echo "✓ 4. walk-state-write + walk-state-read: round-trip clean"

# --- 5. running session is subtracted from slot count ---
READY=$(cloverleaf-cli dag-ready-tasks "$REPO" ACC-1 3 | sort)
EXPECTED=$(printf "ACC-3\nACC-4")
if [[ "$READY" != "$EXPECTED" ]]; then
  echo "FAIL: with ACC-2 running, ready (max=3)=$READY, expected=$EXPECTED"
  exit 1
fi
echo "✓ 5. slot accounting: ACC-2 running → only ACC-3 ACC-4 returned"

# --- 6. all merged → empty ready set ---
cat > "$REPO/walk-state-input.json" <<'EOF'
{
  "plan_id": "ACC-1",
  "started": "2026-04-24T00:00:00Z",
  "max_concurrent": 3,
  "tasks": {
    "ACC-2": {"state": "merged", "session_id": "s1", "merged_at": "2026-04-24T00:01:00Z", "merge_commit": "abc"},
    "ACC-3": {"state": "merged", "session_id": "s2", "merged_at": "2026-04-24T00:01:01Z", "merge_commit": "def"},
    "ACC-4": {"state": "merged", "session_id": "s3", "merged_at": "2026-04-24T00:01:02Z", "merge_commit": "ghi"}
  }
}
EOF
cloverleaf-cli walk-state-write "$REPO" "$REPO/walk-state-input.json"
READY=$(cloverleaf-cli dag-ready-tasks "$REPO" ACC-1 3 || true)
if [[ -n "$READY" ]]; then
  echo "FAIL: all tasks merged but dag-ready-tasks emitted: $READY"
  exit 1
fi
echo "✓ 6. all-merged: dag-ready-tasks emits empty set"

# --- 7. cycle detection catches a 2-cycle ---
cat > "$REPO/.cloverleaf/plans/BAD-1.json" <<'EOF'
{
  "type": "plan",
  "project": "ACC",
  "id": "BAD-1",
  "status": "gate-approved",
  "owner": {"kind": "agent", "id": "plan"},
  "parent_rfc": {"project": "ACC", "id": "ACC-0"},
  "task_dag": {
    "nodes": [
      {"project": "ACC", "id": "ACC-2"},
      {"project": "ACC", "id": "ACC-3"}
    ],
    "edges": [
      {"from": {"project": "ACC", "id": "ACC-2"}, "to": {"project": "ACC", "id": "ACC-3"}},
      {"from": {"project": "ACC", "id": "ACC-3"}, "to": {"project": "ACC", "id": "ACC-2"}}
    ]
  },
  "tasks": []
}
EOF
if cloverleaf-cli dag-detect-cycle "$REPO" BAD-1 >/dev/null 2>&1; then
  echo "FAIL: cycle in BAD-1 not detected"
  exit 1
fi
echo "✓ 7. dag-detect-cycle on 2-cycle: exits non-zero"

echo
echo "All 7 walker acceptance checks passed."

# ---------------------------------------------------------------------------
# Bug-fix regression checks (CLV-39)
# These are static grep checks that guard against regressions in the fixes
# merged for bugs #1, #2, and #4 discovered during the v0.6 Walker Dogfood
# (RFC CLV-30).  They run at the end of the acceptance harness so that the
# data-plane checks above always complete first.
# ---------------------------------------------------------------------------

# Locate the reference-impl root relative to this script (works when invoked
# from any cwd: via `npm run acceptance:walker` or directly).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REFIMPL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo
echo "--- Bug-fix regression checks (CLV-39) ---"
echo

# --- 8. Bug #1: walker WT path uses XDG_CACHE_HOME pattern, not /tmp/ ---
#
# The SKILL.md for cloverleaf-run-plan previously used `/tmp/cl-review-<id>`
# paths (the same pattern used by reviewer/QA for their ephemeral worktrees).
# That caused INVALID_CWD failures because the walker's own worktrees are
# long-lived and must not live under /tmp (gets cleaned by the OS mid-run).
# Fix: the SKILL.md now uses `${XDG_CACHE_HOME:-$HOME/.cache}/cloverleaf/...`.
#
# Static check: assert the XDG_CACHE_HOME pattern is present in SKILL.md AND
# that no bare `/tmp/` worktree add pattern exists for the walker's WT
# variable (reviewer/QA use /tmp legitimately for their short-lived worktrees,
# so we check only the WT assignment line).

SKILL_MD="$REFIMPL_DIR/skills/cloverleaf-run-plan/SKILL.md"

if ! grep -qE '\$\{XDG_CACHE_HOME:-\$HOME/.cache\}/cloverleaf/walker' "$SKILL_MD"; then
  echo "FAIL [bug #1]: SKILL.md does not contain the XDG_CACHE_HOME walker WT pattern"
  echo "  expected: \${XDG_CACHE_HOME:-\$HOME/.cache}/cloverleaf/walker/<...>"
  echo "  file: $SKILL_MD"
  exit 1
fi
echo "✓ 8. [bug #1] SKILL.md uses XDG_CACHE_HOME for walker WT path (not /tmp/)"

# Secondary check: the WT= assignment must NOT use /tmp as the base.
# (A line like `WT="/tmp/..."` would be the regression.)
if grep -E '^\s*WT="?/tmp/' "$SKILL_MD" >/dev/null 2>&1; then
  echo "FAIL [bug #1]: SKILL.md still has a WT=/tmp/... assignment — regression detected"
  echo "  file: $SKILL_MD"
  exit 1
fi
echo "✓ 8b.[bug #1] SKILL.md has no WT=/tmp/... assignment"

# --- 9. Bug #2: reviewer.md and qa.md must not use 'git worktree add … main' ---
#
# The original reviewer/QA prompts told agents to run:
#   git worktree add /tmp/cl-review-<id> main          # named branch
# This fails when 'main' (or the feature branch) is already checked out in
# another worktree (the walker worktree).  The fix switched to:
#   git worktree add --detach "$TMPDIR" "$SHA"          # detached at a SHA
# Static check: no 'git worktree add' line should end with 'main' as the
# branch argument (allowing for optional flags between 'add' and 'main').

REVIEWER_MD="$REFIMPL_DIR/prompts/reviewer.md"
QA_MD="$REFIMPL_DIR/prompts/qa.md"

# Pattern: 'git worktree add' followed by anything then whitespace+'main' at
# end of token (but NOT 'main's or 'mainRoot' — we only care about the git
# ref argument).  We use a strict regex to avoid false positives.
WORKTREE_ADD_MAIN_PATTERN='git worktree add[^`\n]*[[:space:]]main([[:space:]]|`|$)'

if grep -P "$WORKTREE_ADD_MAIN_PATTERN" "$REVIEWER_MD" >/dev/null 2>&1; then
  echo "FAIL [bug #2]: reviewer.md still contains 'git worktree add … main' (named-branch form)"
  grep -nP "$WORKTREE_ADD_MAIN_PATTERN" "$REVIEWER_MD"
  exit 1
fi
echo "✓ 9. [bug #2] reviewer.md: no 'git worktree add … main' pattern found"

if grep -P "$WORKTREE_ADD_MAIN_PATTERN" "$QA_MD" >/dev/null 2>&1; then
  echo "FAIL [bug #2]: qa.md still contains 'git worktree add … main' (named-branch form)"
  grep -nP "$WORKTREE_ADD_MAIN_PATTERN" "$QA_MD"
  exit 1
fi
echo "✓ 9b.[bug #2] qa.md: no 'git worktree add … main' pattern found"

# Complementary check: both files must contain '--detach' (the corrected form).
if ! grep -q '\-\-detach' "$REVIEWER_MD"; then
  echo "FAIL [bug #2]: reviewer.md does not contain '--detach' — fix may be missing"
  exit 1
fi
if ! grep -q '\-\-detach' "$QA_MD"; then
  echo "FAIL [bug #2]: qa.md does not contain '--detach' — fix may be missing"
  exit 1
fi
echo "✓ 9c.[bug #2] reviewer.md and qa.md both use '--detach' (corrected worktree form)"

# --- 10. Bug #4: prep-worktree walker-mode (node_modules resolution) ---
#
# Bug: cloverleaf-cli prep-worktree threw "main missing standard/node_modules"
# when passed a walker worktree as mainRoot, because a walker worktree has no
# node_modules of its own — the actual node_modules live in the primary repo
# that contains the walker worktree as a child path.
# Fix (CLV-37): prep-worktree now walks up the directory tree from mainRoot
# until it finds an ancestor with both standard/node_modules and
# reference-impl/node_modules, then uses that as the effective primary root.
#
# Static check: verify the fix is present in the source file.

PREP_WORKTREE_SRC="$REFIMPL_DIR/lib/prep-worktree.ts"

if ! grep -q 'findPrimaryRoot' "$PREP_WORKTREE_SRC"; then
  echo "FAIL [bug #4]: prep-worktree.ts does not contain 'findPrimaryRoot' — walker-mode fix absent"
  echo "  file: $PREP_WORKTREE_SRC"
  exit 1
fi
echo "✓ 10. [bug #4] prep-worktree.ts contains findPrimaryRoot (walker-mode walk-up fix)"

# Live invocation check: build a synthetic walker-worktree filesystem layout
# and call `cloverleaf-cli prep-worktree` with the walker worktree path as
# mainRoot. This mirrors the exact scenario that caused the bug in production:
# the orchestrator passes the walker's own worktree (no node_modules) as
# mainRoot; the fix must walk up to the primary repo to find them.

PRIMARY_ROOT="$(mktemp -d -t cl-prepwt-primary.XXXXXX)"
WALKER_WT="$PRIMARY_ROOT/walkers/acc-walker-wt"
TARGET_WT="$(mktemp -d -t cl-prepwt-target.XXXXXX)"

cleanup_prepwt() {
  rm -rf "$PRIMARY_ROOT" "$TARGET_WT"
}
# Stack cleanup on top of the existing EXIT trap without losing the REPO cleanup.
OLD_TRAP="$(trap -p EXIT | sed "s/trap -- '//;s/' EXIT//")"
trap 'cleanup_prepwt; '"$OLD_TRAP" EXIT

# Primary repo: has node_modules.
mkdir -p "$PRIMARY_ROOT/standard/node_modules/some-dep"
printf '{"name":"some-dep"}' > "$PRIMARY_ROOT/standard/node_modules/some-dep/package.json"
printf '{"name":"@cloverleaf/standard","version":"0.0.0-acctest","scripts":{"build":"mkdir -p dist && echo acctest > dist/marker.txt"}}' \
  > "$PRIMARY_ROOT/standard/package.json"

mkdir -p "$PRIMARY_ROOT/reference-impl/node_modules/@cloverleaf"
ln -s '../../../standard' "$PRIMARY_ROOT/reference-impl/node_modules/@cloverleaf/standard"
mkdir -p "$PRIMARY_ROOT/reference-impl/node_modules/vitest"
printf '{"name":"vitest"}' > "$PRIMARY_ROOT/reference-impl/node_modules/vitest/package.json"
printf '{"name":"@cloverleaf/reference-impl","version":"0.0.0-acctest"}' \
  > "$PRIMARY_ROOT/reference-impl/package.json"
# prep-worktree copies the primary's reference-impl/dist into the target (CLV-52);
# the real primary always has a built dist, so the fixture must provide one.
mkdir -p "$PRIMARY_ROOT/reference-impl/dist"
printf '// acctest\n' > "$PRIMARY_ROOT/reference-impl/dist/index.mjs"

# Walker worktree: source files but NO node_modules (the bug scenario).
mkdir -p "$WALKER_WT/standard"
printf '{"name":"@cloverleaf/standard","version":"0.0.0-acctest","scripts":{"build":"mkdir -p dist && echo acctest > dist/marker.txt"}}' \
  > "$WALKER_WT/standard/package.json"
mkdir -p "$WALKER_WT/reference-impl"
printf '{"name":"@cloverleaf/reference-impl","version":"0.0.0-acctest"}' \
  > "$WALKER_WT/reference-impl/package.json"

# Target worktree to be prepped.
mkdir -p "$TARGET_WT/standard"
printf '{"name":"@cloverleaf/standard","version":"0.0.0-acctest","scripts":{"build":"mkdir -p dist && echo acctest > dist/marker.txt"}}' \
  > "$TARGET_WT/standard/package.json"
mkdir -p "$TARGET_WT/reference-impl"
printf '{"name":"@cloverleaf/reference-impl","version":"0.0.0-acctest"}' \
  > "$TARGET_WT/reference-impl/package.json"

# Invoke prep-worktree with the walker worktree (no node_modules) as mainRoot.
if ! cloverleaf-cli prep-worktree "$WALKER_WT" "$TARGET_WT" 2>&1; then
  echo "FAIL [bug #4]: cloverleaf-cli prep-worktree failed when mainRoot is a walker worktree"
  echo "  mainRoot (walker wt, no node_modules): $WALKER_WT"
  echo "  targetWt: $TARGET_WT"
  echo "  primary repo (has node_modules):       $PRIMARY_ROOT"
  exit 1
fi

# Assert the target worktree was populated correctly.
if [[ ! -f "$TARGET_WT/standard/node_modules/some-dep/package.json" ]]; then
  echo "FAIL [bug #4]: standard/node_modules not copied to target worktree"
  exit 1
fi
if [[ ! -f "$TARGET_WT/standard/dist/marker.txt" ]]; then
  echo "FAIL [bug #4]: standard/dist not built in target worktree"
  exit 1
fi
if [[ ! -f "$TARGET_WT/reference-impl/node_modules/vitest/package.json" ]]; then
  echo "FAIL [bug #4]: reference-impl/node_modules not copied to target worktree"
  exit 1
fi
echo "✓ 10b.[bug #4] prep-worktree succeeds with walker-worktree mainRoot; target correctly populated"

echo
echo "All 10 walker acceptance checks passed (7 data-plane + 3 bug-fix regressions)."
echo
echo "Note: this script validates the walker's data plane (CLI subcommands +"
echo "walk-state semantics) against a synthetic Plan, and guards the v0.6"
echo "walker dogfood bug fixes (CLV-39: bugs #1, #2, #4) via static grep +"
echo "a live prep-worktree invocation. The walker's full Session-orchestration"
echo "loop (claw-drive integration, final-gate Q&A, escalation surfacing) is"
echo "exercised by the manual dogfood."
