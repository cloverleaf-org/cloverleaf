---
name: cloverleaf-gate
description: Human gate action on an RFC (rfc_strategy_gate) or Plan (task_batch_gate) in status gate-pending. Usage — /cloverleaf-gate <item-id> <approve|reject|revise> [reason]. `revise` is valid only at rfc_strategy_gate (RFC only).
---

# Cloverleaf — human gate

The user has invoked this skill with `<item-id> <action> [reason]`.

## Steps

1. Capture arguments:
   - `$ITEM_ID` = first positional arg
   - `$ACTION` = second positional arg (must be `approve`, `reject`, or `revise`)
   - `$REASON` = remaining args joined with spaces (optional)

   If `ITEM_ID` or `ACTION` is missing, report usage and stop.

2. Validate action:
   ```bash
   case "$ACTION" in
     approve|reject|revise) ;;
     *) echo "Invalid action: $ACTION. Use approve, reject, or revise." >&2; exit 1 ;;
   esac
   ```

3. Detect work-item type by checking which directory has the JSON file:
   ```bash
   if [ -f "<repo_root>/.cloverleaf/rfcs/$ITEM_ID.json" ]; then
     TYPE=rfc
     GATE=rfc_strategy_gate
   elif [ -f "<repo_root>/.cloverleaf/plans/$ITEM_ID.json" ]; then
     TYPE=plan
     GATE=task_batch_gate
   else
     echo "No RFC or Plan found with ID $ITEM_ID" >&2
     exit 1
   fi
   ```

4. Validate that `revise` is only valid at `rfc_strategy_gate` (i.e., on RFCs — revise is only exclusive to rfc_strategy_gate):
   ```bash
   if [ "$ACTION" = "revise" ] && [ "$TYPE" != "rfc" ]; then
     echo "revise is only valid at rfc_strategy_gate (RFCs). Use reject on Plans." >&2
     exit 2
   fi
   ```

5. Verify the item is in `gate-pending` status:
   ```bash
   STATUS=$(cloverleaf-cli load-$TYPE <repo_root> $ITEM_ID | jq -r .status)
   if [ "$STATUS" != "gate-pending" ]; then
     echo "$TYPE $ITEM_ID is in status '$STATUS', not gate-pending" >&2
     exit 3
   fi
   ```

6. Emit the gate-decision event:
   ```bash
   if [ -n "$REASON" ]; then
     cloverleaf-cli emit-gate-decision <repo_root> $ITEM_ID $GATE $ACTION human --comment="$REASON"
   else
     cloverleaf-cli emit-gate-decision <repo_root> $ITEM_ID $GATE $ACTION human
   fi
   ```

7. Advance the work-item state:
   ```bash
   case "$ACTION" in
     approve)
       cloverleaf-cli advance-$TYPE <repo_root> $ITEM_ID approved human $GATE
       ;;
     reject)
       cloverleaf-cli advance-$TYPE <repo_root> $ITEM_ID rejected human $GATE
       ;;
     revise)
       # RFC-only — validated in step 4
       cloverleaf-cli advance-rfc <repo_root> $ITEM_ID drafting human $GATE
       # Persisting the revise reason as a feedback finding is deferred to v0.6.
       # For now, the reason is surfaced on stdout so the caller can capture it
       # and pass it back via the next /cloverleaf-draft-rfc invocation context.
       if [ -n "$REASON" ]; then
         echo "revise reason: $REASON"
       fi
       ;;
   esac
   ```

8. Commit state files:
   ```bash
   git add .cloverleaf/rfcs/ .cloverleaf/plans/ .cloverleaf/events/
   git commit -m "cloverleaf: gate $ITEM_ID $ACTION ($GATE)"
   ```

9. Print the new status:
   ```bash
   NEW=$(cloverleaf-cli load-$TYPE <repo_root> $ITEM_ID | jq -r .status)
   echo "$ITEM_ID: $STATUS → $NEW"
   ```

## Notes

- `revise` (RFC only) returns the RFC to `drafting`. The orchestrator loops back to `/cloverleaf-draft-rfc`.
- On `reject` of an RFC: terminal (enters rejected state; orchestrator halts).
- On `reject` of a Plan: plan enters rejected state; it can be re-decomposed via a new `/cloverleaf-breakdown` run (rejected → drafting via agent is a legal transition).
- `[reason]` text is persisted in the gate_decision event's `comment` field. For `revise`, it's also echoed to stdout so the calling orchestrator can feed it back to the Researcher on re-draft.
