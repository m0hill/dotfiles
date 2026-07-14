# Kaam-dō tracker contract

## Constants

```text
Tracker repository: m0hill/kaam-do
Project owner:       m0hill
Project number:      2
Project title:       Kaam-dō
```

Always pass `--repo m0hill/kaam-do` or `-R m0hill/kaam-do` to issue commands. Never let the current source repository implicitly select the tracker.

## Sources of truth

A fresh session trusts durable evidence in this order:

1. Issue body — stable outcome, scope, acceptance criteria, source repository, and constraints.
2. Parent specification and native relationships — wider intent, hierarchy, and gates.
3. Resolution/completion comments on closed blockers — decisions and contracts this ticket inherits.
4. Approved Feature Contract and canonical artifact revision, when present.
5. Latest agent checkpoint — execution state and exact next action.
6. Source repository — branch, commits, diff, tests, and linked PR.
7. Current conversation — useful only after it agrees with durable state.

Do not leave a consequential decision only in chat. Update the stable issue contract when scope changes; use comments for execution checkpoints and evidence.

## Feature Contracts

The canonical convention lives in `m0hill/kaam-do/docs/FEATURE-CONTRACTS.md`. Load it when a parent contains `## Feature Contract` or work spans implementations, repositories, compatibility versions, or meaningful state transitions:

```bash
gh api -H 'Accept: application/vnd.github.raw+json' \
  repos/m0hill/kaam-do/contents/docs/FEATURE-CONTRACTS.md
```

Kaam-dō owns approval, artifact links, revisions, and evidence. Source repositories own executable scenarios, interfaces, machines, and conformance commands. Do not copy executable artifacts into issues.

## Model

| Concept | Representation |
| --- | --- |
| Outcome/specification | Issue with `kind:task` |
| Independently finishable delivery | Native sub-issue with `kind:work-item` |
| Wayfinding map | `kind:task` plus `wayfinder:map` |
| Wayfinding decision | Native sub-issue with `kind:work-item` plus one `wayfinder:*` type |
| Ordering gate | Native issue dependency |
| Source implementation | Policy-controlled local branch or source PR |
| Execution policy | `execution:*` label plus issue-body contract |
| Mutable planning state | Project fields |
| Cross-session execution state | Append-only checkpoint comments |

Every issue has exactly one scope label (`scope:work` or `scope:personal`) and one kind label (`kind:task` or `kind:work-item`). Children inherit scope.

## Repository and area labels

Use `repo:<owner>/<repository>` as the machine-readable execution location, for example `repo:acme/billing-api`.

- A delivery work item normally has exactly one `repo:*` label.
- A cross-repository parent may have several.
- A decision with no known execution location may have none.
- The label must agree with **Source repository** in the body.
- Create labels lazily when a repository first appears.

```bash
repo_label="repo:$source_repo"
gh label create "$repo_label" --repo m0hill/kaam-do --force \
  --color BFDADC --description "Work executed in $source_repo"
```

Use optional `area:<name>` only for a recurring product/domain that may cross repositories. Do not use labels for status, priority, dates, branches, sessions, or blockers.

## Execution policy

Every executable task or work item has exactly one stable execution label:

- `execution:integration-branch` — only the specified integration branch may be published; agents may use any local branches but must not publish them.
- `execution:pull-request` — ticket branches may be published and delivered through their own PRs.

Scope provides only a proposed default:

```text
scope:work     → execution:integration-branch
scope:personal → execution:pull-request
```

The approved parent specification is authoritative. Each child inherits the policy for its source repository. Before publishing a branch or creating a PR, verify that its head branch is allowed by the policy.

Record details in the issue body:

```markdown
## Execution policy

- Mode: integration-branch | pull-request
- Integration branch or PR base: branch-name
- Published branches: integration branch only | ticket branches allowed
- Pull requests: integration branch only | ticket branches allowed | not required
- Local branches: unrestricted
- Ticket completion gate: explicit evidence
- Parent completion gate: explicit evidence
```

For a multi-repository parent, record one policy block per repository. The execution label is an index; this body section is the full contract. They must agree.

## Status

```text
Inbox       captured but not clarified
Planned     clear, but blocked or not on the actionable frontier
Ready       clear and unblocked
In progress claimed and actively being worked or awaiting session resume
In review   implementation complete; awaiting review, CI, or merge
Waiting     waiting on a non-issue external event
Done        delivered and acceptance criteria verified
```

A native issue blocker means `Planned`, not `Waiting`. Closing a blocker does not automatically promote dependents; every finish operation must recompute the affected frontier.

## Stable issue bodies

A task/specification records:

```markdown
## Outcome
## Problem and context
## Completion criteria
## Source repositories
## Execution policy
## Decisions
## Testing decisions
## Feature Contract (when applicable)
## Out of scope
## References
```

A work item records:

```markdown
## Parent
## What to deliver
## Acceptance criteria
## Source repository
## Execution policy
## Context to load
## Constraints and decisions
## Feature Contract (when applicable)
## Execution anchors
```

The body is a stable contract, not a session log. Edit it only for an approved scope or contract change. Keep implementation detail in the policy-approved source branch, commits, and PR when one exists.

## Agent checkpoints

Post a checkpoint after meaningful progress and before every session boundary. Use this exact shape so a fresh agent can find and parse the latest one:

```markdown
<!-- kaam-do:checkpoint -->
## Agent checkpoint

**State:** In progress | In review | Waiting
**Source repository:** owner/repo
**Execution mode:** integration-branch | pull-request
**Integration branch / PR base:** branch-name
**Working branch:** branch-name
**Base commit:** full SHA
**Head commit:** full SHA or Uncommitted
**Published branches:** integration branch only | ticket branches allowed
**Pull request:** URL, Not opened yet, or Not required

### Completed
- Durable results already achieved.

### Decisions and discoveries
- Facts that change how the remaining work should be approached.

### Verification
- Command — result

### Remaining
- Work still required by the acceptance criteria.

### Next action
- One exact command, file investigation, or decision for the next agent.

### Feature Contract

**Revision loaded:** revision | Not applicable
**Scenarios:** result | Not applicable
**Conformance:** command — result | Not applicable
**Structural drift:** none | description
**Proposed changes:** none | link

### Risks or blockers
- None, or explicit owner/event and next-check condition.
```

Find the latest checkpoint:

```bash
gh issue view "$issue" --repo m0hill/kaam-do --json comments \
  --jq '[.comments[] | select(.body | contains("<!-- kaam-do:checkpoint -->"))] | last'
```

A checkpoint must describe current evidence, not paste a transcript or speculate about future implementation.

## Completion comments

Before closing, post:

```markdown
<!-- kaam-do:completion -->
## Completion

### Delivered
- Observable result.

### Execution
- PR/commit/release links.

### Acceptance evidence
- Criterion — evidence.

### Verification
- Command or check — result.

### Follow-up
- None, or linked separately tracked work.
```

Completion follows the issue's execution policy. Pull-request work is not delivered until its ticket-branch PR gate is met. Integration-branch work completes when its commits are pushed to the specified integration branch and required checks pass; a per-ticket PR or merge is not required.

## Context loading protocol

Before starting or resuming a work item:

1. Read its body, labels, comments, Project fields, parent, children, blocked-by, and blocking relationships.
2. Read the parent specification and its references.
3. For each closed blocker, read its completion/resolution comment and linked contract or PR.
4. If the parent has a Feature Contract, load its exact revision, owned scenarios/interfaces/transitions, canonical artifacts, and conformance commands.
5. Read the latest checkpoint.
6. Verify the current checkout's `nameWithOwner` equals the ticket's `repo:*` label and Source repository.
7. Read the execution label and body policy before any branch or remote operation.
8. Inspect the recorded integration/base branch, working branch, commits, working tree, diff, optional PR/CI, and relevant tests.
9. Resolve contradictions explicitly in a new checkpoint before implementation continues.

The context packet is complete when a fresh agent can explain the outcome, current state, inherited decisions, remaining acceptance criteria, and next action without chat history.

## Core issue commands

Create an issue with an explicit tracker and Project:

```bash
gh issue create --repo m0hill/kaam-do \
  --title "$title" --body-file "$body_file" \
  --label "$scope_label,$kind_label,$repo_label,$execution_label" \
  --project "Kaam-dō"
```

Fetch native relationships:

```bash
gh issue view "$issue" --repo m0hill/kaam-do --comments
gh api "repos/m0hill/kaam-do/issues/$number/sub_issues"
gh api "repos/m0hill/kaam-do/issues/$number/dependencies/blocked_by"
gh api "repos/m0hill/kaam-do/issues/$number/dependencies/blocking"
```

Attach an existing child:

```bash
child_id="$(gh api "repos/m0hill/kaam-do/issues/$child_number" --jq .id)"
gh api --method POST \
  "repos/m0hill/kaam-do/issues/$parent_number/sub_issues" \
  -F sub_issue_id="$child_id"
```

Add a dependency:

```bash
blocker_id="$(gh api "repos/m0hill/kaam-do/issues/$blocker_number" --jq .id)"
gh api --method POST \
  "repos/m0hill/kaam-do/issues/$blocked_number/dependencies/blocked_by" \
  -F issue_id="$blocker_id"
```

Create issues first and wire relationships in a second pass. API bodies require numeric database IDs, not issue numbers or GraphQL node IDs.

## Project fields

Auto-add normally inserts open issues. If missing:

```bash
gh project item-add 2 --owner m0hill --url "$issue_url"
```

Resolve IDs live before editing a field:

```bash
project_id="$(gh project view 2 --owner m0hill --format json --jq .id)"
item_id="$(gh project item-list 2 --owner m0hill --limit 1000 --format json \
  --jq ".items[] | select(.content.url == \"$issue_url\") | .id")"
status_field_id="$(gh project field-list 2 --owner m0hill --format json \
  --jq '.fields[] | select(.name == "Status") | .id')"
status_option_id="$(gh project field-list 2 --owner m0hill --format json \
  --jq ".fields[] | select(.name == \"Status\") | .options[] | select(.name == \"$status\") | .id")"

gh project item-edit --id "$item_id" --project-id "$project_id" \
  --field-id "$status_field_id" \
  --single-select-option-id "$status_option_id"
```

Use live lookup for `Priority` and `Effort`; use `--date YYYY-MM-DD` for `Target date`. Never hardcode option IDs.

## Source repository safety

Verify location before source writes:

```bash
source_repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
git remote get-url origin
git status --short --branch
```

Stop on repository mismatch, unrelated dirty work, a missing execution policy, or disagreement between policy label and body.

For `execution:integration-branch`:

1. use the specified integration branch directly, or any temporary local branch;
2. integrate local side-branch commits into the integration branch before completing the ticket;
3. publish only the integration branch—never push a local ticket, scratch, or side branch;
4. pushes may contain partial commits, and a draft PR is allowed when its head is the integration branch;
5. before closing, verify the completion SHA is reachable from `origin/<integration-branch>` and required checks pass; a per-ticket merge is not required.

For `execution:pull-request`:

1. create a ticket branch such as `kaam-123-short-slug` from the approved base;
2. record branch and base SHA in the first checkpoint;
3. publish that ticket branch and open its PR;
4. close only when the PR completion gate is met.

Organization PRs do not need to link back to this private tracker.

## Frontier reconciliation

After closing or reopening an issue:

1. fetch issues it was blocking;
2. fetch each dependent's currently open blockers;
3. move an open dependent to `Ready` only when none remain;
4. otherwise keep it `Planned`;
5. inspect the parent: move it to `In progress` while delivery is active, but close it only when its own outcome criteria are true.

## Verification

After every mutation batch:

- read changed issues back;
- verify exactly one scope and kind label;
- verify `repo:*` agrees with Source repository;
- verify exactly one `execution:*` label agrees with the body policy on executable issues;
- verify no branch outside the policy's publish allowlist was pushed;
- verify parent and dependency edges through the API;
- verify blocked=`Planned`, frontier=`Ready`, active=`In progress`;
- verify the latest checkpoint matches branch and PR evidence;
- verify Feature Contract revision and conformance evidence when applicable;
- report linked titles, not bare issue numbers.
