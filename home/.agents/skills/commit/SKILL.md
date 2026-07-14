---
name: commit
description: Inspect changes, compose atomic commit messages in Mohil's style, and create the commit safely.
disable-model-invocation: true
---

# Commit

Commit the current work in Mohil's established style. Derive the message from the diff, not merely from the user's description.

## Establish the boundary

Inspect `git status --short`, the staged diff, the unstaged diff, and relevant untracked files before deciding what belongs together.

- If changes are already staged, treat the index as the requested commit boundary. Do not add unstaged changes unless the user asks.
- If nothing is staged and the changes form one coherent unit, stage only the explicit files for that unit.
- If the tree contains multiple independent changes, keep them as separate commits. Ask one focused question only when their intended grouping cannot be inferred safely.
- Never discard, rewrite, or include unrelated user work.
- Never amend or push unless explicitly requested.

The boundary is ready when every staged hunk contributes to one describable change and no relevant hunk for that change has been accidentally omitted.

## Write the subject

Use exactly one of these prefixes followed by `: `:

- `feat:` — a new capability or meaningful new behavior;
- `fix:` — correction of broken or incorrect behavior;
- `ref:` — restructuring, cleanup, simplification, or migration without intentional behavior change;
- `test:` — test-only coverage or stabilization;
- `chore:` — maintenance, dependencies, configuration, documentation, generated files, or repository housekeeping that fits none of the above.

Prefer `ref:`, never `refactor:`. Do not add parenthesized scopes.

Write a short, concrete phrase after the prefix:

- lowercase ordinary prose;
- preserve required casing for identifiers, filenames, acronyms, and canonical product names such as `GenUI`, `MCP`, `AGENTS.md`, or `TypeScript`;
- usually begin with a direct verb such as `add`, `remove`, `update`, `move`, `use`, `expose`, `bind`, `keep`, or `stop`;
- describe the actual result, not the act of working on it;
- no title case, trailing period, issue boilerplate, or generic claims such as “improve code quality.”

Default to a single subject line with no body. Add a body only when the user requests one or essential context cannot fit honestly in the subject.

Representative style:

```text
feat: bind generation guidance to surface authority
fix: stop reencoding
ref: move counter context wiring into resources
chore: update styling docs
test: add browser boundary coverage
```

## Commit

Before committing, review the staged diff once more and run `git diff --check --cached`. Then commit using the selected subject without adding attribution or generated-by trailers.

Afterward, report the commit hash and subject, then show whether relevant changes remain in the working tree.
