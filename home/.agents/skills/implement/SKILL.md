---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the requested behavior end to end from the spec or tickets and
applicable repository guidance.

- Apply `justify-complexity` while choosing the design and adding defenses,
  compatibility paths, or abstractions.
- Use `meaningful-tests` to identify consequential behavior and coverage gaps
  before copying existing test patterns. It owns test selection and quality.
- Use `tdd` when test-first work is requested or a focused failing regression
  test is practical. It owns the red-green-refactor sequence. Other work still
  gets verification appropriate to its risks.

Choose routine implementation and test boundaries independently. Ask when a
material ambiguity in behavior or a consequential design choice cannot be
resolved from the request and available evidence.

Run focused checks during implementation and required project checks before
handoff. Once complete, use `code-review` to review the work, resolve supported
in-scope findings, and rerun checks affected by any fixes.

Commit your work to the current branch.
