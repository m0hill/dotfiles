---
name: impeccable-design
description: Code-first design-system workflow adapted from pbakaus/impeccable for Pi. Use when the user mentions Impeccable, PRODUCT.md, DESIGN.md, design systems, UI critique/audit/polish/extract/harden, anti-AI-slop frontend work, or wants agents to preserve a product's visual direction in code.
license: Apache-2.0 concepts adapted from pbakaus/impeccable
disable-model-invocation: true
---

# Impeccable Design for Pi

Use this as the code-first design-system layer. It complements `design-taste-frontend`: this skill covers both brand surfaces and product UI, and it is especially for making future AI UI work stay on-direction through repo docs, tokens, detector checks, and repeatable workflows.

## First move

1. If the task asks what Impeccable offers, setup choices, or why we selected pieces, read [references/inventory.md](references/inventory.md).
2. If the task invokes a workflow word (`craft`, `shape`, `critique`, `audit`, `polish`, `extract`, etc.), read [references/workflows.md](references/workflows.md) and follow that workflow.
3. For any UI/design-system task, inspect the project before changing code: read existing `PRODUCT.md`, `DESIGN.md`, `AGENTS.md`, README, CSS/tokens/theme, and one representative component/page.
4. Classify the surface:
   - `brand`: marketing, landing, portfolio, docs-as-brand, content where design is part of the product.
   - `product`: app UI, dashboards, tools, settings, forms, tables where design serves a task.

## Selected defaults for Pi

Adopt by default:
- `PRODUCT.md` for strategy: users, purpose, brand personality, anti-references, principles, accessibility.
- `DESIGN.md` for visual system: tokens, typography, components, elevation, do/don't rules.
- The command vocabulary and workflows in [references/workflows.md].
- The anti-slop and quality rules in [references/rules.md].
- The detector CLI as warning evidence, not as absolute authority.

Ask before enabling:
- Impeccable native install/update in a repo.
- Automatic provider hooks.
- Live mode script injection / browser variant mode.
- Browser extension usage.

Skip by default:
- Treating generic taste rules as universal bans. Project identity wins. Example: `overused-font` is often a warning, not a defect, when the font is an intentional brand/system choice.

## Detector usage

When auditing, critiquing, polishing, or after meaningful UI edits, run when practical:

```bash
npx -y impeccable detect --json <target files-or-dirs>
```

Use detector results as structured evidence. Merge them with human/visual review. If `npx` is unavailable/offline, continue manually and mention the detector was skipped. Project-specific docs override detector opinions.

## Context docs workflow

If setup is requested and context docs are missing:
1. Scan the codebase first. Do not invent from the prompt alone.
2. Ask only for missing strategic info: register, users, purpose, personality, anti-references, accessibility.
3. Write `PRODUCT.md` only after user confirmation.
4. Generate `DESIGN.md` from real tokens/components when code exists; otherwise mark it as a seed and keep it minimal.

## Quality bar

- Use existing components, tokens, spacing, type, and color roles before inventing new ones.
- No arbitrary hex colors, spacing, shadows, or one-off component styles unless the task explicitly extends the system.
- Cover real UI states: default, hover, focus, active, disabled, loading, error, empty, overflow, and responsive.
- For visual changes, use browser/screenshot inspection when available; load `agent-browser` for real browser QA.
- End with what changed, what was checked, and any remaining design-system debt.
