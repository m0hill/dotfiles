---
name: diagnose
description: Diagnose bugs and regressions with a tight feedback loop plus state-space analysis when state matters. Use when debugging broken, failing, throwing, flaky, slow, racey, retry/recovery, or unexpected-state behavior, or when the user asks to analyze before fixing.
---

# Diagnose

A disciplined debugging loop. Build a tight signal, reproduce the real bug, model state when state matters, test falsifiable hypotheses, then fix with a regression test.

## Mode gate

First decide the mode and say it back briefly:

- **Analysis-only** when the user asks to analyze, investigate, map states, or not fix yet. Do not edit code. Stop after the state model, hypotheses, and findings.
- **Fix mode** when the user asks to fix/debug/diagnose a bug and has not forbidden edits. You may edit only after reproducing the bug and identifying the cause.

Before touching code, read `CONTEXT.md` and nearby ADRs if they exist so module names, tests, and findings use the project language.

## Phase 1 — Build a tight feedback loop

This is the skill. If you have a fast, deterministic, agent-runnable pass/fail signal for the bug, the rest is mechanical. Spend disproportionate effort here.

Try these in roughly this order:

1. **Failing test** at the seam that reaches the bug: unit, integration, or e2e.
2. **HTTP/curl script** against a running dev server.
3. **CLI invocation** with fixture input and expected output.
4. **Headless browser script** when UI, JavaScript, auth, console, network, or visual state matters.
5. **Replay captured input**: request payload, webhook, event log, trace, fixture, HAR.
6. **Throwaway harness** that exercises the bug path with minimal setup.
7. **Property/fuzz loop** for “sometimes wrong output.”
8. **Bisection/differential loop** for regressions between commits, versions, configs, or datasets.
9. **HITL loop** only when a human must click; copy and edit [scripts/hitl-loop.template.sh](scripts/hitl-loop.template.sh).

Tighten the loop until it is sharp enough:

- Faster: narrow scope, cache setup, skip unrelated startup.
- Sharper: assert the user-visible symptom, not just “didn't crash.”
- More deterministic: pin time, seed randomness, isolate filesystem/network, control concurrency.

For flaky bugs, raise the reproduction rate. Loop 100×, parallelize, add stress, inject sleeps, and narrow timing windows. A 50% flake is debuggable; a 1% flake usually is not.

If no loop is possible, stop. List what you tried and ask for access, logs, HAR/trace/core dump, screen recording with timestamps, or permission to add temporary instrumentation. Do not guess without a loop.

Completion criterion: you have a loop you believe goes red for the reported bug.

## Phase 2 — Reproduce and minimize

Run the loop and confirm:

- [ ] It produces the failure mode the user described, not a nearby different failure.
- [ ] It reproduces reliably, or often enough for a flaky bug.
- [ ] The exact symptom is captured: error, output diff, latency, state mismatch, UI evidence.

Minimize only after reproducing: shrink inputs, isolate the call path, or reduce setup while preserving the same failure.

Completion criterion: you can make the bug appear on demand, or you can explain precisely why you cannot.

## Phase 3 — Model the state space when state matters

Run this phase for stateful flows, lifecycle/status bugs, race conditions, retries, queues, external webhooks, recovery paths, stale derived state, permissions, feature flags, caches, persistence, or any bug where “what state are we in?” matters.

Build the model before proposing a fix:

1. Define the boundary: component, flow, function, job, UI, API, or integration.
2. Enumerate state variables: statuses, booleans, nullable fields, timestamps, counters, queues, locks, retries, permissions, feature flags, external IDs.
3. Identify sources of truth: persisted, cached, derived, in-memory, browser/client, worker, external service.
4. List valid states and invariants. Mark impossible, tolerated, and degraded states.
5. List events and inputs: user actions, API calls, writes, timers, retries, cancellations, duplicate/out-of-order events, restarts, webhooks, failures, timeouts.
6. Build transitions: from-state, event, expected next state, side effects, failure behavior.
7. Look for gaps: missing cases, unhandled branches, inconsistent combinations, invalid transitions, races, stale derived state, conflicting sources of truth, cleanup/rollback omissions.
8. Check intentionality: intentional, accidental, unspecified, or contradictory.

If the user requested analysis-only, report and stop here. Use this shape when helpful:

```md
## State-space analysis

### State variables
| Variable | Values | Source of truth | Notes |
| --- | --- | --- | --- |

### Valid states / invariants
| State | Intentional behavior | Evidence |
| --- | --- | --- |

### Transitions
| Event/input | From state | Expected next state | Current behavior | Risk |
| --- | --- | --- | --- | --- |

### Invalid or unexpected transitions
| Case | Why it can happen | Impact | Evidence |
| --- | --- | --- | --- |

### Findings
1. ...

### Open questions
- ...
```

Completion criterion: every relevant state variable, event, and suspicious transition has been accounted for, or explicitly marked unknown.

## Phase 4 — Hypothesize and instrument

Generate **3–5 ranked hypotheses** before testing any of them. Each must be falsifiable:

> If `<cause>` is true, then `<probe or change>` will produce `<observable result>`.

Show the ranked list to the user when practical. Proceed if they are AFK.

Test one variable at a time. Prefer:

1. Debugger/REPL inspection.
2. Targeted logs at boundaries that distinguish hypotheses.
3. Never “log everything and grep.”

Tag temporary logs with a unique prefix like `[DEBUG-a4f2]` so cleanup is mechanical.

For performance regressions, establish a baseline measurement first: timing harness, profiler, query plan, trace, or benchmark. Measure first, fix second.

Completion criterion: one hypothesis is confirmed by evidence, or the current hypothesis set is falsified and replaced with a better one.

## Phase 5 — Fix and regression-test

Only in fix mode:

1. Write a regression test before the fix if there is a correct seam.
2. Watch the regression test fail.
3. Apply the smallest fix that addresses the confirmed cause.
4. Watch the regression test pass.
5. Re-run the original feedback loop.

A correct seam exercises the real bug pattern as it occurs at the call site. If no correct seam exists, document that as an architecture finding instead of adding a shallow false-confidence test.

Prefer fixes that make invalid states impossible instead of scattering defensive checks. Model impossible states as impossible where the language, schema, or data model allows it.

Completion criterion: the original repro no longer reproduces, and the regression test passes or the missing seam is documented.

## Phase 6 — Cleanup and post-mortem

Before declaring done:

- [ ] Original feedback loop passes.
- [ ] Regression test passes, or lack of seam is documented.
- [ ] Temporary `[DEBUG-...]` instrumentation is removed.
- [ ] Throwaway harnesses/prototypes are deleted or clearly marked.
- [ ] The final explanation names the confirmed cause and the evidence.
- [ ] If architecture made the bug hard to test or fix, recommend a separate architecture cleanup rather than hiding it in the bug fix.
