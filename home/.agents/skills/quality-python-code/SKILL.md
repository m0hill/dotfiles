---
name: quality-python-code
description: Guides agents to write typed, idiomatic, observable, testable production Python 3.11+ code with boundary validation, domain-specific exceptions, cohesive modules, and real-seam tests. Use when writing, reviewing, refactoring, or cleaning up Python application, service, worker, CLI, or library code.
---

# Quality Python code

Apply this before writing Python and while polishing Python. Target production Python 3.11+ application, service, worker, CLI, and library code; do not optimize these rules for notebooks or throwaway scripts.

## Decision priority

1. Preserve correctness, safety, debuggability, and operational clarity.
2. Follow established project architecture, framework conventions, and tooling.
3. Prefer consistency with the project, then the module/function, then external style guides. Do not break compatibility just to satisfy style.
4. If conventions conflict or are weak, follow the better/prevalent convention or propose a unifying one.
5. Improve local design without broad migrations unless explicitly requested.
6. Document meaningful trade-offs, invariants, and safety assumptions.

## Operating mode

1. Inspect existing conventions first: Python version, package manager, formatter/linter, type checker, validation, exception hierarchy, dependency injection, tests, observability, ORM, and module layout.
2. Look for existing domain modules, Pydantic/dataclass models, exception types, adapters, and services before creating new ones.
3. For cleanup work, inspect the diff, preserve behavior, make cleanup-only edits, run focused validation, and do not stage files.
4. Prefer small local improvements over unrelated rewrites.
5. When a local bug, bad design, or poor convention is discovered in touched code, fix it safely or call it out instead of normalizing it.
6. Optimize for the next human reader: explicit, boring, readable code beats clever code that requires explanation.

## Type and validate at boundaries

- Keep production code fully typed. Public functions, methods, classes, and module constants need precise annotations.
- Use PEP 484/526 annotation syntax. If a framework consumes annotations at runtime, keep static type intent and runtime validation intent aligned.
- Prefer the repo's type checker; if absent, prefer Pyright or mypy with strict-ish settings such as no untyped defs, no implicit optional, warned unused ignores, and checked decorators.
- Avoid `Any`, broad `dict[str, Any]`, casts, and `# type: ignore` unless justified locally. A narrow `cast` or ignore needs a comment explaining the invariant the checker cannot see.
- Parse untrusted or less-structured input at the boundary: HTTP/CLI/env/JSON/queues/files/DB/external APIs -> Pydantic DTO/settings -> internal domain types.
- Prefer Pydantic v2 for boundary schemas and settings when no repo convention exists. Use schemas as boundary parsers, not ad-hoc validators scattered through core logic.
- For strict input contracts, forbid unexpected fields and normalize data once at the edge. Do not keep reparsing the same payload in core logic.
- Prefer frozen dataclasses or attrs classes for internal domain values; use `slots=True` where it clarifies immutability/performance and `default_factory` for mutable defaults.
- Use `NewType`, `Literal`, `Enum`/`StrEnum`, small value objects, or constrained constructors for meaningful primitives such as IDs, emails, money, durations, percentages, and provider names.
- Prefer `Sequence`, `Mapping`, `Iterable`, or custom `Protocol`s for accepted inputs when callers need flexibility; return concrete types when the concrete behavior matters.
- Use `TypedDict` for dictionary-shaped data at boundaries when Pydantic is too heavy; avoid raw dicts in application/domain internals.
- Parse configuration once at startup into typed settings with redacted secret values. Do not read `os.environ` throughout the app.

## Model domain state clearly

- Make invalid states difficult to create: small domain types, explicit lifecycle variants, enums, value objects, and constructors that validate invariants.
- Prefer explicit option objects/dataclasses over boolean parameters that change behavior. Boolean predicate returns are fine.
- Push optionality outward: branch, parse, or refine before calling functions that require values.
- Avoid returning `None` for multiple meanings. Use a domain exception, explicit optional result, sentinel, or richer domain type so absence/failure is unambiguous.
- Avoid mutable default arguments and hidden shared mutable state. Prefer immutable values unless local mutation is simpler and contained.
- Use `pathlib.Path`, timezone-aware datetimes, `Decimal` for money, and units-bearing domain types where precision or units matter.
- Do not pass raw dicts, nullable bags, ORM rows, or partially validated payloads through core/application logic unless that partiality is the domain concept.

## Use Pythonic exceptions deliberately

- Expected/domain failures may be modeled as exceptions in Python. Prefer well-named, domain-specific exception classes over TypeScript-style `Result` by default.
- Derive application exceptions from `Exception`, not `BaseException`. Use the `Error` suffix when the exception represents an error.
- Design exception hierarchies around what handlers need to distinguish programmatically, not where the exception happened.
- Define exception types as part of the module/application contract when callers are expected to handle them.
- Catch domain/application exceptions at entrypoints and translate them to HTTP responses, CLI exits, job retry decisions, or user-facing errors.
- Let unexpected programmer errors surface; do not blanket-catch `Exception` unless isolating a boundary, adding context, or implementing retry/cleanup.
- Never use bare `except`, `except BaseException`, or `except Exception: pass` in application code. Catch specific exceptions whenever possible.
- Keep `try` blocks as small as practical so handlers do not mask unrelated bugs; use `else` when it keeps post-success logic out of the protected block.
- Preserve causal chains with `raise ... from exc`; if deliberately using `raise ... from None`, transfer relevant details to the new exception.
- Do not `return`, `break`, or `continue` from `finally` blocks; that can suppress active exceptions.
- Include useful safe context in exception messages/attributes: operation, domain ID, provider, state tag, retry count. Never include secrets, raw credentials, or sensitive payloads.
- EAFP is fine for precise local Python operations; validate explicitly at trust boundaries and when error messages need to be user/domain friendly.
- Use Result/Either-style values only when the project already does, when composing many branch-heavy operations, or when exceptions would obscure ordinary local control flow.

## Build deep, cohesive modules

- Prefer functional core / imperative shell: pure domain logic inside; I/O, parsing, telemetry, time/randomness, and framework glue at boundaries.
- Use functions for stateless transformations and cohesive classes for stateful resources, configuration, multiple related operations, or dependency-bearing services.
- Inject dependencies through constructors or function parameters. Use narrow `Protocol`s when they improve decoupling/testability; avoid abstract layers that merely mirror one concrete class.
- Prefer precise module names over vague `utils.py`, `helpers.py`, `common.py`, or `manager.py` buckets.
- Avoid import-time I/O, global clients, mutable singletons, and `sys.path` hacks. Bootstrap should own resource creation and cleanup.
- Prefer context managers/lifespan hooks for files, network clients, DB sessions, locks, and temporary resources.
- No arbitrary file/class/function size limits. Split when concepts change for different reasons, need unrelated dependencies, or a named helper reduces caller burden.
- Prefer standard library features before adding dependencies, but do not reimplement serious validation, HTTP, crypto, date/time, or database behavior poorly.

## Async, concurrency, and resources

- Do not introduce async just because Python supports it. Use async when the framework/client stack is async end-to-end or concurrency benefits are real.
- If the project uses async/ASGI/async DB clients, keep async end-to-end, do not block the event loop, and use async-compatible libraries.
- Make timeouts, cancellation, retries, and background-task lifecycle explicit. Track spawned tasks and expose deterministic shutdown/flush paths when tests need them.
- Keep resource ownership clear: whoever opens files, clients, sessions, processes, locks, or temp resources is responsible for closing/cleaning them.
- Context managers should be semantically explicit when they do more than acquire/release a resource, e.g. `conn.begin_transaction()` instead of a mysterious `with conn:`.
- Protect shared mutable state across threads/processes/tasks with explicit synchronization or eliminate sharing.

## Frameworks, persistence, and integration

- Keep FastAPI/Django/Flask/CLI/worker handlers thin: authenticate, parse, authorize, call application code, translate exceptions, render responses.
- Put authorization and business rules in shared application/domain modules, not duplicated across views, commands, and jobs.
- Entrypoints may parse sessions/credentials, but shared modules should receive parsed domain authorization inputs such as `Principal`, `AdminUser`, `ServiceAccount`, or `CommandActor`.
- Treat SQLAlchemy rows/ORM models as infrastructure shapes unless local framework convention makes models the domain, as often in Django.
- Follow strong framework conventions when they are valuable: Django models/admin/forms/migrations, FastAPI dependency injection/request models, Flask app factories/blueprints.
- Avoid repository-per-table defaults. Persistence adapters should expose cohesive domain capabilities and translate DB/driver failures into meaningful exceptions.
- Keep transactions short; do not hold DB transactions across network calls or long-running work.
- Retried jobs/workflows need explicit idempotency: unique constraints, idempotency keys, state-transition guards, or outbox/inbox patterns.
- For external calls, set timeouts, classify retryable failures, preserve causes, and keep provider-specific DTOs/errors at the adapter boundary.

## Pythonic style, naming, and imports

- Follow PEP 8 unless local style says otherwise. Let the formatter settle whitespace and line length instead of hand-formatting debates.
- Use `snake_case` for variables/functions/methods/modules, `CapWords` for classes/exceptions, `ALL_CAPS` for constants, and leading underscores for internal API.
- Keep package/module names short and lowercase; underscores are okay for modules when readability improves. Capitalize acronyms consistently in CapWords names, e.g. `HTTPServerError`.
- Avoid ambiguous one-letter names such as `l`, `O`, and `I`. Very short local loop names are okay when meaning is obvious from immediate context.
- Use a trailing underscore to avoid keyword collisions, e.g. `class_`; do not invent new `__dunder__` names.
- Use double-underscore name mangling rarely, only for real subclass collision concerns; it is not a general privacy mechanism.
- Treat documented APIs as public and undocumented APIs as internal unless marked otherwise. Use `__all__` when a module has a deliberate public surface; imported names are implementation details unless explicitly re-exported.
- Keep imports at the top, grouped as stdlib / third-party / local, with a blank line between groups. Put module dunders after the docstring and `from __future__` imports, before normal imports.
- Put normal imports on separate lines. Avoid star imports except for deliberate public API re-export/accelerator-module patterns.
- Prefer absolute package imports; explicit relative imports are acceptable in complex packages when clearer. Choose module imports vs symbol imports based on local convention, public API clarity, and circular-import risk.
- Do not hide circular imports with late imports unless there is a clear boundary/performance reason; usually fix the module dependency direction.
- Prefer explicit, straightforward code over clever magic/metaprogramming. Avoid dynamic attributes, monkeypatching, import hooks, or runtime code generation unless the project truly needs them.
- Use one statement per line. Prefer parentheses for line continuations, trailing commas for multiline literals/calls that will grow, and avoid fragile backslash continuations.

## Function design and Python idioms

- Design signatures intentionally: natural positional args for core required values, keyword/default options for optional behavior, and `*args`/`**kwargs` only when truly variadic.
- Do not add optional parameters “just in case”; it is easier to add behavior later than remove an unused public option.
- Prefer guard clauses for invalid preconditions and a clear main path. Many normal-success return points can signal that the function wants refactoring.
- Use readable idioms: unpacking, `enumerate`, direct membership tests, `dict.get` when a default is truly wanted, `"".join`, `startswith`/`endswith`, and context managers.
- Use `set`/`dict` membership for repeated or large lookups when duplicates/order are not required; keep lists when order/duplicates matter or collections are tiny.
- Use comprehensions/generators for simple transformations. Use generator expressions to avoid needless lists, and generator functions when comprehension logic gets complex.
- Never use list comprehensions only for side effects. Do not mutate a list while iterating over it; create a new collection or use explicit slice assignment when in-place mutation is required.
- Use truthiness for ordinary truthy/falsy checks, but use `is None`/`is not None`, `is True`, or explicit length/status checks when `None`, false, empty, zero, and missing have different meanings.
- Compare object types with `isinstance`, not `type(x) is ...`, unless exact-type identity is the actual requirement.
- Prefer `def` over assigning a `lambda` to a name so tracebacks and reprs have useful function names.
- Keep return statements consistent: either all meaningful returns have values, or none do; use explicit `return None` when absence is a real branch.
- For rich ordering, implement the comparisons callers need consistently; consider `functools.total_ordering` when it reduces boilerplate without hiding unusual semantics.
- Do not rely on CPython-specific optimizations such as repeated string `+=` in loops; use `"".join` or builders for many pieces.

## Documentation and comments

- Follow PEP 257 unless the project has a stronger docstring convention.
- Public modules, classes, functions, methods, and exception types should have docstrings when their purpose, contract, side effects, or raised exceptions are not obvious from the name/signature.
- Prefer one-line docstrings for obvious APIs. For complex APIs, include summary, use case when helpful, important args, return semantics, raised domain exceptions, and side effects.
- Use action words in docstrings: “Return ...”, “Create ...”, “Parse ...”. Document `__init__` parameters in the class docstring when that is the local convention.
- Keep comments accurate when code changes. Comments should explain invariants, domain rules, trade-offs, surprising constraints, and safety assumptions. Avoid comments that merely narrate obvious code.
- Prefer extracting a well-named helper or predicate over writing a comment to explain a tangled condition.
- Update nearby docs or examples when adding user-visible behavior or changing public contracts.

## Tooling

- If no convention exists, prefer `uv`, `ruff` format/lint, Pyright or mypy, `pytest`, `hypothesis`, and `pyproject.toml` for configuration.
- Use project commands when present. Otherwise typical checks are `uv run ruff format --check`, `uv run ruff check`, `uv run pyright` or `uv run mypy`, and `uv run pytest`.
- Keep package layout importable without modifying `sys.path`; prefer a normal package or `src/` layout configured in `pyproject.toml`.
- Avoid adding dependencies without checking existing dependencies and standard-library alternatives.

## Observability and sensitive data

- Prefer structured logging/tracing/OpenTelemetry over `print` debugging in production paths.
- Include safe diagnostic fields: operation names, domain IDs, state/error tags, retry counts, provider names, and safe summaries.
- Never put secrets in logs, traces, exceptions, snapshots, fixtures, reprs, or assertion messages.
- Wrap or redact tokens, passwords, API keys, and raw credentials at boundaries. For Pydantic/dataclasses, ensure secret fields do not leak through `repr`, serialization, or validation errors.
- Logging should add context or signal; avoid noisy logs that repeat what a caller already records.

## Tests as real as possible

- Prefer behavior-focused tests: e2e for critical flows, integration tests through real seams, focused tests for pure domain logic, and property tests with Hypothesis when properties are clearer than examples.
- Use descriptive test names and scenario-style functional tests so failures explain behavior, not implementation steps.
- Keep tests isolated from production networks/databases. Use separate local/test databases, service emulators, `tmp_path`, fake adapters, and dependency injection before patch-heavy tests.
- For persistence behavior, prefer a real local database/schema over hand-rolled fakes when SQL, transactions, constraints, migrations, or ORM behavior matter.
- Prefer factories/builders over large static fixtures when setup has domain meaning; keep fixtures minimal and readable.
- Use `unittest.mock`/`pytest.monkeypatch` mainly for true external boundaries, env/time/random isolation, or hard-to-reach failure paths.
- Assert observable behavior: returned value, raised domain exception, persisted state, emitted event, sent request, rendered response, or logged safe diagnostic fields.
- Avoid spy-driven tests unless the interaction is the only meaningful observable behavior.
- Tests should not bypass Pydantic parsers, constructors, or domain invariants unless testing invalid construction.
- Unfinished tests must fail or be explicitly skipped with a reason; do not leave TODO tests that pass accidentally.
- Strive for meaningful coverage, not coverage theater. Coverage highlights gaps; it does not prove the behavior is valuable.

## Review prompts before keeping code

- Did I follow local Python conventions and tooling before adding a pattern/library?
- Did I parse untrusted input at the boundary and keep precise domain types internally?
- Are public APIs fully typed without unjustified `Any`, casts, or ignores?
- Is this failure represented with an intentional domain exception and translated at the right boundary?
- Did this helper/module reduce caller burden or just add indirection?
- Am I managing resources, transactions, async tasks, and retries safely?
- Does this log/error/trace add useful context without leaking secrets?
- Are tests isolated and asserting behavior through real seams instead of private choreography?
