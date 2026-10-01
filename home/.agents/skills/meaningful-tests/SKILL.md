---
name: meaningful-tests
description: Design tests for changed behavior, or improve an existing suite by replacing low-value tests and adding missing coverage for consequential failures.
---

# Meaningful Tests

Protect behavior that matters with tests that detect plausible defects and
permit implementation changes. Existing tests are evidence, not a template.
Review requests produce findings; requests to improve or implement authorize
in-scope edits. Preserve applicable project test requirements.

This skill owns test selection, boundaries, and evidence. Use `tdd` for the
red-green-refactor sequence when test-first work is requested. Consult
[examples.md](examples.md) when choosing assertions or test doubles.

## Start from behavior

Read the request, affected production path, callers, and contracts before
using existing tests to choose coverage.

Identify the promises being changed and consequential ways they could fail.
Prioritize by impact and plausible failure path, not file count, coverage
percentage, or ease of writing tests.

For each important promise, identify:

- The observable outcome.
- A concrete wrong implementation a test should reject.
- An independently justified expected result.

Derive expectations from requirements, worked examples, or independent
contracts. Do not copy the production algorithm into the assertion.
Clarify material ambiguity rather than freezing current behavior as correct.

Then inspect existing tests. Decide what to keep, replace, remove, and add.
Look for missing protection independently of proposed deletions.

## Choose useful boundaries

Use the smallest boundary that keeps the behavior and failure mechanism real.
Test pure rules directly. Exercise connected components when the risk is
wiring, persistence, framework configuration, or a user workflow.

Keep production logic under examination real. Control external dependencies
at their boundary instead of mocking away the behavior being tested.
Use existing seams where they preserve the failure mechanism. Apply
`justify-complexity` before adding production interfaces or dependency injection
for test setup; mockability alone does not justify a new abstraction.

Assert meaningful results, state transitions, or external effects.
Assert interactions only when the interaction itself is a required contract.
Avoid incidental ordering, private state, broad snapshots, and call counts
unless the protected promise depends on them.

Tests should survive implementation-only refactors. Legitimate contract
changes can change tests.

## Improve the suite

Remove tests that merely repeat setup, static guarantees, generated code,
or library behavior. Verify that the guarantee actually covers the risk:
runtime data and our integration choices may still need tests.

A short test or an existence assertion is not automatically low-value.

Before deleting a test, identify any unique behavior it protects.
Replace brittle coverage of a real risk before deleting it.
Remove obsolete or redundant coverage without replacement quotas.

Characterization tests can preserve legacy behavior without certifying it
as correct. Keep that purpose explicit.

## External providers

Test our adapter's meaningful request construction, response translation,
and error handling against a supported contract.

Ground provider fixtures in official documentation, schemas, or sanitized
captured responses. Record the source and relevant version or capture date.

Handwritten failure inputs may exercise our error policy. Do not present
invented payloads as evidence that the provider emits those payloads.

Fixture-backed tests prove behavior for supplied inputs. Current compatibility
needs provider verification or a live integration check. If unavailable,
report that gap without discarding useful adapter coverage.

Evaluate generated-content quality separately from protocol handling.
A canned LLM reply proves neither model quality nor live compatibility.

Do not add live network calls to ordinary tests merely to avoid mocks.
Respect authorization, cost, and sensitive-data constraints for live checks.

## Verify and finish

For a regression, observe failure on the unfixed behavior when practical.
For new or replacement tests, check that they reject the named defect.

When sensitivity is uncertain and a safe local probe is cheap, temporarily
introduce that defect, observe the intended failure, and restore the code.
Do not install mutation tooling or chase a score by default.

Use deterministic inputs and wait for observable completion, not sleeps.
Run relevant tests and required project checks. Do not weaken expectations
unless intended behavior has genuinely changed.

Report:

- Significant tests added or replaced and the defects they catch.
- Low-value coverage removed.
- Verification performed.
- Important remaining gaps, distinguishing fixture-based from live evidence.

Finish when scoped consequential risks are covered or explicitly unverified,
not when every function has a test.
