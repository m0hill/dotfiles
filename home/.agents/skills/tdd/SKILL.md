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

## Red → green → refactor

Work in vertical slices: one meaningful behavior through the loop at a time.
A short list of intended scenarios is useful; avoid implementing a whole suite
against imagined APIs before the first behavior works.

1. **Red.** Write a focused test for the next behavior. Run it and confirm it
   fails because that behavior is missing or wrong. Resolve unrelated setup,
   import, or environment failures before treating the result as evidence.
2. **Green.** Implement the smallest complete behavior that passes the test.
   Satisfy the contract rather than hard-coding the example or anticipating
   unrelated requirements. Run the focused tests.
3. **Refactor.** With tests green, simplify the affected production and test
   code while preserving behavior. Use `justify-complexity` when deciding
   whether an abstraction or defensive path earns its place. Rerun affected
   tests before starting the next slice.

If a useful failing test cannot be run, explain the limitation and use the
closest meaningful verification available. Report the missing red evidence;
never substitute a test that mostly exercises mocks just to complete the loop.

Finish with relevant checks and required project validation. Report the
behavior protected and observed red/green results, including any unverified
steps. A separate code review does not replace refactoring during the loop.
