#!/usr/bin/env node
// Guard for .cloverleaf/claw-drive-policy.json.
//
// Nothing else in this repo covers that file: it ships in neither npm package,
// so the vitest suites never see it, and the `> /dev/` false positive that
// prompted this check sat there through a whole council dogfood unnoticed.
//
// Runs every row of policy-probes.tsv through the real `claw-drive policy-test`
// CLI and asserts which list decided the call. Exits 1 on any mismatch, so it
// works as a CI-style gate.
//
//   node .cloverleaf/policy-check.mjs [path/to/policy.json]
//
// Requires claw-drive on PATH (it is what drives the dogfood this policy governs).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const POLICY = resolve(process.argv[2] ?? `${HERE}/claw-drive-policy.json`);
const PROBES = resolve(`${HERE}/policy-probes.tsv`);

// The four rule lists, plus two outcomes that match no rule at all:
//   escalate_default — nothing matched; the human is asked
//   deny_silent      — bash_composition refused the command WITHOUT asking a
//                      human. It carries no `list`, so it must be named
//                      explicitly or it is indistinguishable from
//                      escalate_default -- which is exactly the hole that let
//                      an earlier version of this checker pass a policy with
//                      per_segment re-enabled.
const VALID = new Set(["auto_reject", "auto_defer", "auto_approve", "escalate_default", "deny_silent"]);
const MIN_PROBES = 40;

const rows = [];
for (const [i, raw] of readFileSync(PROBES, "utf8").split("\n").entries()) {
  const line = raw.replace(/\r$/, "");
  if (!line.trim() || line.trimStart().startsWith("#")) continue;
  const parts = line.split("\t");
  if (parts.length < 3) {
    console.error(`policy-probes.tsv:${i + 1}: expected <expected>TAB<tool>TAB<command|arg>`);
    process.exit(2);
  }
  const [expected, tool] = [parts[0].trim(), parts[1].trim()];
  // Rejoin so a Bash command may itself contain tabs; \n means a real newline.
  const payload = parts.slice(2).join("\t").replace(/\\n/g, "\n");
  if (!VALID.has(expected)) {
    console.error(`policy-probes.tsv:${i + 1}: unknown expectation ${JSON.stringify(expected)}`);
    process.exit(2);
  }
  rows.push({ line: i + 1, expected, tool, payload });
}

// A probe file that parsed to nothing would exit 0 and prove nothing.
if (rows.length < MIN_PROBES) {
  console.error(`policy-check: only ${rows.length} probes parsed (expected >= ${MIN_PROBES}) — the table looks broken, refusing to pass`);
  process.exit(2);
}
// So would a table that had quietly lost a whole tool's coverage.
for (const tool of ["Bash", "Edit", "Write"]) {
  if (!rows.some((r) => r.tool === tool)) {
    console.error(`policy-check: no ${tool} probes in the table — refusing to pass`);
    process.exit(2);
  }
}

function decide(row) {
  const args =
    row.tool === "Bash"
      ? ["policy-test", "--policy", POLICY, "--json", row.payload]
      : ["policy-test", "--policy", POLICY, "--tool", row.tool, "--arg", row.payload, "--json"];
  const d = JSON.parse(execFileSync("claw-drive", args, { encoding: "utf8" }));
  if (d.decision === "deny_silent") return "deny_silent";
  return d.list ?? "escalate_default";
}

let failed = 0;
for (const r of rows) {
  let actual;
  try {
    actual = decide(r);
  } catch (e) {
    console.error(`FAIL policy-probes.tsv:${r.line}: policy-test errored — ${e.message.split("\n")[0]}`);
    failed++;
    continue;
  }
  if (actual !== r.expected) {
    console.error(
      `FAIL policy-probes.tsv:${r.line}: expected ${r.expected}, got ${actual}\n       ${r.tool}: ${r.payload.replace(/\n/g, "\\n")}`,
    );
    failed++;
  }
}

console.log(`policy-check: ${rows.length - failed}/${rows.length} probes passed against ${POLICY}`);
process.exit(failed ? 1 : 0);
