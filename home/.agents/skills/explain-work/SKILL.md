---
name: explain-work
description: Produce a plain-language explanation of agent work for human review, covering actual behavior, consequential decisions, changed contracts, risks, and verification, with a small visual when useful.
---

Explain the actual work so the user can judge it without reading code.

Your output is a review report. Ground it in the request, final artifacts,
recorded decisions, and observed verification results. Use focused read-only
inspection to resolve gaps in the explanation. Report remaining implementation
work explicitly.

## What to preserve

Include anything that could change the user's judgment of:

- What the system does.
- Whether the requested scope was completed correctly.
- Whether the design choices and trade-offs are acceptable.
- Whether existing callers, users, or data remain compatible.
- Whether the work is ready to use.

Remove repetition, routine activity, and implementation details that do not
help the user make those judgments.

## Build the report in this order

Use these sections for substantial work. For a small change, combine them
into a short paragraph. Omit sections with no meaningful content.

### Result

State what changed, its practical effect, and whether the requested work
is complete. Name omitted or partially implemented requirements.

Surface any known issue that prevents safe or correct use here.

### How it works

Explain the main flow: trigger → important steps → outcome.
Include failure or recovery behavior when it changes what the user can expect.

Use a concrete example or before-and-after comparison where helpful.
For structural changes, explain how responsibilities changed and whether
observable behavior stayed the same.

Describe relevant public APIs or shared contracts that were added, changed,
or removed. Give their users, essential input/output shapes, and a compact
example. Include consequential errors, side effects, identity boundaries,
or persistence rules. Explain compatibility and migration effects.

### Decisions and trade-offs

Identify consequential choices made beyond the specification.
For each, explain the reason and practical benefit or cost.

Distinguish requirements, agent choices, and assumptions made because
information was missing. For consequential assumptions, state what depends
on them and what needs confirmation.

Include known limitations and concrete risks alongside the decision or
behavior that creates them.

### Verification

State which checks ran, their results, and what they actually establish.
Include relevant failures and unverified behavior.

Distinguish static checks, tests using substitutes, integration checks,
and direct runtime observation. Passing one does not establish the others.

### Your attention

Identify specific behavior or trade-offs worth reviewing.

If a user decision remains, give the question, your recommendation, and
its consequence. Distinguish that decision from an implementation defect
or unfinished work. If no decision remains, omit this section.

## Evidence and uncertainty

Describe observed facts as facts and inferences as inferences.
A name such as "fallback" or "retry" is not evidence of its exact behavior.

Use recorded rationale when explaining why a choice was made. If the reason
is unavailable, say so rather than inventing a justification.

Place useful evidence links beside consequential claims. Explain what the
evidence shows in the report itself; following the link should be optional.

Use synthetic examples and redact sensitive values.

## Visuals

Add a small inline visual when it makes the explanation easier to understand:

- A flow or sequence diagram for interactions and ordering.
- A state diagram for transitions and recovery.
- A shallow tree for ownership or structure.
- A small diff for a change in an established shape.
- A table for contracts or trade-offs.

Choose the smallest view that answers the reader's question. Use concrete
labels and preserve important failure paths. Mark proposed or unverified
behavior explicitly.

Place the visual beside the text it supports. Prefer chat-native output;
use a separate HTML artifact only when requested or when the explanation
requires interaction or a spatial view that inline formats cannot provide.

## Final coverage check

Compare the report with the request and final artifacts. Ensure it accounts
for material changes, incomplete scope, consequential choices, compatibility
effects, and verification gaps.

Then remove duplication and unnecessary terminology. Keep the result and
most important concerns easy to find.
