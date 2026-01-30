- In all interaction and commit messages, be extremely concise and sacrifice grammar for the sake of concision.

## Code Quality Standards

- Make minimal, surgical changes
- **Never compromise type safety**: No `any`, no non-null assertion operator (`!`), no type assertions (`as Type`)
- **Make illegal states unrepresentable**: Model domain with ADTs/discriminated unions; parse inputs at boundaries into typed structures; if state can't exist, code can't mishandle it
- **Abstractions**: Consciously constrained, pragmatically parameterised, doggedly documented

### **ENTROPY REMINDER**
This codebase will outlive you. Every shortcut you take becomes
someone else's burden. Every hack compounds into technical debt
that slows the whole team down.

You are not just writing code. You are shaping the future of this
project. The patterns you establish will be copied. The corners
you cut will be cut again.

**Fight entropy. Leave the codebase better than you found it.**

## Slice-First (Tracer Code) Policy

When work spans >1 layer (UI/API/DB/infra), ALWAYS start with a tracer slice:
- Ship ONE thin end-to-end path first (real inputs, real output, real checks)
- Must include at least one verification hook:
  - integration test OR
  - runnable script OR
  - manual repro steps that hit real boundaries (HTTP/DB/queue/etc)
- Prefer “boring + testable” over “smart”.

Rules:
- No broad scaffolding across the whole system before tracer path exists.
- No new abstractions until 2nd slice proves repetition.
- Slice size limit: if change touches many files, cut scope until it’s a single path.
- Every slice must define its contract: inputs, outputs, failure modes.
- Logging/metrics at the boundary for the tracer path (errors must be actionable).

## Testing

- Write tests that verify semantically correct behavior
- **Failing tests are acceptable** when they expose genuine bugs and test correct behavior

## Plans

- At the end of each plan, give me a list of unresolved questions to answer, if any. Make the questions extremely concise. Sacrifice grammar for the sake of concision.

## Docs

- When you need to search docs, use `context7` tools.
- When you are unsure on how to do a certain thing use `grep_app` tools.

## Specialized Subagents

### Oracle
Invoke for: code review, architecture decisions, debugging analysis, refactor planning, second opinion.

### Librarian
Invoke for: understanding 3rd party libraries/packages, exploring remote repositories, discovering open source patterns.