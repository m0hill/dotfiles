---
name: boring-code
description: Enforces boring, direct, locality-first coding choices and resists unnecessary abstraction. Use when writing or refactoring any code, especially when deciding whether to add helpers, wrappers, validators, generic utilities, or future-proofing layers.
disable-model-invocation: true
---

# Boring Code

## Default stance

Write boring, direct, locality-first code. Prefer code that the next engineer can understand by reading the current file top-to-bottom.

Favor:

- Inline logic when it is only used once.
- Clear, explicit code over clever DRY abstractions.
- Small amounts of duplication when it keeps each call site easier to understand.
- Domain names for real domain concepts, not cosmetic tidiness.

Avoid:

- Helpers extracted only to make code “look cleaner.”
- Unnecessary abstraction, indirection, wrappers, and generic utilities.
- Over-validation or defensive layers away from real trust boundaries.
- “Future-proofing” for needs that do not exist yet.

## Before adding a helper or abstraction

Ask these questions:

1. Is this used more than once?
2. Does this name capture an important domain idea?
3. Does this make the caller easier to understand?
4. Would the code be harder to follow if this stayed inline?

If the answer is no, keep the code inline.

## Validation rule

Validate at real trust boundaries:

- User input
- API input
- Database input
- External service responses
- Files or environment variables from outside the program

Do not add validation layers merely because data crosses an internal function boundary that already receives typed, trusted values.

## Review checklist

Before finishing code changes, scan for slop:

- [ ] Did I add a helper that is only called once?
- [ ] Did I add an abstraction without a domain name or repeated use?
- [ ] Did I hide simple logic behind a generic utility?
- [ ] Did I add defensive validation away from a trust boundary?
- [ ] Did I make the call site easier to read, not just shorter?
- [ ] Would keeping this inline be clearer?

When in doubt, choose the boring, local version.
