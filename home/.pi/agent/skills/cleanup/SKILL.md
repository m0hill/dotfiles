---
name: cleanup
description: Clean up AI-generated or newly written TypeScript/code diffs by removing unnecessary validations, redundant checks, duplicated types, and awkward abstractions. Use when the user asks to clean up a diff, review new changes for professional code quality, remove useless checks, derive types, or polish AI-agent output.
---

# Cleanup

Use this skill when polishing a unstaged diff, especially AI-generated TypeScript. The goal is clear, professional code: fewer invalid states, fewer redundant checks, and types derived from the real source of truth.

## Quick start

1. Inspect the diff first:
   - `git status --short`
   - `git diff --cached --stat && git diff --cached` for staged changes
   - `git diff --stat && git diff` for unstaged changes
2. Identify cleanup-only edits that preserve behavior.
3. Edit, then run focused validation: typecheck, relevant tests, lint/format if available.
4. Do not stage the cleaned files.

## Cleanup checklist

### Types

- Prefer derived types over duplicated shapes:
  - `Pick`, `Omit`, `Partial`, `Parameters`, `ReturnType`, `Awaited`, `typeof`, indexed access types.
- Derive API wrapper types from the real API:
  - Example: use `Parameters<typeof fetch>` instead of manually typing fetch args.
  - Example: use `Pick<typeof globalThis, "fetch">` instead of duplicating `{ fetch: typeof fetch }`.
- Avoid new interfaces that restate existing event/entity fields unless they are a true public boundary.
- Make invalid states unrepresentable:
  - Prefer unions over many optional fields.
  - Avoid shapes where both `value` and `error` can be present or both absent unless that is intentionally valid.

### Checks and validation

- Remove runtime checks that only compensate for weak types.
- Keep boundary validation: user input, network/IO, JSON parsing, external APIs.
- Remove internal `isSomething` helpers if the type system already narrows the state.
- Don’t validate the same condition twice in nearby code.
- Don’t record/log errors without useful context unless no context can be recovered.

### Control flow and helpers

- Collapse repeated `find -> if undefined -> throw -> return` patterns into one helper.
- Avoid wrapper helpers that only hide one obvious `if` and do not improve readability.
- Split complex logic into helpers only when each helper has a clear name and responsibility.
- Prefer object parameters for non-trivial helper inputs unless matching a platform API signature.

### Browser/fetch/body handling

- Clone `Request`/`Response` before recorder/test inspection so caller-visible bodies are not consumed.
- When wrapping `fetch`, preserve original behavior and rethrow original errors.
- Keep uninstall/cleanup paths idempotent and avoid restoring over a newer wrapper.
- Track async background recording work and expose/await a flush when tests need deterministic assertions.

### Regex and matching

- Beware stateful regexes with `g` or `y`; clone/reset before `.test()`.
- Make assertion failure output readable: stringify regexes as `/pattern/flags`, not `{}`.

### Errors

- Custom `Error` subclasses should set `this.name`.
- Preserve useful diagnostic context in assertion errors.
- Avoid broad catch blocks unless they intentionally isolate instrumentation/test helper failures from application behavior.

### Tests

- Remove repeated inline assertion lambdas; name once and reuse.
- Test public behavior, not implementation noise.
- Keep fixtures minimal while covering body cloning, rethrowing, and type/shape expectations.

## Review prompts

Ask these before keeping code:

- Can this type be derived from the source of truth?
- Can this invalid state be made impossible?
- Is this runtime check necessary at a boundary, or just defensive noise?
- Did this helper reduce duplication or just add indirection?
- Am I accidentally consuming a request/response body?
- Does this error/log include useful context?
- Are the tests asserting behavior without duplicating implementation details?

## Validation

Prefer focused commands first, then broader checks if touched code is central:

```sh
pnpm --filter <package> typecheck
pnpm --filter <package> test -- <relevant-test-file>
pnpm oxlint <changed-files> --type-aware
git diff --check
git diff --cached --check
```
