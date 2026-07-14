---
name: to-spec
description: Turn the current conversation into a proportionate specification and publish it as a Kaam-dō parent task.
disable-model-invocation: true
---

# To Spec

Turn settled conversation context into one buildable specification. Do not restart discovery; use `grill-with-docs` or `wayfinder` first when important decisions remain open.

Before publishing, read the [Kaam-dō tracker contract](../kaam-do/TRACKER.md).

## 1. Gather

Read the current conversation, relevant code, `CONTEXT.md`/`CONTEXT-MAP.md`, applicable ADRs, and any originating Wayfinder map or Notion ticket. Identify the source repositories and work/personal scope.

Complete when every consequential claim in the draft can be traced to conversation, code, domain documentation, or an explicit reference.

## 2. Find the test seam

Prefer an existing high-level public seam. Propose a new seam only when the behavior cannot be tested coherently through an existing one. Record what behavior deserves tests and what does not.

Complete when the specification can name observable test boundaries without prescribing test internals.

## 3. Draft proportionately

Use this shape:

```markdown
## Outcome

## Problem and context

## User-visible behavior

## Completion criteria

## Source repositories

## Implementation decisions

## Testing decisions

## Out of scope

## References
```

For ordinary work, use only the detail needed to remove implementation ambiguity. For a large product change, expand user-visible scenarios comprehensively. Do not manufacture a long user-story inventory to make the document look complete. Avoid file paths and code snippets unless a prototype produced a decision-rich state machine, schema, or type shape that prose would make less precise.

Complete when another fresh agent could judge scope and completion without the original conversation.

## 4. Approve

Show the full draft, proposed title, scope, and source repositories. Ask for one approval or revision pass. Do not publish before approval.

Complete when the user approves the exact artifact.

## 5. Publish

Create a `kind:task` issue in `m0hill/kaam-do` with the approved `scope:*` label, add it to the Kaam-dō Project, and set Status to `Planned`. Link the originating Wayfinder map or Notion ticket under References.

Read the issue and Project item back. Finish with its title and URL only after body, labels, Project membership, and Status are correct.
