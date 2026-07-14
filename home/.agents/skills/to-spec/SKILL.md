---
name: to-spec
description: Turn the current conversation into a proportionate specification and publish it as a Kaam-dō parent task.
disable-model-invocation: true
---

# To Spec

Turn settled conversation context into one buildable specification. Do not restart discovery; use `grill-me` or `wayfinder` first when important decisions remain open.

Before publishing, read the [Kaam-dō tracker contract](../kaam-do/TRACKER.md) and load `docs/FEATURE-CONTRACTS.md` from the tracker repository.

## 1. Gather

Read the current conversation, relevant code, `CONTEXT.md`/`CONTEXT-MAP.md`, applicable ADRs, and any originating Wayfinder map or Notion ticket. Identify the source repositories, work/personal scope, and execution policy for each repository. Propose `integration-branch` for work, where only the named integration branch may be published, and `pull-request` for personal, where ticket branches may be published. Require approval rather than inferring the branch allowlist.

Complete when every consequential claim in the draft can be traced to conversation, code, domain documentation, or an explicit reference.

## 2. Choose the test seam and contract level

Prefer an existing high-level public seam. Propose a new seam only when behavior cannot be tested coherently through an existing one.

Choose the smallest Feature Contract level that fits:

- **Narrative** — one straightforward implementation; acceptance criteria are sufficient.
- **Executable scenarios** — behavior must align across implementations, repositories, compatibility versions, or risky edge cases.
- **Stateful executable** — legal transitions, retries, cancellation, concurrency, or recovery are central.

Do not introduce a machine or shared scenario corpus merely to make the specification look rigorous. For executable levels, name the canonical owner, current or proposed artifact location, consumers, stable scenario IDs, and conformance commands.

Complete when observable test boundaries and the minimum justified contract level are explicit.

## 3. Draft proportionately

Use this shape:

```markdown
## Outcome

## Problem and context

## User-visible behavior

## Completion criteria

## Source repositories

## Execution policy

## Implementation decisions

## Testing decisions

## Feature Contract

<!-- Omit for Narrative unless owned boundaries need clarification. For executable levels, use the canonical Feature Contract template. -->

## Out of scope

## References
```

For ordinary work, use only the detail needed to remove implementation ambiguity. For a large product change, expand user-visible scenarios comprehensively. Do not manufacture a long user-story inventory to make the document look complete. Avoid file paths and code snippets unless a prototype produced a decision-rich state machine, schema, or type shape that prose would make less precise.

Complete when another fresh agent could judge scope and completion without the original conversation. For an executable contract, it must also be able to locate the canonical artifact or its proposed owner, identify required consumers, and run or plan the conformance command. Anything needed only from chat is still missing.

## 4. Approve

Show the full draft, proposed title, scope, source repositories, execution mode, branch publish allowlist, PR policy, and completion gate, Feature Contract level, canonical owner, and any proposed artifact. Ask for one approval or revision pass. Do not publish before approval.

Complete when the user approves the exact artifact.

## 5. Publish

Create a `kind:task` issue in `m0hill/kaam-do` with the approved `scope:*` label, one `repo:<owner>/<repository>` label for every known source repository, and the approved `execution:*` label when one mode applies to the task. Create missing repository labels lazily. For mixed policies, keep the per-repository body contract authoritative and omit a misleading single execution label from the parent. Add the issue to the Kaam-dō Project and set Status to `Planned`. Link the originating Wayfinder map or Notion ticket under References.

Read the issue and Project item back. Finish with its title and URL only after body, labels, repository identifiers, Project membership, and Status are correct.
