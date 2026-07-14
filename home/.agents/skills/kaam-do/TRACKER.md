# Kaam-dō tracker contract

## Constants

```text
Tracker repository: m0hill/kaam-do
Project owner:       m0hill
Project number:      2
Project title:       Kaam-dō
```

Always pass `--repo m0hill/kaam-do` (or `-R`) to issue commands. Never let the current source repository implicitly select the issue tracker.

## Model

| Concept | Representation |
| --- | --- |
| Outcome/specification | Issue with `kind:task` |
| Independently finishable delivery | Native sub-issue with `kind:work-item` |
| Wayfinding map | `kind:task` plus `wayfinder:map` |
| Wayfinding decision | Native sub-issue with `kind:work-item` plus one `wayfinder:*` type |
| Ordering gate | Native issue dependency |
| Source implementation | Branch and PR in the linked source repository |
| Mutable planning state | Project fields |

Every issue has exactly one scope label (`scope:work` or `scope:personal`) and one kind label (`kind:task` or `kind:work-item`). Children inherit their parent's scope.

Optional recurring domains use one `area:<name>` label. Do not create labels for status, priority, dates, branches, or blockers.

## Status

```text
Inbox      captured but not clarified
Planned    clear, but blocked or not on the actionable frontier
Ready      clear and unblocked
In progress actively being worked
In review  awaiting review, CI, or merge
Waiting    waiting on a non-issue external event
Done       completed
```

A native issue blocker means `Planned`, not `Waiting`. `Waiting` is only for people, approvals, dates, vendors, credentials, or other non-issue events.

## Issue bodies

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
## Execution links
## Notes
```

Keep implementation detail in the source PR. The tracker owns outcome, hierarchy, dependencies, priority, and durable decisions.

## Core commands

Create issues with an explicit tracker and Project:

```bash
gh issue create --repo m0hill/kaam-do \
  --title "$title" \
  --body-file "$body_file" \
  --label "$scope_label,$kind_label" \
  --project "Kaam-dō"
```

Fetch an issue with relationships:

```bash
gh issue view "$issue" --repo m0hill/kaam-do --comments
gh api "repos/m0hill/kaam-do/issues/$number/sub_issues"
gh api "repos/m0hill/kaam-do/issues/$number/dependencies/blocked_by"
gh api "repos/m0hill/kaam-do/issues/$number/dependencies/blocking"
```

Add an existing child as a native sub-issue:

```bash
child_id="$(gh api "repos/m0hill/kaam-do/issues/$child_number" --jq .id)"
gh api --method POST \
  "repos/m0hill/kaam-do/issues/$parent_number/sub_issues" \
  -F sub_issue_id="$child_id"
```

Make one issue depend on another:

```bash
blocker_id="$(gh api "repos/m0hill/kaam-do/issues/$blocker_number" --jq .id)"
gh api --method POST \
  "repos/m0hill/kaam-do/issues/$blocked_number/dependencies/blocked_by" \
  -F issue_id="$blocker_id"
```

Create issues first and wire relationships in a second pass. API bodies require numeric database IDs, not issue numbers or GraphQL node IDs.

## Project fields

Auto-add normally inserts new issues. If an issue is missing:

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

gh project item-edit \
  --id "$item_id" \
  --project-id "$project_id" \
  --field-id "$status_field_id" \
  --single-select-option-id "$status_option_id"
```

Use the same live lookup for `Priority` and `Effort`; use `--date YYYY-MM-DD` for `Target date`. Never hardcode field option IDs.

## Source repository safety

Before source-code work, compare the ticket's **Source repository** with:

```bash
git remote get-url origin
gh repo view --json nameWithOwner --jq .nameWithOwner
```

Stop on mismatch. A Kaam-dō issue may link outward to an organization PR; the PR does not need to link back to this private tracker.

## Verification

After every batch:

- read each created/edited issue back;
- verify exactly one scope and kind label;
- verify parent-child and blocker edges through the API;
- verify blocked tickets are `Planned` and frontier tickets are `Ready`;
- report issue names with URLs, not bare numbers.
