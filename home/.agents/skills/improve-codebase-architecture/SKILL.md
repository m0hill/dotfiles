---
name: improve-codebase-architecture
description: "Codebase-wide architecture review for deepening opportunities: shallow modules, weak seams, tangled callers, and testability gaps. Use when the user asks to improve architecture, find refactor opportunities across modules, or make a codebase easier to test or navigate. Not for local PR cleanup."
disable-model-invocation: true
---

# Improve Codebase Architecture

Find global architecture friction and propose **deepening opportunities**: refactors that turn shallow modules into deeper ones with better leverage, locality, and test seams.

This is not a local code review:

- Use `code-review` for a diff, PR, file, or local slop/reuse review.
- Use `quality-code` as the TypeScript/full-stack implementation quality bar.
- Use this skill when the question is broader: module shape, seams, repeated friction across callers, testability gaps, or architecture that makes agents/humans bounce around.

## Vocabulary

Use these terms consistently. Full definitions live in [LANGUAGE.md](LANGUAGE.md).

- **Module** — anything with an interface and an implementation: function, class, package, slice.
- **Interface** — everything callers must know: types, invariants, ordering, errors, config, performance.
- **Implementation** — the code inside the module.
- **Depth** — leverage at the interface. Deep modules hide a lot of behavior behind a small interface.
- **Seam** — where an interface lives; a place behavior can be altered without editing in place.
- **Adapter** — a concrete thing satisfying an interface at a seam.
- **Leverage** — what callers get from depth.
- **Locality** — what maintainers get from depth: change and bugs concentrate in one place.

Core tests:

- **Deletion test**: if deleting the module makes complexity vanish, it was pass-through waste; if complexity reappears across callers, it was earning its keep.
- **Interface is the test surface**: tests should cross the same seam callers use.
- **One adapter = hypothetical seam; two adapters = real seam**: avoid fake ports with only one adapter.

## Process

### 1. Establish scope

Clarify whether the user wants:

- a whole-codebase architecture review,
- one subsystem/module reviewed,
- refactor candidates after a bug or review revealed friction,
- or help designing a specific deeper module.

If scope is clear, do not ask. If scope is too broad, propose a concrete slice to inspect first.

### 2. Read durable context

Before judging architecture, read what exists:

- `AGENTS.md`, README, or other project docs for conventions.
- `CONTEXT.md` or `CONTEXT-MAP.md` for domain language, if present.
- `docs/adr/` and nearby ADRs for decisions not to re-litigate.
- Existing tests around the area; tests reveal the real seams.

Use the project's domain words in findings. If a concept is named in `CONTEXT.md`, use that name instead of inventing a new one.

### 3. Explore friction

Walk the codebase with normal tools: `rg`, `find`, `read`, language-aware tools when available, and focused test searches. Sample callers before judging an interface.

Look for friction you actually experience:

- Understanding one concept requires bouncing between many small modules.
- A module's interface is nearly as complex as its implementation.
- Helpers exist only so tests can reach internals, while real behavior is assembled elsewhere.
- Callers repeat sequencing, parsing, authorization, error handling, retries, or state transitions.
- Multiple modules change together because their seams leak.
- Tests mock internals instead of crossing a real interface.
- There is only one adapter behind a port, or no local substitute where tests need one.
- A bug fix was hard because state or behavior had no single owner.

Do not force a refactor because a file is large. Size is not the smell; low leverage and poor locality are.

### 4. Classify dependency shape

For each promising candidate, classify dependencies using [DEEPENING.md](DEEPENING.md):

1. **In-process** — pure/in-memory; usually easiest to deepen.
2. **Local-substitutable** — local test stand-ins exist; test through the deep module with the stand-in.
3. **Remote but owned** — use a port at the seam with production and test adapters.
4. **True external** — inject a port and test with a mock/fake adapter.

This prevents shallow advice like “just extract a service” without a test strategy.

### 5. Present candidates before editing

Do not start moving architecture around immediately. Present a ranked list first.

For each candidate include:

1. **Modules/files** involved.
2. **Problem**: the current friction, grounded in evidence.
3. **Current interface burden**: what callers/tests must know today.
4. **Deepening move**: what should sit behind the seam instead.
5. **Benefits** in terms of leverage, locality, and testing.
6. **Dependency/test strategy** from the dependency classification.
7. **Risk/scope**: likely blast radius and safest first slice.

Ask: “Which candidate should we explore or implement?”

### 6. Explore a chosen candidate

Once the user picks one, grill the design:

- What behavior belongs behind the seam?
- What must remain outside because it varies by caller?
- Which invariants should the module own?
- What errors should cross the interface?
- Which tests should survive internal refactors?
- Which adapter shapes are real, not hypothetical?

If the user wants multiple interface options, read [INTERFACE-DESIGN.md](INTERFACE-DESIGN.md) and produce alternatives before recommending one.

If a new domain term or rejected architecture decision should be durable, offer to update `CONTEXT.md` or add an ADR. Do not silently write architecture docs unless the user agrees.

### 7. Implement only on request

If the user asks to implement, keep the first slice small:

- Preserve behavior.
- Add or move tests to the new interface seam.
- Delete obsolete shallow tests only after the deep-interface tests cover the behavior.
- Avoid broad migrations unless explicitly requested.
- Leave follow-up candidates as notes instead of hiding extra architecture churn in the first change.

## Output format

Start with one of:

- `no architecture issue found` — current shape is fine for the inspected scope.
- `local cleanup only` — issues are local review findings, not architecture work.
- `architecture candidates found` — list ranked candidates.

Then provide the candidate list or the chosen design plan.
