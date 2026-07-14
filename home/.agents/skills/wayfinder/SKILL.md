---
name: wayfinder
description: Chart a huge, foggy effort as a Kaam-dō map of decision sub-issues, then resolve one frontier decision per session until the work is ready for a specification.
disable-model-invocation: true
---

# Wayfinder

Wayfinding plans work too large or uncertain for one context window. It resolves **decisions**, not implementation deliverables. When the route becomes clear, hand off to `to-spec` and then `to-tickets`.

Read [MAP.md](MAP.md) for the map model and the [Kaam-dō tracker contract](../kaam-do/TRACKER.md) before writing.

Choose exactly one mode.

## Chart a map

1. **Name the destination.** Grill until the artifact or decision that ends wayfinding is precise enough to bound scope. If the whole route already fits one session, stop and recommend `grill-me` instead.
2. **Map breadth-first.** Surface sharp decision questions across the effort. Put foreseeable but still-unphraseable questions in Fog; put excluded work Out of scope.
3. **Approve the map.** Show the destination, initial decision tickets, blocker graph, Fog, and exclusions. Do not publish before user approval.
4. **Publish.** Create one `kind:task` map issue with `wayfinder:map`, inherited scope, and Status `In progress`. Create approved decisions as native `kind:work-item` children with one `wayfinder:*` type. Wire blockers in a second pass. Set frontier tickets to `Ready` and blocked tickets to `Planned`.
5. **Verify.** Read back the map, children, dependencies, labels, and statuses. Finish when the visible frontier matches the approved graph. Do not resolve a decision in the charting session.

## Work a map

1. Load the map at low resolution: Destination, Notes, Decisions so far, Fog, Out of scope, and open child summaries. Do not load every ticket body.
2. Select one open, unblocked, unassigned frontier decision unless the user named one. Assign it to the current user before doing decision work.
3. Resolve only that decision using its ticket type. Fetch related detail on demand; never answer the human side of a HITL ticket yourself.
4. Show the proposed resolution and map changes. After user approval where the ticket is HITL, post the resolution comment, close the ticket, and append one linked gist to Decisions so far.
5. Add newly sharp decisions, wire blockers, graduate clarified Fog, and move newly unblocked frontier tickets from `Planned` to `Ready`. Close and index anything newly ruled out of scope in Out of scope, not Decisions so far.
6. Read the map and frontier back. Finish after exactly one non-research decision is resolved and tracker state agrees with the reported map.

When no open decisions or Fog remain, the map is complete. Close it, set it to `Done`, and offer `to-spec`; do not begin implementation.
