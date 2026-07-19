# Layout grids

A layout grid is a constraint system for placing and sizing regions. It commonly combines a content container, margins, columns, and gutters. It is not the same thing as the CSS Grid implementation mechanism.

## Principles

- Start with content, tasks, and hierarchy. Choose a grid that supports the information rather than forcing content into a fashionable template.
- Treat column counts and spacing bases as product conventions, not laws. Twelve columns are common; other systems use different models.
- Align meaningful edges, not every object. Illustrations, backgrounds, callouts, and focal elements may span tracks or use a nested local grid when the exception is deliberate.
- Define the whole system: container behavior, outer margins, columns, gutters, allowed spans, content widths, and responsive transitions.
- Base responsive changes on available space and content needs rather than assumed device names. Window size can change through resizing, split screen, folding, orientation, and zoom ([Android adaptive layouts](https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes)).
- Preserve information, function, and logical order while reflowing ([WCAG 1.4.10](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)).
- Use grids and whitespace together: tracks create structural relationships; margins and gutters expose them.

## Applying the guidance

### Select the model from the content

- A **single-column grid** suits focused reading and simple task flows.
- A **column grid** suits responsive pages where regions need shared key lines.
- A **modular grid** can help galleries, schedules, and repeated tiles, provided rows do not clip growing content.
- **Nested grids** are appropriate when the page shell, content region, data area, and component need different alignment logic.

Do not assume landing pages need no structure or dashboards always need many columns.

### Specify anatomy and behavior

For each major layout, define:

1. **Container:** fluid, max-width, full-bleed, centered, or start-aligned.
2. **Margins:** minimum safe/readable inset and how it grows.
3. **Tracks:** count and fixed, fluid, intrinsic, or mixed sizing.
4. **Gutters:** separation between tracks, distinct from component padding.
5. **Spans:** common widths for main content, supporting regions, forms, media, and cards.
6. **Exceptions:** intentional bleeds, overlaps, offsets, and full-width regions.
7. **Transitions:** what wraps, stacks, changes span, changes pattern, or becomes locally scrollable.

A divisible column count is convenient, not inherently correct. Use the smallest system that expresses the layouts the product actually needs.

### Establish alignment priorities

Align features users scan and compare:

- starts of headings, paragraphs, labels, and controls;
- repeated card edges and comparable internal content;
- navigation, primary content, and related secondary regions;
- data labels and values intended for comparison;
- repeated actions in equivalent components.

Prefer a few strong, recurring key lines over many weak alignments. Optical adjustments for glyphs or irregular artwork may differ from mathematical bounds.

### Design responsive behavior

At each content-driven transition, decide whether a region should:

- retain or change its span;
- wrap or stack in meaningful order;
- move to another region without changing focus or reading sequence;
- switch to a pattern better suited to constrained space;
- become an independently scrollable two-dimensional region when its meaning requires it;
- remain full-bleed while its inner content stays constrained.

Test just below and above each breakpoint as well as arbitrary widths. Include split views, both orientations, long content, empty/error states, zoom, larger text, and localization.

## Accessibility

- Preserve meaningful DOM, reading, and focus order when visual placement changes.
- Ensure ordinary content reflows without page-level two-dimensional scrolling at the WCAG reflow dimensions; isolate genuinely two-dimensional content such as data tables.
- Do not lock rows or cards to heights that clip text growth or validation content.
- Use flow-relative properties and test left-to-right, right-to-left, and supported writing modes.
- Maintain adequate target size, focus visibility, and content availability at every layout state.
- Treat a visual mockup as a hypothesis; verify keyboard navigation, zoom, screen readers, and dynamic content in the implementation.

## Failure modes

- **Twelve columns by default:** the model is selected before understanding content.
- **Device-name breakpoints:** layouts fail between desktop, tablet, and mobile artboards.
- **No grid means no alignment:** expressive layouts still need local anchors and relationships.
- **Everything snaps globally:** artwork and focal elements lose useful freedom.
- **Fixed row heights:** translations, errors, and larger text clip or overlap.
- **Visual reordering:** source, reading, and focus order no longer match the screen.
- **Grid as whitespace substitute:** aligned content remains crowded and hard to group.
- **CSS mechanism mistaken for design:** adopting CSS Grid does not decide the correct information structure.

## Checklist

- [ ] Does the grid support the content and primary tasks?
- [ ] Are container, margins, tracks, gutters, spans, and exceptions documented?
- [ ] Are meaningful edges consistently aligned?
- [ ] Are grid-breaking elements intentional?
- [ ] Do transitions occur where content needs them?
- [ ] Does reading and focus order remain meaningful after reflow?
- [ ] Have arbitrary widths, zoom, text growth, and localization been tested?
- [ ] Is two-dimensional scrolling isolated to content that genuinely needs it?
- [ ] Is the grid simpler than the layouts it is meant to support?
