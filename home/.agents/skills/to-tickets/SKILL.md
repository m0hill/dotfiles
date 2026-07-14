---
name: to-tickets
description: Break an approved specification into Kaam-dō tracer-bullet sub-issues with native blocking relationships.
disable-model-invocation: true
---

# To Tickets

Turn one approved specification into independently grabbable **tracer bullets**. Before reading or writing issues, read the [Kaam-dō tracker contract](../kaam-do/TRACKER.md).

## 1. Load the specification

Require a Kaam-dō parent issue URL or an unambiguous issue in the conversation. Read its body, comments, labels, existing children, dependencies, source repositories, domain glossary, and relevant ADRs. If it contains a Feature Contract, load the canonical convention, exact artifact revision or proposed owner, scenario corpus, consumers, and conformance commands.

Complete when the parent outcome, scope, source repositories, and existing work are accounted for without duplication.

## 2. Draft the graph

Each ticket must:

- deliver a narrow but complete, demonstrable path through the necessary layers;
- fit in one fresh agent context;
- target exactly one source repository and normally one reviewable PR;
- state the context, constraints, and inherited decisions a fresh agent must load;
- when a Feature Contract applies, name its revision, owned scenario IDs/interfaces/transitions, contract-change permission, and conformance command;
- have observable acceptance criteria with enough evidence requirements to decide completion;
- name only blockers that genuinely prevent starting or finishing it.

Conversation history is not a dependency. If a ticket cannot be executed from its body, parent, resolved blockers, linked repository, and durable docs, it is not ready to publish.

Prefer vertical slices over schema/API/UI layer tickets. A small prerequisite refactor is valid when it makes the change easy.

For a mechanical wide refactor that cannot land green vertically, use **expand–migrate–contract**: add the new form, migrate in independently green batches, then remove the old form after every migration.

Present the result as an ordered graph:

```text
Title
Source repository
What it delivers
Context to load
Feature Contract ownership
Blocked by
Acceptance criteria
```

Complete when every parent completion criterion is covered by at least one ticket, every ticket contributes to one criterion, and the graph has no accidental cycle.

## 3. Approve

Ask whether granularity and blocking edges are correct and whether anything should be merged or split. Iterate without publishing.

Complete when the user approves the exact ticket graph.

## 4. Publish

Create all issues first in dependency order, inheriting the parent's `scope:*` label and applying `kind:work-item` plus exactly one `repo:<owner>/<repository>` label. Create missing repository labels lazily. Use this body:

```markdown
## Parent

## What to deliver

## Acceptance criteria

## Source repository

## Context to load

## Constraints and decisions

## Feature Contract

**Parent:**
**Revision:** commit SHA, artifact version, `proposed`, or Not applicable
**Scenarios owned:**
**Interfaces consumed:**
**State transitions consumed:**
**May alter contract:** no | approved scope
**Conformance command:**

## Execution anchors
```

Then, in a second pass:

1. attach every issue as a native sub-issue of the specification;
2. add every native `blocked by` edge;
3. when an executable artifact is only proposed, make the first tracer bullet establish its smallest useful form together with one end-to-end behavior, and block consumers that cannot proceed without it;
4. set blocked tickets to `Planned`;
5. set the unblocked frontier to `Ready`.

Do not close or rewrite the parent specification.

## 5. Verify

Read back every issue and relationship through GitHub. Finish only when:

- every ticket has exactly one scope and kind label;
- every ticket is a native child of the parent;
- every approved blocking edge exists and no extra edge exists;
- every source repository is explicit and agrees with exactly one `repo:*` label;
- a fresh agent can load all required context without the originating conversation;
- Feature Contract ownership, revision, and conformance are explicit where applicable;
- no horizontal ticket creates an exhaustive speculative contract without delivering behavior;
- blocked tickets are `Planned` and frontier tickets are `Ready`.

Report the graph using linked titles, not a wall of issue numbers. Remind the user to start one frontier ticket in a fresh context when they choose; do not implement it.
