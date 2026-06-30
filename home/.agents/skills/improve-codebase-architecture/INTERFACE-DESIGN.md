# Interface Design

Use this when the user wants alternative interfaces for a chosen deepening candidate. Based on “Design It Twice”: the first interface idea is rarely the best.

Uses the vocabulary in [LANGUAGE.md](LANGUAGE.md): **module**, **interface**, **seam**, **adapter**, **leverage**.

## Process

### 1. Frame the problem space

Write a short user-facing frame before proposing designs:

- What behavior should move behind the seam.
- What constraints any interface must satisfy.
- Which dependencies it relies on and their category from [DEEPENING.md](DEEPENING.md).
- What callers/tests need from the interface.
- A small illustrative sketch if needed to make constraints concrete. This is not yet a proposal.

### 2. Generate independent alternatives

Produce at least three **radically different** interfaces as independent passes. Do not converge early and do not let the first design anchor the rest.

Use different design pressures:

1. **Minimal interface** — aim for 1–3 entry points and maximum leverage per entry point.
2. **Flexible interface** — support extension and multiple use cases explicitly.
3. **Common-case interface** — make the most frequent caller trivial and push uncommon behavior to options/adapters.
4. **Ports-and-adapters interface** — use only when dependencies cross a real seam with at least two justified adapters.

Each alternative must include:

1. Interface shape: types, methods, params, invariants, ordering, and error modes.
2. Usage example showing callers using it.
3. What implementation complexity sits behind the seam.
4. Dependency and adapter strategy.
5. Trade-offs: where leverage is high, where the interface is thin or costly.

### 3. Compare and recommend

Compare designs by:

- **Depth**: behavior hidden per unit of interface.
- **Locality**: where future change and bugs concentrate.
- **Seam placement**: what varies outside vs what is owned inside.
- **Test surface**: which tests survive internal refactors.
- **Migration cost**: safest first slice and blast radius.

End with a strong recommendation. If a hybrid is best, name exactly which parts to combine and which parts to reject.
