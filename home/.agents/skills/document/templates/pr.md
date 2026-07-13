# PR description

Write an imperative title, no more than 72 characters, following the repository's title convention when one exists.

Use this body, omitting only sections that genuinely do not apply:

```markdown
## What

<What behavior this changes, in 1 to 3 sentences.>

## Why

<The motivation, with issue or spec links when known.>

## Changes

- <Changes grouped by intent, not by file or commit.>

## Verification

- <Checks actually run and their results.>
- <Manual steps a reviewer can run, clearly marked as instructions rather than completed checks.>

## Risk and rollout

<Blast radius, migrations, compatibility, flags, deployment order, monitoring, and rollback.>

## Review focus

<Decisions or risky areas that deserve extra attention.>
```

Do not turn the commit log into bullets. Distinguish verified results from suggested verification. If risk is low, explain why rather than merely saying so.
