---
name: to-tickets
description: Break an approved specification into Kaam-dō tracer-bullet sub-issues with native blocking relationships.
disable-model-invocation: true
---

# To Tickets

Turn one approved specification into independently grabbable **tracer bullets**. Before reading or writing issues, read the [Kaam-dō tracker contract](../kaam-do/TRACKER.md).

## 1. Load the specification

Require a Kaam-dō parent issue URL or an unambiguous issue in the conversation. Read its body, comments, labels, existing children, dependencies, source repositories, domain glossary, and relevant ADRs.

Complete when the parent outcome, scope, source repositories, and existing work are accounted for without duplication.

## 2. Draft the graph

Each ticket must:

- deliver a narrow but complete, demonstrable path through the necessary layers;
- fit in one fresh agent context;
- target one source repository and normally one reviewable PR;
- have observable acceptance criteria;
- name only blockers that genuinely prevent starting or finishing it.

Prefer vertical slices over schema/API/UI layer tickets. A small prerequisite refactor is valid when it makes the change easy.

For a mechanical wide refactor that cannot land green vertically, use **expand–migrate–contract**: add the new form, migrate in independently green batches, then remove the old form after every migration.

Present the result as an ordered graph:

```text
Title
Source repository
What it delivers
Blocked by
Acceptance criteria
```

Complete when every parent completion criterion is covered by at least one ticket, every ticket contributes to one criterion, and the graph has no accidental cycle.

## 3. Approve

Ask whether granularity and blocking edges are correct and whether anything should be merged or split. Iterate without publishing.

Complete when the user approves the exact ticket graph.

## 4. Publish

Create all issues first in dependency order, inheriting the parent's `scope:*` label and applying `kind:work-item`. Use this body:

```markdown
## Parent

## What to deliver

## Acceptance criteria

## Source repository

## Execution links

## Notes
```

Then, in a second pass:

1. attach every issue as a native sub-issue of the specification;
2. add every native `blocked by` edge;
3. set blocked tickets to `Planned`;
4. set the unblocked frontier to `Ready`.

Do not close or rewrite the parent specification.

## 5. Verify

Read back every issue and relationship through GitHub. Finish only when:

- every ticket has exactly one scope and kind label;
- every ticket is a native child of the parent;
- every approved blocking edge exists and no extra edge exists;
- every source repository is explicit;
- blocked tickets are `Planned` and frontier tickets are `Ready`.

Report the graph using linked titles, not a wall of issue numbers. Remind the user to start one frontier ticket in a fresh context when they choose; do not implement it.
