---
name: code-review
description: Master code review for branches, PRs, and WIP diffs since a fixed point. Use when asked to review code, review since X, assess ship/no-ship risk, compare against a spec/PRD, or check repo standards.
disable-model-invocation: true
---

# Master Code Review

Review the change as a skeptical ship/no-ship reviewer across three independent axes:

1. **Adversarial Risk** — strongest grounded reasons the change should not ship yet.
2. **Standards** — whether the diff follows documented repo standards plus the smell baseline below.
3. **Spec** — whether the diff faithfully implements the originating issue, PRD, or spec.

Default to skepticism. Do not give credit for intent, partial fixes, or likely follow-up work. Report only material, defensible findings.

## Inputs

Track these explicitly:

- **Target label**: the branch, PR, commit range, or user label being reviewed.
- **User focus**: any explicit focus area from the user; weight it heavily but do not ignore other material issues.
- **Fixed point**: the commit, branch, tag, or merge-base anchor the user wants reviewed against.

If the user did not provide a fixed point and no active diff/review context is already available, ask for one. For explicit local/WIP review, use the working-tree diff the user named instead of forcing a fixed point.

## Process

### 1. Pin the review target

- For committed branch review, verify the fixed point resolves with `git rev-parse <fixed-point>`.
- Use a three-dot diff against the merge-base: `git diff <fixed-point>...HEAD`.
- Capture commits with `git log <fixed-point>..HEAD --oneline`.
- For WIP review, use the smallest diff matching the request: `git diff`, `git diff --cached`, or `git diff HEAD`.
- Fail early on a bad ref or an empty diff.
- Capture changed files before reviewing details.

Do enough legwork to understand the relevant call paths, data flow, state transitions, and existing neighbouring patterns. Search for existing utilities, components, hooks, and flows before accepting new ones; report material reinvention or inconsistency, but do not demand reuse when no suitable pattern exists. Do not review isolated hunks when the risk depends on how the feature is wired.

### 2. Identify the spec and Feature Contract

Ask where the originating spec is when it cannot be found from the review context. If the user says there is no spec, the Spec axis reports `no spec available` and does not invent requirements.

If the spec contains a Feature Contract, load its exact revision, canonical artifacts, owned interfaces, orchestration, state model, scenario IDs, consumers, delegation surface, and conformance commands. Compare those references with the branch and latest tracker context; a stale or missing revision is a review finding when it prevents trustworthy conformance review.

Quote the spec or Feature Contract line/section for every Spec finding.

### 3. Identify the standards sources

Read repo documents that say how code should be written: `AGENTS.md`, architecture docs, test strategy docs, and nearby feature conventions.

Apply the smell baseline below in addition to repo standards:

- The repo overrides the baseline. A documented repo standard wins where it conflicts.
- Baseline smells are judgement calls, not hard violations.
- Skip anything tooling already enforces unless the diff clearly bypasses or weakens the tooling.

### 4. Run the three axes in parallel

If subagents are available, run three in parallel using the harness's available delegation mechanism. They must work independently so one axis cannot suppress or bias another.

Include the target label, user focus, diff command, commit list, and changed-file list in every prompt. Require every finding to name a concrete file and line range, assign confidence from `0` to `1`, explain impact, and recommend a fix. Cap each report at 400 words.

**Adversarial Risk subagent** — include the full Axis A criteria below and this brief:

> Try to disprove the change. Trace the changed behavior through its call paths and report only material correctness, security, data-integrity, concurrency, compatibility, rollback, or operability risks. For each finding explain what fails, why this code is vulnerable, likely impact, and the smallest effective fix. Do not invent runtime behavior or report style-only concerns.

**Standards subagent** — include the standards-source files and the full smell baseline from Axis B, then use this brief:

> Report every documented-standard breach with the standard file and rule, plus any material baseline smell with the changed hunk. Label baseline smells as judgement calls; documented repo standards override them. Search nearby code for existing utilities, components, hooks, and flows before claiming reinvention or inconsistency. Skip checks already enforced by tooling unless the diff bypasses or weakens that tooling.

**Spec subagent** — include the spec contents and Feature Contract material from Axis C, then use this brief:

> Report requirements that are missing or partial, behavior that was not requested and creates scope or risk, and requirements that appear implemented incorrectly. Quote the spec section for every finding. When a Feature Contract applies, check its exact revision, owned interfaces, orchestration, state model, scenarios, consumers, delegation surface, and conformance commands.

If no spec exists, skip the Spec subagent and report `no spec available`. If subagents are unavailable, run the same briefs as three independent sequential passes and keep their notes separate.

Do not merge or rerank the reports. Each axis is complete only after every changed file has been considered.

#### Axis A — Adversarial Risk

Actively try to disprove the change. Assume it can fail in subtle, high-cost, or user-visible ways until the evidence says otherwise.

Prioritize expensive, dangerous, or hard-to-detect failures:

- auth, permissions, tenant isolation, and trust boundaries
- data loss, corruption, duplication, and irreversible state changes
- rollback safety, retries, partial failure, and idempotency gaps
- race conditions, ordering assumptions, stale state, and re-entrancy
- empty-state, null, timeout, and degraded dependency behavior
- version skew, schema drift, migration hazards, and compatibility regressions
- observability gaps that would hide failure or make recovery harder

Look for violated invariants, missing guards, unhandled failure paths, and assumptions that stop being true under stress. Trace how bad inputs, retries, concurrent actions, or partially completed operations move through the code.

A risk finding must answer:

1. What can go wrong?
2. Why is this code path vulnerable?
3. What is the likely impact?
4. What concrete change would reduce the risk?

Be aggressive, but grounded. Do not invent files, lines, runtime behaviour, incidents, or attack chains. If a conclusion depends on inference, state that and keep confidence honest. Prefer one strong finding over several weak ones.

#### Axis B — Standards

Report:

- Documented-standard breaches, citing the standard file and rule.
- Material baseline smells, labelled as judgement calls and grounded in the hunk.

Smell baseline:

- **Mysterious Name** — a function, variable, or type whose name does not reveal what it does or holds. Fix by renaming; if no honest name comes, the design is murky.
- **Duplicated Code** — the same logic shape appears in more than one hunk or file. Fix by extracting the shared shape and calling it from both sites.
- **Feature Envy** — a method reaches into another object's data more than its own. Fix by moving the method onto the data it envies.
- **Data Clumps** — the same fields or params keep travelling together. Fix by bundling them into one type.
- **Primitive Obsession** — a primitive or string stands in for a domain concept. Fix by giving the concept its own small type.
- **Repeated Switches** — the same `switch` or `if` cascade on the same type recurs. Fix with polymorphism or one shared map.
- **Shotgun Surgery** — one logical change forces scattered edits across many files. Fix by gathering what changes together into one module.
- **Divergent Change** — one file or module is edited for unrelated reasons. Fix by splitting so each module changes for one reason.
- **Speculative Generality** — abstraction, parameters, hooks, or options are added for needs the spec does not have. Fix by deleting or inlining until there is a real need.
- **Message Chains** — long `a.b().c().d()` navigation exposes internals. Fix by hiding the walk behind one method on the first object.
- **Middle Man** — a class or function mostly delegates onward. Fix by cutting it and calling the real target directly.
- **Refused Bequest** — a subclass or implementer ignores or overrides most inherited behaviour. Fix by dropping inheritance and using composition.

#### Axis C — Spec

Report:

- Requirements the spec asked for that are missing or partial.
- Behaviour in the diff that was not asked for and creates scope creep or risk.
- Requirements that look implemented but are wrong under the spec.

When a Feature Contract applies, also report:

- owned interfaces changed without approval;
- orchestration gained hidden edges or moved ownership;
- state behavior added or removed unapproved states, events, guards, or transitions;
- scenarios changed, weakened, or bypassed without approval;
- required consumers do not conform to the same revision;
- implementation crossed its Delegation surface;
- required conformance commands are missing or failing;
- checkpoint, code, and PR evidence reference different contract revisions.

Generated diagrams are evidence only when derived from the canonical artifact. Do not treat an independently maintained diagram as authoritative.

If no spec is available, say so and skip this axis rather than inventing intent.

## Output

Do not include style feedback, naming feedback, low-value cleanup, or speculative concerns without evidence. Every finding must include:

- the axis: `adversarial-risk`, `standards`, or `spec`
- affected file and line range
- confidence from `0` to `1`
- concise impact explanation
- concrete recommendation

Use `needs attention` if there is any material finding worth blocking on. Use `approve` only when you cannot support any substantive finding from the provided context.

Use this format:

```markdown
## Verdict
<`needs attention` or `approve`> — <terse ship/no-ship assessment>

## Adversarial Risk
- ...

## Standards
- ...

## Spec
- ...

Summary: <finding counts per axis; worst issue within each axis, if any>
```

Keep the axes side by side. Do not pick a single winner across axes.

## Final check

Before finalizing, verify every finding is:

- adversarial or standards/spec material rather than stylistic filler
- tied to a concrete code location
- plausible under a real failure scenario or documented requirement
- actionable for the engineer fixing it
- grounded in repository context, tool output, or quoted spec/standard
