---
name: justify-complexity
description: Prevent speculative defenses during implementation, or review code for unnecessary validation, fallbacks, compatibility paths, and abstractions.
---

# Justify Complexity

Build the simplest complete behavior that satisfies the request and real
contracts. Optimize for what a maintainer must understand, not minimum lines
or diff size. Keep review requests read-only unless changes are requested.

Before adding complexity, identify the concrete caller, input, invariant,
protocol obligation, persisted state, or failure path it serves. A plausible
path is enough; a past incident is not required. “It might be useful” is not.
Use this to make decisions, not to produce a justification ledger.

- Establish each input guarantee at its owning boundary and preserve it
  downstream. A cast alone establishes no runtime guarantee. Recheck only
  when a new boundary, state change, or distinct rule creates an obligation.
- Give each check one purpose and owner. Client feedback and server
  authorization may look similar while enforcing different obligations.
- Recover only when the fallback is valid product behavior. Otherwise use
  the established error path. Empty data must not disguise a failed request.
- Add an abstraction when it hides meaningful policy or required variation.
  Remove forwarding layers that merely rename the same operation.
- Keep compatibility for identified callers, persisted formats, or rollout
  requirements. Remove obsolete producers and consumers together.
- Prefer representations that eliminate invalid combinations when they
  clarify current behavior. Stop before building a generic type framework.

When reviewing suspected excess:

1. Trace its producer, contract, and consumers.
2. Explain what happens without it and which obligations must remain.
3. Recommend a concrete simplification that reduces total complexity while
   preserving those obligations.

Report only material findings: location, concrete risk and evidence,
unnecessary cost, simpler replacement, and any specific unresolved fact.
Distinguish supported removals from conditional proposals.
No findings is a valid result.

For authorized implementation, complete the affected behavior and run
checks covering its real risks, including required project checks.
Stop when the contract is preserved and the identified excess is gone.
