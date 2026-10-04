---
name: pr
description: Write or revise PR titles and bodies using explain-work, useful evidence, and explicit merge danger.
---

Read [explain-work](../explain-work/SKILL.md) and apply its explanation guidance
to the final diff. Use the PR structure below instead of its report sections
and verification checklist. Write for reviewers who have not read the chat.
Honor required repository templates.

Write a reviewer briefing. Explain scope boundaries and rejected alternatives
only when they answer a likely reviewer question. For performance evidence,
prefer one primary before → after measurement with units. Link supporting
detail instead of expanding the PR body.

## Title

Name the concrete result. For SIND repositories, use `<ticket number>: <title>`:
branch `mohil/123` → `123: Preserve draft notes when reopening the editor`.
Take the ticket from the branch or task context; ask if still ambiguous.

## Summary

Explain the problem and resulting behavior briefly. Include consequential
choices or contract changes. Include the diagram or change sketch required by
explain-work, following its narrow exceptions.

## Evidence

Include only when it adds information useful to judging this change: a visual
before/after, a reproduced failure now resolved, a measured improvement, or
an observed integration outcome. State the scenario and what the evidence shows.

Omit routine lint, build, typecheck, and test-command inventories or generic
“tests pass” statements. CI already reports routine checks; a specific test
belongs here only when its observed result demonstrates something material.
If there is no useful evidence, omit the section. Surface material verification
gaps or failures under Merge Danger even when Evidence is omitted.

## Merge Danger

**Door:** Two-way or one-way. Two-way means cheap to reverse; one-way means
hard or impossible to reverse. Briefly explain the actual rollback consequence,
including data or external effects that reverting code would leave behind.
Mark reversibility unknown when it has not been established.

**Blast Radius:** Name the affected feature, callers, users, services, or data.
Add concrete ramifications and rollout constraints only where they matter.
Keep this section compact; ground it in the change rather than hypothetical risks.
