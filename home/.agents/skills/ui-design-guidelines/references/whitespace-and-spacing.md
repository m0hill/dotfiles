# Whitespace and spacing

Whitespace is functional negative space. It should clarify grouping, sequence, emphasis, and interaction rather than merely make a composition feel airy.

## Principles

- Derive spacing from content relationships: items within a group generally need less separation than neighboring groups.
- Treat proximity as one cue among alignment, similarity, enclosure, and semantics. Spacing alone cannot guarantee that a relationship is understood.
- Use a small, documented spacing scale and shared tokens. A 4-, 5-, or 8-unit base is an implementation convention, not a perceptual or accessibility law.
- Distinguish component padding, gaps between related siblings, gaps between groups, and page/section spacing.
- Assign ownership: components usually own internal padding; parent layouts own space between children.
- Keep spacing consistent by semantic role rather than arithmetic alone.
- Adapt density to viewport, content, input method, language, and platform. Do not uniformly scale a desktop UI down for mobile.
- Preserve usability under zoom, text-spacing overrides, reflow, localization, and dynamic content.

## Applying the guidance

### Start with relationships

1. Identify semantic groups and the task sequence.
2. Use smaller intervals within a group and clearly larger intervals between groups at the same nesting level.
3. Limit the number of relationship bands; many barely different gaps create noise.
4. Reinforce ambiguous proximity with a heading, alignment, boundary, or explicit label.
5. Test with real labels, validation messages, translations, empty states, and user-generated content.

### Build a practical spacing system

Maintain two related layers:

- **Primitive tokens:** available dimensions such as `space-1`, `space-2`, and `space-3`.
- **Semantic aliases:** decisions such as `control-padding-inline`, `stack-related`, `card-gap`, and `section-gap`.

A semantic layer lets density or platform adaptations change coherently. Include fine values for compact controls and optical adjustments, then larger steps for components and sections. Allow rare documented exceptions for borders, hairlines, and glyph alignment when they solve a visible problem.

Do not require line height, borders, target sizes, and every gap to share one mathematical base. Divisibility does not create consistency; shared roles and component rules do.

### Make layout own external spacing

- Use a parent stack, row, grid, or cluster to control sibling gaps.
- Use component padding for the space required by content, states, and target area.
- Prefer layout `gap` for repeated sibling intervals.
- Avoid reusable components with baked-in outer margins, which produce doubled or missing space when reordered or nested.
- Account for focus rings, badges, menus, helper text, errors, and dynamically inserted content.

### Adapt rather than scale

Preserve relationship hierarchy while changing values selectively:

- small internal gaps may remain stable while section gaps compress;
- rows may wrap or stack instead of shrinking controls and type;
- compact density may change a coherent set of tokens rather than isolated margins;
- protected target sizes and readable text should not be reduced to preserve a geometric ratio.

Treat fluid formulas such as `clamp()` as constraints to verify, not proof that the spacing is responsive.

### Keep text and layout rhythm distinct

Font line height, paragraph separation, and component gaps solve different problems. Prefer flexible text containers and unitless line height where appropriate. Do not use fixed-height boxes or repeated line breaks to preserve a nominal rhythm.

## Accessibility

- Test user text-spacing overrides without clipping, overlap, or loss of content ([WCAG 1.4.12](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html)).
- Verify zoom and reflow at narrow equivalent widths ([WCAG 1.4.10](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)).
- Keep pointer targets sufficiently large and separated; visible glyph size and hit area are different dimensions ([WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)).
- Use logical spacing properties when relationships should follow writing direction.
- Preserve enough room for focus indicators, errors, helper text, software keyboards, and safe areas.
- Remember that visual gaps do not create semantic groups; use proper headings, lists, fieldsets, and regions.

## Failure modes

- **One gap everywhere:** equal spacing hides real subgroups.
- **Base-unit worship:** valid exceptions are rejected while text or controls become unusable.
- **Uniform responsive scaling:** type and targets shrink below usable sizes.
- **Child-owned margins:** reusable components accumulate unpredictable external space.
- **Whitespace means more space:** related labels and controls drift apart or actions leave their context.
- **Too many token steps:** teams still choose arbitrary values by eye.
- **Fixed-height rhythm:** translations, errors, and user spacing overrides clip.
- **Compact means accessible enough:** density is increased without checking targets, focus, or readability.

## Checklist

- [ ] Do spacing differences reflect actual content relationships?
- [ ] Are primitive values separated from semantic spacing roles?
- [ ] Does the parent layout own sibling spacing?
- [ ] Are internal padding and external gaps clearly distinguished?
- [ ] Are exceptions documented and purposeful?
- [ ] Does responsive behavior reflow instead of uniformly shrinking?
- [ ] Do zoom, text growth, validation, and localization preserve the layout?
- [ ] Are target areas, focus rings, and dynamic messages given enough room?
- [ ] Does semantic structure reinforce visual grouping?
