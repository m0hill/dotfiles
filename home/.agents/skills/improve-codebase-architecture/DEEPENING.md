# Deepening

How to deepen a cluster of shallow modules safely, given its dependencies. Uses the vocabulary in [LANGUAGE.md](LANGUAGE.md): **module**, **interface**, **seam**, **adapter**.

## Dependency categories

When assessing a candidate, classify its dependencies. The category determines how the deepened module is tested across its seam.

### 1. In-process

Pure computation or in-memory state; no I/O. Usually safe to deepen directly. Merge the behavior and test through the new interface. No adapter needed.

### 2. Local-substitutable

Dependencies have local test stand-ins: PGLite/SQLite for databases, in-memory filesystem, local service emulator. Deepen if the stand-in exists or is cheap to add. The deepened module is tested with the stand-in. The seam can stay internal; no public port just for tests.

### 3. Remote but owned

Your own services across a network boundary: internal APIs, workers, queues, microservices. Define a port at the seam. The deep module owns the logic; transport is injected as an adapter. Tests use an in-memory adapter. Production uses HTTP/gRPC/queue/etc.

Recommendation shape:

> Define a port at the seam, implement a production adapter and an in-memory test adapter, so the behavior sits in one deep module even though it crosses a network in production.

### 4. True external

Third-party services you do not control: Stripe, Twilio, GitHub, etc. The deepened module takes the dependency as an injected port; tests provide a fake/mock adapter that models the cases the module owns.

## Seam discipline

- **One adapter means a hypothetical seam. Two adapters means a real seam.** Don't introduce a port unless at least two adapters are justified, usually production + test.
- **Internal seams vs external seams.** A deep module can have internal seams used by its own tests. Do not expose internal seams through the public interface just because tests use them.
- Avoid repository-per-table or service-per-file defaults. A seam should represent a real capability or variation point.

## Testing strategy: replace, don't layer

- Old unit tests on shallow modules often become waste once deep-interface tests exist. Delete or rewrite them after coverage moves.
- Write tests at the deepened module's interface. The **interface is the test surface**.
- Tests assert observable outcomes through the interface, not internal state.
- Tests should survive internal refactors. If a test changes when implementation changes but behavior does not, it is testing past the interface.
