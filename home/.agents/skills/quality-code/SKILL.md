---
name: quality-code
description: Use when writing, reviewing, refactoring, or cleaning up TypeScript/full-stack code. Apply before and during coding to produce professional code:- project conventions, parsed domain types, errors as values, impossible states, derived types, deep modules, real-seam tests, observability, and minimal useful abstractions.
---

# Quality TypeScript and full-stack code

Apply this before writing code and while polishing code. The goal is to produce code that is already clean: correct, typed, observable, testable, and easy to maintain.

## Decision priority

When rules pull in different directions, use this order:

1. Preserve correctness, safety, and debuggability.
2. Follow established project architecture and conventions.
3. If there are no conventions, follow these guidelines and add new ones as needed.
4. Improve the local design toward these standards.
5. Avoid broad migrations unless explicitly requested.
6. Document meaningful trade-offs with comments or ADRs.

## Operating mode

1. Inspect existing conventions first: error handling, schema parsing, dependency injection, tests, observability, adapters/services, and module layout.
2. Look for existing domain modules, types, adapters, and services before creating new ones.
3. For cleanup work, inspect the diff, preserve behavior, make cleanup-only edits, run focused validation, and do not stage files.
4. Prefer small local improvements over unrelated rewrites.
5. It is possible that the codebase was initially made by some junior engineer who did not make good conventions or the codebase was worked on by multiple engineers, so it has different multiple conventions in that case, follow the better convention or the one that is more prevalent in the codebase or suggest a new convention that can unify the codebase.

## Parse early; keep domain types inside

- Parse untrusted or less-structured input at the boundary into domain types: `unknown -> DTO -> CreateUserInput -> EmailAddress/UserId`.
- Prefer `parseX(input): Result<X, ParseXError>` for untrusted input, `makeX`/`createX` for smart constructors, `isX` for true predicates, and `assertX` rarely.
- Use the repo's established schema library; prefer Standard Schema compatibility for generic helpers; otherwise prefer Zod 4 or small hand-written parsers.
- Use schemas as boundary parsers, not ad-hoc validators sprinkled through core logic.
- Do not pass raw DTOs, raw IDs, nullable bags, or `Partial<T>` through core/application logic unless partiality is the real domain concept.
- Parse environment/config once at startup into typed config with branded/redacted values. Do not read `process.env` throughout the app.

## Make invalid states unrepresentable

- Use branded/refined/domain types for meaningful primitives: IDs, emails, URLs, money, durations, bytes, percentages.
- Construct branded values only through parsers/smart constructors. If a cast is required for branding, include a `SAFETY:` comment.
- Prefer discriminated/tagged unions over flag bags, many optional fields, or shapes where `value` and `error` can both be present/absent.
- Model meaningful lifecycles as state machines or tagged unions, not `isSent`/`isPaid` boolean bags plus nullable timestamps.
- Avoid boolean parameters that control behavior; use named options or domain types. Boolean predicate returns are fine.
- Push optionality outward: branch, parse, or refine before calling functions that require values.
- Prefer object parameters for non-trivial inputs unless matching a platform API or a hot path.

## Let types flow from the source of truth

- Share types end-to-end from DB/schema/server/client using the project's existing tools.
- Derive instead of restating shapes: `Pick`, `Omit`, `Parameters`, `ReturnType`, `Awaited`, `typeof`, indexed access types.
- Derive wrapper/API types from real APIs, e.g. `Parameters<typeof fetch>` or `Pick<typeof globalThis, "fetch">`.
- Avoid new interfaces that duplicate existing entities/events unless they are true public boundaries.
- Keep raw database rows and ORM models as infrastructure DTOs. Parse them before application/core logic.

## TypeScript safety and style

- Prefer strict settings where practical: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`.
- Prefer immutable values (`readonly`, `ReadonlyArray`) except localized imperative shell code, performance internals, builders, or adapters hidden behind precise interfaces.
- Avoid `any`, non-null assertions (`!`), and casts with `as Type`. `as const` is fine.
- Rare non-`as const` casts need a Rust-like `SAFETY:` comment explaining the invariant TypeScript cannot express.
- Rare `any` needs a targeted lint ignore and justification.
- Do not use `!`; branch, parse, or refine instead.
- Use `import type`/`export type` for type-only imports/exports.
- Prefer direct imports from the file that owns the abstraction. Avoid barrel files by default.
- Export only what callers should use. Do not export internals just for tests.
- Avoid TypeScript `namespace` unless required for interop.
- Prefer precise files (`email-address.ts`, `billing-period.ts`, `array.ts`, `prelude.ts`) over vague `utils.ts`, `helpers.ts`, `common.ts`, or `misc.ts`.
- Comments should explain invariants, trade-offs, non-obvious domain rules, and safety justifications. Avoid narrating obvious code.
- Add JSDoc for exported functions, classes, methods, constants, and usually exported types.

## Model expected failures as values

Expected failures include domain, parsing, authorization, integration, I/O, persistence, and workflow failures. Put them in the return type.

Use the project's established result/error pattern. If none exists and a typed result helps, use a small tagged union:

```ts
type Result<T, E extends Error> =
  | { readonly _tag: "ok"; readonly value: T }
  | { readonly _tag: "err"; readonly error: E };
```

- Prefer `Promise<Result<User, UserLookupError>>` over `Promise<User>` that rejects for ordinary lookup/storage failures.
- Promise rejection is equivalent to throwing. Treat it as acceptable only for unrecoverable defects or unclassified third-party behavior at a boundary.
- Throw only for unrecoverable defects: violated internal invariants, impossible branches, startup misconfiguration, temporary `notYetImplemented`, or catastrophic runtime conditions.
- Use existing prelude helpers such as `casesHandled`, `shouldNeverHappen`, or `notYetImplemented` when present.
- Use `casesHandled` or the local equivalent for exhaustive union handling.
- Custom errors should have stable tags, useful messages, structured safe context, optional `cause`, and `this.name` unless a tagged-error base handles it.
- Keep error unions precise at module boundaries. Avoid broad `AppError` types except near entrypoints, orchestration, logging, and rendering.

## Keep runtime checks meaningful

- Keep boundary validation for user input, network/IO, JSON parsing, external APIs, and framework boundaries.
- Remove runtime checks that only compensate for weak internal types.
- Do not validate the same condition twice nearby.
- Remove internal `isSomething` helpers when the type system already narrows the state.
- Avoid broad `catch` blocks unless intentionally isolating instrumentation/test-helper failures from application behavior.
- Preserve useful diagnostic context in assertion and operational errors.
- Collapse repeated `find -> if undefined -> throw/err -> return` patterns into one helper when it clarifies the code.
- Avoid wrapper helpers that hide one obvious `if` or merely forward calls.
- Split complex logic only when each helper has a clear name, responsibility, and caller benefit.

## Build deep, cohesive modules

- Prefer functional core / imperative shell: pure domain logic and state transitions inside; I/O, parsing, telemetry, time/randomness, and framework glue at the boundary.
- A deep module hides substantial behavior/invariants behind a cohesive, low-burden interface. Use the deletion test: if deleting the module makes complexity disappear, it was likely pass-through waste; if deleting it spreads complexity across callers, it was earning its keep.
- Domain modules should center on one concept and expose cohesive parsers, smart constructors, predicates, combinators, formatters, and arbitraries.
- If using classes for domain values, construct through parsers/smart constructors, keep invalid instances unconstructable, keep fields readonly, and do not hide I/O inside value classes.
- Application/service modules should own real capabilities and coordinate domain modules, persistence, external calls, authorization, workflows, and telemetry.
- Prefer classes with constructor injection when a module has dependencies, stateful resources, configuration, or multiple cohesive operations.
- When a framework or dependency introduces a new cohesive abstraction, refactor callers around that abstraction instead of mechanically recreating the retired API with forwarding wrappers. Re-evaluate ownership, exports, and call sites before preserving the old shape. Keep an adapter only when it adds domain meaning, transformation, policy, context, or a deliberate compatibility boundary; a rename or argument reshaping alone does not justify it.
- Avoid other shallow wrappers, vague `Manager`/`Processor`/`Helper` names, repository-per-table defaults, and dependency bags passed into every function.
- No arbitrary method or file-size limits. Split when concepts are unrelated, change for different reasons, or require unrelated dependencies.

## Dependency interfaces, adapters, and persistence

- Depend on the smallest meaningful shape a module actually uses. Let concrete adapters be wider.
- Before creating a new adapter/service, audit existing ones.
- Prefer, in order: reuse an existing adapter through a narrow dependency type; extend an existing adapter if the method fits its cohesive capability; create a new adapter only when reuse/extension would create bad coupling.
- Add an ADR for meaningful new adapters/services explaining what was checked and why reuse/extension did not fit. Skip ADRs for tiny local test adapters, obvious in-memory fakes, or trivial framework glue.
- Avoid repository-per-table by default. Repository-like adapters should represent cohesive domain persistence capabilities and return parsed domain types / typed errors, not raw rows and ORM errors.
- Do not hold database transactions open across network calls or long-running work.
- Retried commands/jobs/workflow steps need explicit idempotency: idempotency key, unique constraint, deduplication record, state transition guard, or transactional outbox/inbox.

## Entrypoints, resources, and authorization

- Keep REST, GraphQL, CLI, worker, and job handlers as thin protocol translation layers.
- Put authorization policy in shared application/domain code, not duplicated across controllers/resolvers/CLI handlers.
- Entrypoints may authenticate and parse sessions/credentials, but shared modules should receive parsed domain authorization inputs such as `AdminUser`, `Session`, `Principal`, or `CommandActor`.
- Avoid top-level I/O except in true entrypoint/bootstrap files. Modules should not start servers, open connections, read env, register handlers, or perform I/O at import time.
- Resource creation and cleanup should be explicit and owned by bootstrap/imperative shell code.
- Avoid mutable singletons/global state. Constants and pure lookup tables are fine.
- Inject clock/randomness into dependency-bearing modules; pure domain functions may accept explicit `now` or random values.

## Browser/fetch/body handling

- Clone `Request`/`Response` before recorder/test inspection so caller-visible bodies are not consumed.
- When wrapping `fetch`, preserve original behavior and rethrow original errors.
- Keep install/uninstall/cleanup paths idempotent; avoid restoring over a newer wrapper.
- Track async background recording work and expose/await a flush when tests need deterministic assertions.

## Regex and matching

- Beware stateful regexes with `g` or `y`; clone/reset before `.test()`.
- Make assertion failure output readable: stringify regexes as `/pattern/flags`, not `{}`.

## Observability and sensitive data

- Prefer OpenTelemetry spans and structured tracing over print logging.
- Include safe diagnostic fields: domain IDs, operation/provider names, state/error tags, retry counts, and safe summaries.
- Never put secrets in errors, traces, logs, snapshots, or test fixtures.
- Wrap tokens, API keys, passwords, raw credentials, and secrets in a `Redacted<T>` type at boundaries; unwrap only inside adapters that need raw values.
- Do not record/log errors without useful context unless no context can be recovered.

## Tests as real as possible

- Prefer confidence-oriented tests: e2e for critical user flows, integration tests through real seams, focused/property tests for pure domain modules, and unit tests only when they test meaningful behavior.
- Do not use `vi.mock`/`jest.mock` for module mocking. Use real seams: constructor-injected interfaces/classes, local databases, service emulators, in-memory adapters when behavior is simple, or fake external adapters when needed.
- Assert observable behavior: returned value/error, persisted state, emitted event/message, rendered response, or sent email record in a fake/local adapter.
- Avoid spy-driven tests unless the interaction is the only observable behavior.
- For persistence behavior, prefer SQLite/local DB-backed tests over hand-rolled in-memory fakes when SQL/schema/transaction behavior matters.
- Use `fast-check` and exported arbitraries near domain modules when properties are clearer than examples.
- Tests should not bypass parsers, smart constructors, or invariants.
- Remove repeated inline assertion lambdas; name once and reuse.
- Keep fixtures minimal while covering important behavior and edge cases.

## Review prompts before keeping code

- Did I follow local conventions before adding a pattern/library?
- Did I look for existing domain modules/types/adapters/services first?
- Can this invalid state be made impossible?
- Can this type be derived from the source of truth?
- Did I parse at the boundary and keep domain types internally?
- Is this expected failure represented as a value, or am I throwing/rejecting ordinary control flow?
- Is this runtime check necessary at a boundary, or defensive noise from weak types?
- Did this helper/module reduce caller burden or just add indirection?
- Did I audit existing adapters/services before adding a new one?
- Am I accidentally consuming a request/response body?
- Does this error/log/trace include useful context without leaking secrets?
- Are tests asserting public behavior through real seams without duplicating implementation details?
