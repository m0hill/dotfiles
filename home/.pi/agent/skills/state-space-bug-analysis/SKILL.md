---
name: state-space-bug-analysis
description: Performs explicit state-space analysis for bugs and stateful behavior without applying fixes. Use when investigating bugs, unexpected behavior, race conditions, retries/failures, recovery paths, or when user asks to analyze states before fixing.
---

# State-Space Bug Analysis

## Default stance

Before proposing or making any bug fix, analyze the system's state space. The goal is to find the full set of possible problems, not to patch the observed symptom.

This skill is analysis-only by default:

- Do not edit code.
- Do not implement fixes.
- Do not refactor while investigating.
- Stop after documenting states, transitions, invalid cases, and likely root causes.

Only move from analysis to implementation if the user explicitly asks for fixes after reviewing the findings.

## Workflow

1. Define the boundary of the system being analyzed.
   - What component, flow, function, job, UI, API, or integration owns the behavior?
   - What is the observed symptom?
   - What state is persisted, cached, derived, or held in memory?

2. Enumerate state variables.
   - Status fields, booleans, nullable fields, timestamps, counters, queues, locks, retries, permissions, feature flags, external IDs.
   - Include external state from databases, services, browsers, clients, workers, or background jobs.

3. Identify valid states and invariants.
   - Which state combinations are intentional?
   - Which combinations should be impossible?
   - Which combinations are tolerated but degraded?

4. Identify events and inputs.
   - User actions, API calls, database writes, timers, retries, cancellations, concurrent requests, worker restarts, external webhooks, failures, and timeouts.

5. Build the transition model.
   - For each event, list the starting state, expected next state, side effects, and failure behavior.
   - Include retry, partial-success, timeout, cancellation, duplicate event, and out-of-order event paths.

6. Look for gaps.
   - Missing cases
   - Unhandled branches
   - Inconsistent state combinations
   - Invalid or unexpected transitions
   - Race conditions
   - Retry/failure/recovery bugs
   - Stale derived state
   - Conflicting sources of truth
   - Cleanup or rollback omissions

7. Check intentionality.
   - For every state and transition, determine whether the current behavior appears intentional, accidental, unspecified, or contradictory.

8. Report findings without fixing.
   - Prefer a state table, transition table, decision table, or simple state machine.
   - Separate confirmed bugs from suspicious cases and open questions.
   - Explain why each issue can occur and what evidence supports it.

## Output format

Use this structure when practical:

```md
## State-space analysis

### State variables
| Variable | Possible values | Source of truth | Notes |
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

## Design preference for later fixes

If the user later asks for a fix, prefer designs that prevent invalid states architecturally instead of scattering defensive checks across the codebase. Model impossible states as impossible where the language, schema, or data model allows it.
