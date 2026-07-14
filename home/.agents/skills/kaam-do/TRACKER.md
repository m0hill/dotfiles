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
4. Latest agent checkpoint — execution state and exact next action.
5. Source repository — branch, commits, diff, tests, and linked PR.
6. Current conversation — useful only after it agrees with durable state.

Do not leave a consequential decision only in chat. Update the stable issue contract when scope changes; use comments for execution checkpoints and evidence.

## Model

| Concept | Representation |
| --- | --- |
| Outcome/specification | Issue with `kind:task` |
| Independently finishable delivery | Native sub-issue with `kind:work-item` |
| Wayfinding map | `kind:task` plus `wayfinder:map` |
| Wayfinding decision | Native sub-issue with `kind:work-item` plus one `wayfinder:*` type |
| Ordering gate | Native issue dependency |
| Source implementation | Branch and PR in the source repository |
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
## Decisions
## Testing decisions
## Out of scope
## References
```

A work item records:

```markdown
## Parent
## What to deliver
## Acceptance criteria
## Source repository
## Context to load
## Constraints and decisions
## Execution anchors
```

The body is a stable contract, not a session log. Edit it only for an approved scope or contract change. Keep implementation discussion in the source PR.

## Agent checkpoints

Post a checkpoint after meaningful progress and before every session boundary. Use this exact shape so a fresh agent can find and parse the latest one:

```markdown
<!-- kaam-do:checkpoint -->
## Agent checkpoint

**State:** In progress | In review | Waiting
**Source repository:** owner/repo
**Branch:** branch-name
**Base commit:** full SHA
**Pull request:** URL or Not opened yet

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

Implementation complete is not delivery complete. An unmerged PR belongs in `In review`, not `Done`.

## Context loading protocol

Before starting or resuming a work item:

1. Read its body, labels, comments, Project fields, parent, children, blocked-by, and blocking relationships.
2. Read the parent specification and its references.
3. For each closed blocker, read its completion/resolution comment and linked contract or PR.
4. Read the latest checkpoint.
5. Verify the current checkout's `nameWithOwner` equals the ticket's `repo:*` label and Source repository.
6. Inspect the recorded branch, base commit, commits, working tree, diff, PR, CI, and relevant tests.
7. Resolve contradictions explicitly in a new checkpoint before implementation continues.

The context packet is complete when a fresh agent can explain the outcome, current state, inherited decisions, remaining acceptance criteria, and next action without chat history.

## Core issue commands

Create an issue with an explicit tracker and Project:

```bash
gh issue create --repo m0hill/kaam-do \
  --title "$title" --body-file "$body_file" \
  --label "$scope_label,$kind_label,$repo_label" \
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

Stop on repository mismatch or unrelated dirty work. Use a ticket branch such as `kaam-123-short-slug`. Record the branch and base SHA in the first checkpoint. Open a draft PR after the first meaningful pushed commit, then include its URL in subsequent checkpoints. Organization PRs do not need to link back to this private tracker.

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
- verify parent and dependency edges through the API;
- verify blocked=`Planned`, frontier=`Ready`, active=`In progress`;
- verify the latest checkpoint matches branch and PR evidence;
- report linked titles, not bare issue numbers.
