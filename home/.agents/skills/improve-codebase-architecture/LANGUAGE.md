# Language

Shared vocabulary for every suggestion this skill makes. Use these terms exactly — don't substitute "component," "service," "API," or "boundary" when these meanings are intended.

## Terms

**Module**
Anything with an interface and an implementation. Deliberately scale-agnostic: function, class, package, or tier-spanning slice.
_Avoid_: unit, component, service.

**Interface**
Everything a caller must know to use the module correctly. Includes the type signature, invariants, ordering constraints, error modes, required configuration, and performance characteristics.
_Avoid_: API, signature; those are too narrow.

**Implementation**
What's inside a module. Distinct from **Adapter**: a thing can be a small adapter with a large implementation, or a large adapter with a small implementation.

**Depth**
Leverage at the interface: the amount of behavior a caller or test can exercise per unit of interface they must learn. A module is **deep** when a lot of behavior sits behind a small interface. A module is **shallow** when the interface is nearly as complex as the implementation.

**Seam**
A place where behavior can be altered without editing in that place. The location where a module's interface lives. Choosing the seam is a design decision separate from choosing what goes behind it.
_Avoid_: boundary; it is overloaded with DDD bounded contexts.

**Adapter**
A concrete thing that satisfies an interface at a seam. Describes role, not substance.

**Leverage**
What callers get from depth: more capability per unit of interface they must learn.

**Locality**
What maintainers get from depth: change, bugs, knowledge, and verification concentrate in one place instead of spreading across callers.

## Principles

- **Depth is a property of the interface, not the implementation.** A deep module can be internally composed of small parts; they just are not part of the interface.
- **The deletion test.** If deleting the module makes complexity vanish, it was a pass-through. If complexity reappears across callers, it was earning its keep.
- **The interface is the test surface.** Callers and tests cross the same seam. If you need to test past the interface, the module is probably the wrong shape.
- **One adapter means a hypothetical seam. Two adapters means a real seam.** Don't introduce a seam unless something actually varies across it.

## Relationships

- A **Module** has one **Interface**: the surface it presents to callers and tests.
- **Depth** is a property of a **Module**, measured against its **Interface**.
- A **Seam** is where a **Module**'s **Interface** lives.
- An **Adapter** sits at a **Seam** and satisfies the **Interface**.
- **Depth** produces **Leverage** for callers and **Locality** for maintainers.

## Rejected framings

- **Depth as implementation-lines / interface-lines**: rewards padded implementation. Use depth-as-leverage instead.
- **Interface as only the TypeScript `interface` keyword or public methods**: too narrow.
- **Boundary**: overloaded. Say **seam** or **interface**.
