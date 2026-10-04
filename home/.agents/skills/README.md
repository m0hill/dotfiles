# Skills

## Source attribution

The skills below are adapted from external sources. Source links pin the adaptation baseline; use the tracking links when checking for updates.

### Matt Pocock update: v1.3.1

Reviewed all 24 attributed Matt Pocock skills and the existing local `pr` skill against [v1.3.1](https://github.com/mattpocock/skills/releases/tag/v1.3.1), commit `24fe0ef7737efae15c87225755e9f6f5965e4888`, from the baseline linked below. Applied changes to installed workflows while preserving local adaptations and invocation metadata:

- Adopted `GLOSSARY.md` / `GLOSSARY-MAP.md` and renamed the domain format reference to `GLOSSARY-FORMAT.md`.
- Added horizontal rules between grilling questions.
- Removed the router's stale automatic post-mortem handoff; architecture exploration remains a human choice.
- Kept the local `pr` / `explain-work` composition, adding the upstream domain-language guidance.
- Kept `ask-matt` scoped to installed workflows; added user-invoked `retro`, but did not install `implement-spec`. The removed `resolving-merge-conflicts` skill was not installed. Other release fixes were already present or superseded by local adaptations.

For repositories using the old domain-doc convention, rename `CONTEXT.md` to `GLOSSARY.md` and `CONTEXT-MAP.md` to `GLOSSARY-MAP.md`, then update repository pointers. This update does not migrate other repositories.

| Local skill | Pinned source | Track updates | Local adaptation |
| --- | --- | --- | --- |
| `ask-matt` | [`engineering/ask-matt`](https://github.com/mattpocock/skills/blob/885e2ca4d842d139e9aef4e48d366c63cb1b8013/skills/engineering/ask-matt/SKILL.md) | [`main`](https://github.com/mattpocock/skills/blob/main/skills/engineering/ask-matt/SKILL.md) | Routes installed workflows only; retains local implementation policy. |
| `code-review` | [`engineering/code-review`](https://github.com/mattpocock/skills/blob/885e2ca4d842d139e9aef4e48d366c63cb1b8013/skills/engineering/code-review/SKILL.md) | [`main`](https://github.com/mattpocock/skills/blob/main/skills/engineering/code-review/SKILL.md) | Adds adversarial-risk review, Feature Contracts, independent parallel passes, and lead adjudication of evidence and remedies. |
| `codebase-design` | [`engineering/codebase-design`](https://github.com/mattpocock/skills/blob/885e2ca4d842d139e9aef4e48d366c63cb1b8013/skills/engineering/codebase-design/SKILL.md) | [`main`](https://github.com/mattpocock/skills/blob/main/skills/engineering/codebase-design/SKILL.md) | Matches upstream, including model invocation. |
| `diagnosing-bugs` | [`engineering/diagnosing-bugs`](https://github.com/mattpocock/skills/blob/885e2ca4d842d139e9aef4e48d366c63cb1b8013/skills/engineering/diagnosing-bugs/SKILL.md) | [`main`](https://github.com/mattpocock/skills/blob/main/skills/engineering/diagnosing-bugs/SKILL.md) | Retains diagnosis-only mode and conditional state-space analysis. |
| `domain-modeling` | [`engineering/domain-modeling`](https://github.com/mattpocock/skills/blob/885e2ca4d842d139e9aef4e48d366c63cb1b8013/skills/engineering/domain-modeling/SKILL.md) | [`main`](https://github.com/mattpocock/skills/blob/main/skills/engineering/domain-modeling/SKILL.md) | Matches upstream, including model invocation. |
| `grill-me` | [`productivity/grill-me`](https://github.com/mattpocock/skills/blob/885e2ca4d842d139e9aef4e48d366c63cb1b8013/skills/productivity/grill-me/SKILL.md) | [`main`](https://github.com/mattpocock/skills/blob/main/skills/productivity/grill-me/SKILL.md) | Matches upstream. |
| `grill-with-docs` | [`engineering/grill-with-docs`](https://github.com/mattpocock/skills/blob/885e2ca4d842d139e9aef4e48d366c63cb1b8013/skills/engineering/grill-with-docs/SKILL.md) | [`main`](https://github.com/mattpocock/skills/blob/main/skills/engineering/grill-with-docs/SKILL.md) | Matches upstream. |
| `grilling` | [`productivity/grilling`](https://github.com/mattpocock/skills/blob/885e2ca4d842d139e9aef4e48d366c63cb1b8013/skills/productivity/grilling/SKILL.md) | [`main`](https://github.com/mattpocock/skills/blob/main/skills/productivity/grilling/SKILL.md) | Uses the round-by-round frontier interview with a harness-agnostic research fallback. |
| `handoff` | [`productivity/handoff`](https://github.com/mattpocock/skills/blob/885e2ca4d842d139e9aef4e48d366c63cb1b8013/skills/productivity/handoff/SKILL.md) | [`main`](https://github.com/mattpocock/skills/blob/main/skills/productivity/handoff/SKILL.md) | Matches upstream. |
| `herdr` | [Dillon Mulroy's `herdr`](https://github.com/dmmulroy/.dotfiles/blob/be8575f901b85100251080c1707e3f3c2966dcc9/home/.agents/skills/herdr/SKILL.md) | [`main`](https://github.com/dmmulroy/.dotfiles/blob/main/home/.agents/skills/herdr/SKILL.md) | Matches the pinned source; local OpenAI metadata keeps model invocation enabled. |
| `improve-codebase-architecture` | [`engineering/improve-codebase-architecture`](https://github.com/mattpocock/skills/blob/885e2ca4d842d139e9aef4e48d366c63cb1b8013/skills/engineering/improve-codebase-architecture/SKILL.md) | [`main`](https://github.com/mattpocock/skills/blob/main/skills/engineering/improve-codebase-architecture/SKILL.md) | Matches upstream, including the visual HTML report workflow. |
| `implement` | [`engineering/implement`](https://github.com/mattpocock/skills/blob/885e2ca4d842d139e9aef4e48d366c63cb1b8013/skills/engineering/implement/SKILL.md) | [`main`](https://github.com/mattpocock/skills/blob/main/skills/engineering/implement/SKILL.md) | Composes `justify-complexity` and `meaningful-tests`, conditional `tdd`, and final `code-review`. |
| `install-anti-slop` | [Dillon Mulroy's `anti-slop`](https://github.com/dmmulroy/anti-slop/blob/6d538555cb151d4121ed51a27db81890eacf8ae9/skills/install-anti-slop/SKILL.md) | [`main`](https://github.com/dmmulroy/anti-slop/blob/main/skills/install-anti-slop/SKILL.md) | Matches upstream, including bundled plugin assets. |
| `prototype` | [`engineering/prototype`](https://github.com/mattpocock/skills/blob/885e2ca4d842d139e9aef4e48d366c63cb1b8013/skills/engineering/prototype/SKILL.md) | [`main`](https://github.com/mattpocock/skills/blob/main/skills/engineering/prototype/SKILL.md) | Integrates outcomes with implementation issues and Feature Contracts. |
| `quality-code` | [Dillon Mulroy's `coding-standards`](https://github.com/dmmulroy/.dotfiles/blob/be8575f901b85100251080c1707e3f3c2966dcc9/home/.agents/skills/coding-standards/SKILL.md) | [`main`](https://github.com/dmmulroy/.dotfiles/blob/main/home/.agents/skills/coding-standards/SKILL.md) | Omits the `better-result` preference and retains local TypeScript edge-case guidance. |
| `research` | [`engineering/research`](https://github.com/mattpocock/skills/blob/885e2ca4d842d139e9aef4e48d366c63cb1b8013/skills/engineering/research/SKILL.md) | [`main`](https://github.com/mattpocock/skills/blob/main/skills/engineering/research/SKILL.md) | Uses background delegation when available and direct research otherwise. |
| `retro` | [`engineering/retro`](https://github.com/mattpocock/skills/blob/24fe0ef7737efae15c87225755e9f6f5965e4888/skills/engineering/retro/SKILL.md) | [`main`](https://github.com/mattpocock/skills/blob/main/skills/engineering/retro/SKILL.md) | Matches v1.3.1; user-invoked retrospective on the agent's environment. |
| `setup-matt-pocock-skills` | [`engineering/setup-matt-pocock-skills`](https://github.com/mattpocock/skills/blob/885e2ca4d842d139e9aef4e48d366c63cb1b8013/skills/engineering/setup-matt-pocock-skills/SKILL.md) | [`main`](https://github.com/mattpocock/skills/blob/main/skills/engineering/setup-matt-pocock-skills/SKILL.md) | Defaults to local markdown under `.scratch/`, retains repository GitHub Issues, and omits GitLab. |
| `triage` | [`engineering/triage`](https://github.com/mattpocock/skills/blob/885e2ca4d842d139e9aef4e48d366c63cb1b8013/skills/engineering/triage/SKILL.md) | [`main`](https://github.com/mattpocock/skills/blob/main/skills/engineering/triage/SKILL.md) | Matches upstream. |
| `tdd` | [`engineering/tdd`](https://github.com/mattpocock/skills/blob/885e2ca4d842d139e9aef4e48d366c63cb1b8013/skills/engineering/tdd/SKILL.md) | [`main`](https://github.com/mattpocock/skills/blob/main/skills/engineering/tdd/SKILL.md) | Delegates test quality to `meaningful-tests`, chooses routine seams autonomously, and includes refactoring in the loop. |
| `teach` | [`productivity/teach`](https://github.com/mattpocock/skills/blob/885e2ca4d842d139e9aef4e48d366c63cb1b8013/skills/productivity/teach/SKILL.md) | [`main`](https://github.com/mattpocock/skills/blob/main/skills/productivity/teach/SKILL.md) | Includes the upstream workspace format documents. |
| `to-spec` | [`engineering/to-spec`](https://github.com/mattpocock/skills/blob/885e2ca4d842d139e9aef4e48d366c63cb1b8013/skills/engineering/to-spec/SKILL.md) | [`main`](https://github.com/mattpocock/skills/blob/main/skills/engineering/to-spec/SKILL.md) | Matches upstream; tracker behavior comes from per-repository configuration. |
| `to-tickets` | [`engineering/to-tickets`](https://github.com/mattpocock/skills/blob/885e2ca4d842d139e9aef4e48d366c63cb1b8013/skills/engineering/to-tickets/SKILL.md) | [`main`](https://github.com/mattpocock/skills/blob/main/skills/engineering/to-tickets/SKILL.md) | Matches upstream; tracker behavior comes from per-repository configuration. |
| `to-questionnaire` | [`productivity/to-questionnaire`](https://github.com/mattpocock/skills/blob/885e2ca4d842d139e9aef4e48d366c63cb1b8013/skills/productivity/to-questionnaire/SKILL.md) | [`main`](https://github.com/mattpocock/skills/blob/main/skills/productivity/to-questionnaire/SKILL.md) | Matches upstream. |
| `wait-what` | [`productivity/wait-what`](https://github.com/mattpocock/skills/blob/885e2ca4d842d139e9aef4e48d366c63cb1b8013/skills/productivity/wait-what/SKILL.md) | [`main`](https://github.com/mattpocock/skills/blob/main/skills/productivity/wait-what/SKILL.md) | Matches upstream. |
| `wayfinder` | [`engineering/wayfinder`](https://github.com/mattpocock/skills/blob/885e2ca4d842d139e9aef4e48d366c63cb1b8013/skills/engineering/wayfinder/SKILL.md) | [`main`](https://github.com/mattpocock/skills/blob/main/skills/engineering/wayfinder/SKILL.md) | Matches upstream; tracker behavior comes from per-repository configuration. |
| `wizard` | [`engineering/wizard`](https://github.com/mattpocock/skills/blob/885e2ca4d842d139e9aef4e48d366c63cb1b8013/skills/engineering/wizard/SKILL.md) | [`main`](https://github.com/mattpocock/skills/blob/main/skills/engineering/wizard/SKILL.md) | Matches upstream. |
| `writing-for-agents` | [`productivity/writing-for-agents`](https://github.com/mattpocock/skills/blob/885e2ca4d842d139e9aef4e48d366c63cb1b8013/skills/productivity/writing-for-agents/SKILL.md) | [`main`](https://github.com/mattpocock/skills/blob/main/skills/productivity/writing-for-agents/SKILL.md) | Replaces `writing-great-skills`; Codex metadata follows the changelog's model-invoked intent. |

## Invocation

Model-invoked skills may be selected autonomously and may be composed by other skills. User-invoked skills are deliberate top-level workflows or commands.

| Model-invoked | User-invoked |
| --- | --- |
| `aws-accounts` | `agent-browser` |
| `code-review` | `bro` |
| `codebase-design` | `commit` |
| `diagnosing-bugs` | `design-taste-frontend` |
| `domain-modeling` | `diverge` |
| `grilling` | `handoff` |
| `herdr` | `implement` |
| `install-anti-slop` |  |
| `justify-complexity` | |
| `meaningful-tests` | |
| `opensrc-skill` | `improve-codebase-architecture` |
| `prototype` | `setup-matt-pocock-skills` |
| `quality-code` | `teach` |
| `quality-python-code` | `to-questionnaire` |
| `research` | `to-spec` |
|  | `retro` |
| `tdd` | `wait-what` |
| `wizard` | `wayfinder` |
| `writing-for-agents` | `ask-matt` |
|  | `grill-me` |
|  | `grill-with-docs` |
|  | `triage` |

## Relationships

Solid arrows are same-workflow composition. Dashed arrows are prerequisites, conditional adapters, alternatives, or next-session handoffs rather than unconditional calls.

```mermaid
flowchart TD
  setup[setup-matt-pocock-skills] -. writes tracker config .-> tracker{configured tracker}

  grillme[grill-me] --> grilling[grilling]
  grilldocs[grill-with-docs] --> grilling
  grilldocs --> domain[domain-modeling]
  triage[triage] --> grilling

  wayfinder[wayfinder] --> grilling
  wayfinder --> domain
  wayfinder --> research[research]
  wayfinder --> prototype[prototype]
  wayfinder -. needs tracker setup .-> setup

  spec[to-spec] -. needs tracker setup .-> setup

  tickets[to-tickets] -. needs tracker setup .-> setup
  tickets -. next-session handoff .-> implement[implement]

  implement --> complexity[justify-complexity]
  implement --> tests[meaningful-tests]
  implement -. test-first work .-> tdd[tdd]
  implement --> review[code-review]
  tdd --> tests
  tdd -. refactoring decisions .-> complexity
  tests -. test setup abstractions .-> complexity
  review -. defenses and abstractions .-> complexity
  review -. coverage proposals .-> tests

  architecture[improve-codebase-architecture] --> design[codebase-design]
  architecture --> grilling
  architecture --> domain

  retro[retro] --> writing[writing-for-agents]

  diagnose[diagnosing-bugs] -. review alternative .-> review

  classDef user fill:#3b2f50,stroke:#b69cff,color:#fff;
  classDef model fill:#173f3a,stroke:#69d3bd,color:#fff;
  class setup,grillme,grilldocs,triage,wayfinder,spec,tickets,implement,architecture,retro user;
  class grilling,domain,research,prototype,tdd,review,design,diagnose,writing model;
```

### Relationship details

| Skill | Relationship |
| --- | --- |
| `setup-matt-pocock-skills` | Writes tracker and domain configuration. |
| `grill-me` | Composes `grilling` for a standalone interview. |
| `grill-with-docs` | Composes `grilling` and `domain-modeling`. |
| `triage` | Composes `grilling` while moving issues through triage states. |
| `wayfinder` | Composes `grilling`, `domain-modeling`, `research`, and `prototype`; uses the configured tracker. |
| `to-spec` | Requires tracker configuration to publish the specification. |
| `to-tickets` | Requires tracker configuration, then hands the frontier to user-invoked `implement`. |
| `implement` | Composes `justify-complexity`, `meaningful-tests`, conditional `tdd`, and final `code-review`. |
| `improve-codebase-architecture` | Composes `codebase-design`, `grilling`, and `domain-modeling`. |
| `diagnosing-bugs` | Routes diff-first diagnosis to `code-review`; cleanup does not invoke user-only architecture workflows. |
| `retro` | Composes `writing-for-agents`; suggests environment improvements after a session. |
| `tdd` | Owns red-green-refactor; delegates test quality to `meaningful-tests` and abstraction decisions to `justify-complexity`. |
| `meaningful-tests` | Owns test selection and evidence; consults `justify-complexity` for production abstractions introduced for testing. |
| `code-review` | Adjudicates independent review candidates; consults `justify-complexity` for remedies and `meaningful-tests` for coverage proposals. |

## Independent skills

Here, **independent** means the skill does not invoke, require, or hand off to another installed skill. It may still own internal reference files, and other skills may depend on it.

- `agent-browser`
- `aws-accounts`
- `bro`
- `codebase-design`
- `justify-complexity`
- `commit`
- `design-taste-frontend`
- `diverge`
- `domain-modeling`
- `grilling`
- `handoff`
- `herdr`
- `install-anti-slop`
- `opensrc-skill`
- `prototype`
- `quality-code`
- `quality-python-code`
- `research`
- `teach`
- `to-questionnaire`
- `wait-what`
- `wizard`
- `writing-for-agents`
