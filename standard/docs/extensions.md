# Extensions Guide

Teams need to layer their own metadata on Work Items (priority, sprint, labels, custom workflow data) without breaking the contract that AI agents rely on. The `extensions` field exists for this.

## Rules

1. **All extensions live under the `extensions` field** on a Work Item.
2. **Keys are namespaced** as `team.field` (e.g., `acme.priority`). Keys without a dot are forbidden — they would collide with potential future mandatory fields.
3. **Agents ignore unknown extension keys.** Conformant agents must not error when they encounter an extension they don't recognize. This is what makes extensions forward-compatible.
4. **Extensions cannot override mandatory fields.** Don't redefine `definition_of_done` under `extensions.acme.dod` — use the mandatory field.

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
