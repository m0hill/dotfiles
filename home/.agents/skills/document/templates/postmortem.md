# Postmortem

Use a blameless causal account. Describe system conditions and decisions, not individual fault.

```markdown
# Postmortem: <incident> (<date>)

| | |
|---|---|
| **Severity** | <project severity scale> |
| **Duration** | <start to resolution, with timezone> |
| **User impact** | <who was affected, how, and how much when known> |
| **Status** | <Resolved or Monitoring> |

## Summary

<What happened, impact, cause, and resolution.>

## Timeline

_All times <timezone>._

- **<time>**: <Observed event or action.>

## Root cause

<The causal chain. Separate the trigger from the weakness that allowed impact.>

## Contributing factors

- <Condition that increased likelihood, impact, or recovery time.>

## What went well

- <System, process, or tooling that helped.>

## Action items

| Action | Type | Owner | Priority |
|---|---|---|---|
| <Specific, verifiable outcome> | Prevent / Detect / Mitigate | <team or role> | <project priority> |

## Lessons

<Durable learning and any decision that must be revisited.>
```

Timeline entries contain observations and actions, not analysis. Do not invent timestamps, severity, impact, owners, or causes. Write `Unknown, to investigate` when necessary. Every action item must be assignable and objectively completable.
