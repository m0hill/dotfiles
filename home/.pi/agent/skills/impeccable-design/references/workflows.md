# Impeccable-Inspired Workflows

Use these as Pi-native workflows. They are not literal `/impeccable` commands unless the user explicitly asks to run upstream Impeccable.

## Setup workflows

### init: create project design context
Use when a repo lacks code-first design context.

1. Scan README/docs/package/framework/styles/components/assets.
2. Infer register: `brand` or `product`.
3. Ask only for missing strategy: users, purpose, personality, anti-references, accessibility.
4. Write `PRODUCT.md` after confirmation.
5. If code exists, generate `DESIGN.md` from actual tokens/components; if not, create a small seed or defer.
6. Recommend the next 2-4 workflows.

### document: generate DESIGN.md
Use when a visual system exists in code but is not documented.

1. Extract CSS custom properties, Tailwind/theme config, token files, component variants, typography, radii, shadows, layout patterns.
2. Write machine-readable frontmatter when practical: colors, typography, rounded, spacing, components.
3. Body sections: Overview, Colors, Typography, Elevation, Components, Do's and Don'ts.
4. Include exact values and project-specific anti-references.

### extract: consolidate design-system pieces
Use when patterns have repeated or drifted.

1. Identify repeated components/tokens/patterns used 3+ times with the same intent.
2. Plan component API, token names, variants, and migration.
3. Extract only what is clearly reusable now.
4. Migrate existing uses, test, remove dead code.
5. Document usage and examples.

## Build workflows

### shape: plan before code
Use for non-trivial new UI or redesign.

Output a compact confirmed brief:
- target surface and users
- primary task/job
- register and visual lane
- content/IA
- states and edge cases
- constraints and anti-references
- open questions, if any

Stop for confirmation when direction materially affects implementation.

### craft: build end-to-end
Use after shape is confirmed or the brief is obvious.

1. Respect existing framework, components, tokens, icons, build pipeline.
2. Implement semantic structure first.
3. Add visual system fidelity: spacing, type, color, states, motion.
4. Cover responsive behavior and edge cases.
5. Build/typecheck where reasonable.
6. Inspect in browser/screenshot when available, critique, patch defects.

## Evaluation workflows

### critique: design director review
Use when asked for feedback, design review, or evaluation.

Assess:
- Does it look AI-generated or generic?
- hierarchy, IA, composition, typography, color, spacing
- cognitive load and primary task clarity
- accessibility and states
- emotional fit with PRODUCT.md
- detector findings if available

Return strengths, priority issues, concrete fixes, and suggested next workflow.

### audit: technical UI quality
Use for accessibility/performance/responsive/theming checks.

Check:
- semantic HTML, labels, heading order, keyboard/focus
- contrast, touch targets, reduced motion
- responsive layout, overflow, long text, empty/error/loading states
- image/media performance, layout shift, expensive animation
- detector evidence

### polish: final pass
Use before shipping or when “something feels off.”

Fix:
- inconsistent spacing/alignment/radius/shadows
- weak hierarchy and bad line lengths
- missing hover/focus/active/disabled/loading/error states
- inconsistent component vocabulary
- copy roughness and CTA label drift
- responsive weirdness and overflow

## Refinement workflows

### bolder
Increase visual impact without breaking usability. Prefer for brand surfaces. In product UI, amplify only the meaningful moment.

### quieter
Reduce loudness: fewer accents, less motion, calmer density, stronger hierarchy.

### distill
Remove non-essential UI. Collapse repeated sections, reduce copy, flatten unnecessary containers.

### harden
Production resilience: long/short text, i18n expansion, empty/error/loading/success, permissions, network failures, disabled states, edge overflow.

### onboard
First-run, activation, and empty states. Empty states should teach what to do next, not just say “nothing here.”

## Enhancement workflows

### animate
Motion must convey state, feedback, orientation, or delight. Use 150-250ms for product UI. Always support `prefers-reduced-motion`.

### colorize
Add strategic color through existing tokens first. Define semantic roles. Do not introduce random hues.

### typeset
Fix hierarchy, font pairing, scale, measure, line-height, tracking, wrapping, code typography.

### layout
Fix composition: grouping, rhythm, grid/flex choice, container widths, optical alignment, density.

### delight
Add small memorable touches. Must support the product/brand purpose, not decoration for decoration’s sake.

### overdrive
Ambitious effects. Ask before pursuing; verify performance and reduced motion.

## Fix workflows

### clarify
Rewrite labels, helper text, errors, empty states, onboarding copy. Prefer concrete verbs and user outcomes.

### adapt
Make UI work across screen sizes and input modes. Product UI adaptation is structural, not just fluid type.

### optimize
Improve UI performance: images, bundle, render churn, CSS/JS cost, animation jank, layout shift.
