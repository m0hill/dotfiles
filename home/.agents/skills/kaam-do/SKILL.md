---
name: kaam-do
description: Manage work in the central Kaam-dō GitHub tracker. Use when creating or updating tasks, sub-issues, dependencies, priorities, or Project status from any source repository, or when another skill needs the Kaam-dō tracker contract.
---

# Kaam-dō

Kaam-dō separates **planning** from **execution**:

- Planning issues live in `m0hill/kaam-do`.
- Code, branches, CI, and pull requests live in their source repositories.
- The private `Kaam-dō` user Project is the daily control surface.

Read [TRACKER.md](TRACKER.md) before writing to the tracker.

## Direct tracker work

1. Identify the outcome, source repository, and `work` or `personal` scope from the request and current Git remote. Ask only when scope or destination is genuinely ambiguous.
2. Read the relevant parent, children, dependencies, and Project fields before changing them.
3. Apply the smallest requested mutation using the native issue relationship or Project field. Do not encode relationships in prose when GitHub has a native representation.
4. Read the changed issue and Project item back. Finish only when labels, relationships, and status match the request.

## Choosing a flow

- **Small and clear:** create a task or work item, then let the user control implementation and review.
- **Multi-session build:** `grill-me` → `to-spec` → `to-tickets`; the user starts each ticket separately.
- **Huge and foggy:** `wayfinder` → resolve decision frontier → `to-spec` → `to-tickets`.
- **Hard bug:** `diagnose` first; create implementation work only after the failure is understood.
- **Runnable design question:** use `prototype`, retain the answer, and keep throwaway code off the main branch.

Kaam-dō does not automatically implement tickets. It makes the next safe action visible and leaves starting it under user control.
