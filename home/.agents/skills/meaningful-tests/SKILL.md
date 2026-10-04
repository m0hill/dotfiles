---
name: meaningful-tests
description: Delete low-value and redundant tests, consolidate useful coverage, and add missing tests for consequential failures. Use for test cleanup, suite review, or designing tests for changed behavior.
---

# Meaningful Tests

Protect behavior that matters with tests that detect plausible defects and
permit implementation changes with the least test maintenance. Actively shrink
low-value coverage. Existing tests are evidence, not a template or an obligation
to preserve.
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

## Prune before expanding

For each test or group of overlapping tests in scope, ask: **What consequential
wrong behavior would escape if this coverage disappeared?** Inspect the real
code path and other coverage before answering. A unique input or test name is
not a unique risk. "More coverage" and "might catch something" do not justify
keeping a test.

Delete coverage that has no concrete contribution:

- Tests that restate fixtures, mock return values, constants, or implementation
  structure without detecting a meaningful application defect.
- Runtime tests of guarantees already enforced by the compiler, generated
  contracts, or libraries, unless our integration creates a distinct risk.
- Repeated examples that exercise the same behavior without covering a distinct
  boundary, failure mode, or important class of inputs.
- Private-call, field-existence, and snapshot assertions with no supported
  behavioral or compatibility obligation.
- Tests for removed behavior or unsupported scenarios, and helpers, fixtures,
  mocks, or snapshots left unused by the deletions.

Prefer deleting a low-value test outright over polishing, renaming, or rewriting
it to justify its existence. Do not replace each deleted test, preserve test
counts, or add trivial cases to recover a coverage percentage. In an authorized
cleanup, make supported deletions instead of merely recommending them or asking
for permission to remove ordinary redundant tests.

When several tests protect the same risk, retain the clearest effective coverage
and remove the rest. Keep multiple levels only when they catch different defects
or provide a concrete diagnostic or feedback advantage worth their maintenance.
Do not automatically replace fast focused tests with a broad slow test.

Replace a brittle test only when it is the sole useful protection for a real
risk. If that risk already has adequate coverage, delete the brittle test without
replacement. If its purpose remains unclear after focused inspection, name the
specific uncertainty rather than inventing a hypothetical reason to keep it.

A short test or existence assertion can earn its place through a real contract.
Characterization tests can protect a planned legacy refactor without certifying
current behavior as correct; identify that purpose rather than using the label
as a blanket exemption from pruning.

Find missing consequential coverage independently of these deletions. The goal
is a smaller maintenance burden with better defect detection, not maximum
removal. No deletion quota is required.

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

- Tests and supporting scaffolding deleted, with the redundant or absent value
  summarized by group. Explain material low-value candidates retained.
- Significant tests added or replaced and the defects they catch.
- Verification performed.
- Important remaining gaps, distinguishing fixture-based from live evidence.

Finish when scoped consequential risks are covered or explicitly unverified,
not when every function has a test.
