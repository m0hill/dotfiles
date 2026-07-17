---
name: prototype
description: Build a throwaway prototype to answer a design question. Use when the user wants to sanity-check whether a state model or logic feels right, or explore what a UI should look like.
disable-model-invocation: true
---

# Prototype

A prototype is **throwaway code that answers a question**. The question decides the shape.

## Pick a branch

Identify which question is being answered:

- **Does this logic or state model feel right?** Read [LOGIC.md](LOGIC.md) and build a tiny interactive terminal app that pushes difficult cases through the model.
- **What should this look like?** Read [UI.md](UI.md) and build structurally different UI variants switchable on one route.

If genuinely ambiguous, ask. If the user is unavailable, choose from the surrounding code and state the assumption.

## Shared rules

1. State the single question before writing code. Finish when the prototype can produce evidence about that question.
2. Mark the prototype as throwaway and locate it near the code it informs without disguising it as production code.
3. Make it runnable in one command using the project's existing runtime and task runner.
4. Keep state in memory unless persistence itself is the question.
5. Skip production polish, tests, speculative abstractions, and unrelated error handling.
6. Surface relevant state after every action or variant switch.
7. After the user reaches a verdict, fold only the validated decision into production work. Keep the prototype off main on a throwaway branch and link that primary source from the Kaam-dō issue.
8. If the question informs a Feature Contract, record the verdict on the parent issue: contract level, interface/state/scenario decision, affected consumers, and proposed canonical artifact. The prototype is evidence, never the canonical production contract.

A prototype is complete only when its question and verdict are recorded, any affected Feature Contract decision is durable, and the main branch contains no abandoned prototype surface.
