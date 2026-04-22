---
name: cloverleaf-new-rfc
description: Scaffold a new RFC work item from a brief file. Usage — /cloverleaf-new-rfc <brief-file>. Writes `.cloverleaf/rfcs/<ID>.json` with status=drafting and empty body fields (populated by /cloverleaf-draft-rfc). Returns the new RFC ID.
---

# Cloverleaf — new RFC

## Steps

1. Capture `<brief-file>` (first positional arg). Verify file exists:

```bash
BRIEF_FILE="$1"
[ -f "$BRIEF_FILE" ] || { echo "Brief file not found: $BRIEF_FILE" >&2; exit 1; }
```

2. Load the discovery config to get `projectId`:

```bash
CFG=$(cloverleaf-cli discovery-config --repo-root $(pwd))
PROJECT_ID=$(echo "$CFG" | jq -r .projectId)
[ -z "$PROJECT_ID" ] && { echo "set projectId in .cloverleaf/config/discovery.json" >&2; exit 2; }
```

3. Compute next work-item ID:

```bash
RFC_ID=$(cloverleaf-cli next-work-item-id $(pwd) "$PROJECT_ID")
```

4. Read brief content:

```bash
BRIEF_CONTENT=$(cat "$BRIEF_FILE")
```

5. Build the RFC skeleton JSON. Derive a short title from the brief's first non-empty line (truncate if long). Problem = brief content. All other body fields are seeded with schema-conformant placeholders that `/cloverleaf-draft-rfc` will overwrite.

```bash
FIRST_LINE=$(head -n 1 "$BRIEF_FILE" | sed 's/^# *//' | cut -c1-120)
TMPFILE=$(mktemp --suffix=.json)

cat > "$TMPFILE" <<EOF
{
  "type": "rfc",
  "project": "$PROJECT_ID",
  "id": "$RFC_ID",
  "status": "drafting",
  "owner": { "kind": "agent", "id": "researcher" },
  "title": $(printf '%s' "$FIRST_LINE" | jq -Rs .),
  "problem": $(printf '%s' "$BRIEF_CONTENT" | jq -Rs .),
  "solution": "TBD — to be populated by /cloverleaf-draft-rfc.",
  "unknowns": [],
  "acceptance_criteria": ["RFC body populated by researcher agent"],
  "out_of_scope": []
}
EOF
```

6. Save via CLI (validates against rfc.schema.json):

```bash
cloverleaf-cli save-rfc $(pwd) "$TMPFILE"
rm "$TMPFILE"
```

7. Print the new RFC ID to stdout:

```bash
echo "$RFC_ID"
```

## Notes

- This skill does NOT invoke the Researcher agent. Use `/cloverleaf-draft-rfc <RFC_ID>` to populate body from the brief + doc grounding.
- To drive the whole Discovery flow end-to-end, use `/cloverleaf-discover <brief-file>` instead.
