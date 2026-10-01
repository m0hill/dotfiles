# Choosing assertions and test doubles

## Exercise the promised behavior

For an accordion, click the rendered control and observe which content is
visible. Reading private state can miss a disconnected click handler and break
when the state representation changes.

For user creation, create through the application interface and retrieve through
the supported read path. Keep persistence real when durable storage is the risk;
an in-memory read after creation may prove only caching. A database assertion is
appropriate when the stored representation itself is the contract.

## Use independent expectations

A worked example provides an oracle independent of the implementation:

```typescript
expect(calculateTotal([{ price: 10 }, { price: 5 }])).toBe(15);
```

Recomputing the total with the same algorithm in the test can reproduce the same
mistake. Such a test is not necessarily incapable of failing, but its oracle is
not independent. Choose inputs that distinguish a plausible defect, such as
omitting one item, from the required result.

## Distinguish private choreography from external effects

Checking that a private helper was called once usually locks in structure.
Checking that a payment was submitted only once can protect a real obligation.
Drive the action through the relevant production path and observe the outgoing
payment command at the boundary. Assert only fields and ordering required by
the contract, not the entire SDK request object by default.

## Keep the failure mechanism real

For an HTTP serialization bug, run the actual serializer and HTTP client against
a controlled network boundary. Mocking the SDK method above serialization would
hide the defect. For workflow error handling, a controlled error from an existing
adapter seam may be sufficient if serialization is outside the behavior at risk.

A collaborator being owned by the application does not alone determine whether
to replace it. Keep it real when its behavior or integration is under test;
replace unrelated external effects at a suitable existing boundary.

Use a real test database when constraints or transaction behavior matter.
Control time or randomness when they affect the outcome. Neither every dependency
being real nor every dependency being mocked is a goal.

## Separate fixture evidence from provider evidence

A documented response with two content blocks can test that our real adapter
preserves both. Returning the final domain value from a mocked adapter bypasses
that mapping and cannot protect it. Neither approach independently proves that
the provider currently emits the documented response.
