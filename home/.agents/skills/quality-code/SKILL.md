---
name: quality-code
description: Apply correct-by-construction TypeScript standards for errors, parsing, domain types, modules, adapters, testing, observability, and maintainability.
---

# Quality TypeScript Code

Before writing, reviewing, or refactoring TypeScript, read [`STANDARDS.md`](STANDARDS.md) completely. It is the authoritative standard for this skill; do not apply only selected sections.

## Process

1. Inspect the repository's architecture, conventions, dependencies, tooling, and nearby implementations.
2. Apply the standards to all new behavior and the full behavior being refactored. Contain incompatible legacy patterns at the nearest boundary instead of copying them forward.
3. Keep unrelated old code unchanged unless the user requests a broader migration.
4. Run the repository's formatter, type checker, linter, and focused tests as applicable.
5. Before finishing, use the quick agent checklist in `STANDARDS.md` against every changed area.

When standards conflict, follow the decision priority in `STANDARDS.md`. Surface a meaningful unresolved trade-off rather than silently choosing.
