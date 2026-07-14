---
name: kaam-do
description: Operate the central Kaam-dō agent work queue. Use when capturing, normalizing, starting, resuming, checkpointing, reviewing, or finishing tracked work across source repositories, or when another skill needs the tracker contract.
---

# Kaam-dō

Kaam-dō is durable memory for agents whose conversation context is disposable:

- planning issues live in `m0hill/kaam-do`;
- code, branches, CI, and PRs live in source repositories;
- issue bodies hold stable contracts;
- comments hold append-only checkpoints and completion evidence;
- native relationships and Project fields hold current workflow state.

Read [TRACKER.md](TRACKER.md) before any tracker write. When the parent has a Feature Contract, load the canonical contract convention and exact artifact revision before source work.

## Choose one operation

### Capture or normalize

Identify scope, kind, source repositories, outcome, and acceptance criteria. Create or repair the issue using native relationships and stable labels. Finish only when a fresh agent could route the issue without the current conversation.

### Start

Load the full context packet. Refuse to start unless the ticket is open, `Ready`, unblocked, and the current checkout matches its single `repo:*` label and **Source repository**. If a Feature Contract applies, state the revision, owned scenarios/interfaces/transitions, conformance command, and delegation boundary. Refuse to switch branches over unrelated dirty work.

Assign `@me`, move the ticket and parent to `In progress`, create or reuse a ticket branch, and post an initial checkpoint containing the base commit and exact next action. Do not implement work merely because lifecycle setup is complete.

### Resume

Load the full context packet plus the latest checkpoint, branch, PR, commits since the recorded base, current diff, and verification results. Reconcile stale tracker claims and Feature Contract revision against repository evidence before changing anything. Continue from the checkpoint's next action rather than reconstructing the plan from conversation history.

### Checkpoint

Post the checkpoint template from the tracker contract after a meaningful milestone and before stopping, compacting, switching sessions, waiting externally, or handing off. Update Project status to match reality. A checkpoint is complete only when a fresh agent can name the next command or decision without this conversation.

### Finish

If implementation is complete but not delivered, record verification and move to `In review`; do not close the issue. Close only after delivery, acceptance evidence, and required Feature Contract conformance exist. Post a completion comment with contract revision and scenario IDs when applicable, close the issue, verify `Done`, recompute directly affected dependencies, promote newly unblocked tickets to `Ready`, and check the parent outcome. Never infer parent completion only from closed children.

### Reconcile the queue

Read open items and native dependency summaries. Keep blocked work `Planned`, unblocked actionable work `Ready`, active work `In progress`, and externally waiting work `Waiting`. Treat source branches, PRs, and checkpoints as evidence when tracker state appears stale.

## Choosing planning depth

- **Small and clear:** capture one task or work item.
- **Multi-session build:** `grill-me` → `to-spec` → `to-tickets`.
- **Huge and foggy:** `wayfinder` → decision frontier → `to-spec` → `to-tickets`.
- **Hard bug:** `diagnose` first; track implementation after the failure is understood.
- **Runnable design question:** `prototype`; retain the verdict and keep throwaway code off main.

Kaam-dō owns lifecycle and handoff, not autonomous implementation. The user chooses a frontier ticket; agents make every subsequent state transition explicit and recoverable.
