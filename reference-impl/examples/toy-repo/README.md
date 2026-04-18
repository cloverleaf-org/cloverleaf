# Toy Repo — Cloverleaf Reference Impl Demo

Minimal standalone repo demonstrating a Cloverleaf Tight-Loop end-to-end.

## Setup

```bash
npm install
cd ../..
./install.sh --project   # installs skills into .claude/plugins/cloverleaf/
```

## Run the demo

In a Claude Code session inside this directory:

```
/cloverleaf-run DEMO-001
```

Expected: branch `cloverleaf/DEMO-001` created with a `multiply` function + test, task state lands on `automated-gates`, 5 status events emitted under `.cloverleaf/events/`, no feedback bounces.
