# Wayfinder map model

## Map issue

The map is an index, not a duplicate store. Decision detail lives in each child ticket; the map keeps only a linked one-line gist.

```markdown
## Destination

<What reaching the end of wayfinding produces.>

## Notes

<Domain, relevant skills, source repositories, standing constraints.>

## Decisions so far

- [Decision title](URL) — one-line gist

## Fog

<In-scope questions that are foreseeable but not yet precise enough to ticket.>

## Out of scope

<Work explicitly beyond this destination, with reasons and links when relevant.>
```

Refer to issues by linked title in human-facing prose. Numbers remain inside links, never as the primary name.

## Decision tickets

Every decision is a native sub-issue of the map, sized for one fresh context:

```markdown
## Question

<The single decision or investigation this ticket resolves.>

## Relevant sources

## Resolution

Resolution is initially empty; the accepted answer is posted as a comment before closure.
```

A session claims a decision by assigning it to the current user. The **frontier** is the map's open, unblocked, unassigned children.

## Types

Each decision has exactly one type label:

- `wayfinder:research` — AFK investigation of primary sources.
- `wayfinder:prototype` — HITL reaction to a cheap concrete artifact; use `prototype` for UI or logic code.
- `wayfinder:grilling` — HITL conversation resolving judgment or domain meaning.
- `wayfinder:task` — prerequisite work required before a decision can be made; HITL or AFK.

A HITL ticket cannot resolve without the human speaking for themselves. Research tickets may run in parallel; resolve at most one other decision per session.

## Blocking and frontier

Use native dependencies. A blocked decision is `Planned`; an open, unblocked, unclaimed decision is `Ready`; a claimed decision being worked is `In progress`.

Do not add an edge merely to express a preferred order. An edge means the blocked question cannot be answered responsibly until the blocker resolves.

## Fog of war

Fog is in scope but not yet sharp enough to become a ticket. The test is phrasing:

- If the question can be stated precisely now, create a ticket even when it is blocked.
- If resolving another decision may change what the question even is, keep it in Fog.

When a resolution sharpens Fog, remove that text and create the resulting decision tickets. One patch of Fog may become several tickets or none.

## Out of scope

Out of scope is excluded by the Destination, not merely unclear. It never graduates. If a live ticket turns out to be beyond the Destination, close it and add a linked explanation under Out of scope; do not index it under Decisions so far.

## Resolution

A resolved decision has one authoritative answer: its resolution comment. Then:

1. close the ticket;
2. append a linked one-line gist to Decisions so far;
3. update affected tickets and blocker edges;
4. graduate newly sharp Fog;
5. recompute the frontier and Project statuses.

The map completes when no live decisions or Fog remain and the route to the Destination is clear.
