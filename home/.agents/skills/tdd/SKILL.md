---
name: tdd
description: Use a test-first red-green-refactor loop when the user requests TDD or a test-first bug fix or feature.
---

# Test-Driven Development

Use `meaningful-tests` to select the behavior, test boundary, and assertions.
This skill owns the order of implementation, not a separate test-quality policy.

Read `GLOSSARY.md` (if it exists), relevant ADRs, and existing contracts. Choose ordinary test
boundaries from those contracts without requiring user approval. Ask only when
missing intent or a consequential design decision prevents choosing correctly.

## Plan the specification

Before the first test, list the promises from the request as observable
outcomes at the public entry point the contract names. For each, note the
concrete wrong implementation it must reject. Rules with a threshold, limit, or
ordering need examples on both sides of the boundary.

Read the existing tests for the area. A refinement of a behavior already under
test usually belongs in that test or its table; a new behavior gets a new test
named for the behavior beside related tests.

## Red → green → refactor

Work in vertical slices: one meaningful behavior through the loop at a time.
Avoid implementing a whole suite against imagined APIs before the first
behavior works.

1. **Red.** Write or extend a test for the next behavior through the public
   entry point. Run it and confirm it fails because that behavior is missing
   or wrong. Resolve unrelated setup, import, or environment failures before
   treating the result as evidence.
2. **Green.** Implement the smallest complete behavior that passes the test.
   Satisfy the contract rather than hard-coding the example or anticipating
   unrelated requirements. Run the focused tests.
3. **Refactor.** With tests green, simplify the affected production and test
   code while preserving behavior. Helpers extracted here are covered through
   the behavior that uses them; do not add tests that name them. Use
   `justify-complexity` when deciding whether an abstraction or defensive path
   earns its place. Rerun affected tests before starting the next slice.

For a bug fix, the red step follows `meaningful-tests` "Place regression tests":
usually a new case or assertion in the existing test that should have caught it.

If a useful failing test cannot be run, explain the limitation and use the
closest meaningful verification available. Report the missing red evidence;
never substitute a test that mostly exercises mocks just to complete the loop.

## Review the tests you wrote

Tests written during the loop are scaffolding until reviewed. Once the feature
works, step back from implementation and review them as a suite with
`meaningful-tests`:

- Delete tests made redundant by later slices, and merge examples that differ
  only in incidental values into one test or table.
- Check each planned promise has a test that rejects its named defect. For an
  uncertain one, temporarily break the code, watch the test fail, and restore it.

Finish with relevant checks and required project validation. Report the
behavior protected and observed red/green results, including any unverified
steps. A separate code review does not replace refactoring during the loop.
