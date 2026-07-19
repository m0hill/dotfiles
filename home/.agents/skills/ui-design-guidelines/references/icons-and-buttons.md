# Icons and buttons

Choose semantics and labels before styling. Icons can support recognition and scanning, but neither icons nor button-like appearance determine what a control does.

## Principles

- Use a button for an action and a link for navigation. Filled, outlined, or “ghost” styling does not change semantic role ([WAI Button Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/)).
- Prefer clear text labels. Add icons when they clarify a specific action, status, or object.
- Reserve icon-only controls for well-established symbols or constrained, repeated interfaces, and always provide an accessible name.
- Size icons optically rather than applying a universal line-height formula.
- Separate visible glyph size from interactive target size.
- Derive padding from content, targets, localization, density, and viewport constraints; a 2:1 horizontal-to-vertical ratio is only a starting heuristic.
- Express action hierarchy deliberately and design all applicable interaction states, including keyboard focus.

## Applying the guidance

### Select native semantics

- **Navigation:** use a real link with a destination. Communicate the current destination where applicable.
- **Command:** use a native button for submit, open, toggle, delete, or other changes in the current context. Set an explicit button type inside forms.
- **Stateful command:** expose the applicable pressed, expanded, checked, or selected state.
- **Composite control:** use an established tabs, menu button, or toolbar pattern rather than an improvised row of clickable elements.

Terms such as ghost, tertiary, text, and unstyled describe visual variants that differ across systems. They are not interoperable semantics.

### Write labels before choosing icons

- Use concise, specific language: “Download report,” “Save draft,” or “Delete account.”
- Let destination links name the destination, such as “Job listings.”
- Avoid vague labels such as “Click here” and ambiguous “OK.”
- Keep the visible label inside the accessible name so speech users can invoke what they see ([WCAG 2.5.3](https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html)).
- Treat an icon that repeats adjacent text as decorative in the accessibility tree.
- For icon-only controls, place the action in the control’s accessible name rather than relying on an SVG filename or tooltip.

Use icons when they add recognizable meaning. Omit them when they merely decorate every action or compete with labels.

### Size and align icons as a system

- Use a coherent icon family with consistent stroke/fill style, corners, perspective, and weight.
- Prefer the family’s intended artboard and optical sizes; arbitrary vector scaling can make small icons muddy or too light.
- Inspect optical bounds rather than only numeric boxes. Rounded, diagonal, and asymmetric glyphs often need different visual adjustment.
- Center the icon and label as a unit and use a consistent gap token.
- Expand the surrounding control to improve target size rather than enlarging the drawing until it overwhelms the text.
- Verify directional icons and metaphors in right-to-left and culturally different contexts.

### Build action hierarchy

- Give the strongest treatment to the action that best advances the current task when its consequence is appropriate.
- Keep lower-emphasis actions clearly operable without competing equally.
- Group only related choices; proximity implies a relationship.
- “One primary action” is a simplification heuristic, not a law. Separate regions may have local primary actions, while some screens need none.
- Follow platform and product conventions for ordering, especially around confirmation and destructive actions.
- Allow groups to wrap or stack at narrow widths and high zoom.

### Derive button dimensions from constraints

Evaluate together:

- minimum target size and separation;
- label length and line height;
- icon artboard and icon–label gap;
- pointer precision and product density;
- localization and text expansion;
- narrow viewports and user font settings;
- consistent height within related groups.

Prefer intrinsic width with a sensible minimum. Avoid rigid widths that truncate labels. A padding proportion may initialize the component but must yield to these constraints.

### Define applicable states

Specify resting, hover, keyboard focus, pressed, selected/toggled, unavailable, and busy states only where they apply. Hover is supplemental. Pressed is transient. Selected or toggled state persists and needs the appropriate semantics. Busy controls must remain understandable and resolve to success or failure.

## Accessibility

- Every control needs a programmatic name, correct role, and applicable state ([WCAG 4.1.2](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html)).
- Use native keyboard behavior; do not recreate buttons or links with clickable generic elements.
- Provide a visible focus indicator in addition to hover.
- Meet the WCAG 2.2 minimum target-size requirement or its precise exceptions, and prefer larger platform targets when appropriate ([WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)).
- Test text, icon, boundary, and state contrast in every theme.
- Do not rely on color, iconography, or hover alone for consequential meaning.
- Test localization, zoom, forced colors, touch, keyboard, screen readers, and speech input.

## Failure modes

- **Clickable row called a button:** navigation semantics are replaced by visual terminology.
- **Hover-only affordance:** controls are unclear until a pointer passes over them.
- **Icon equals line height:** optical bounds and icon-family sizes are ignored.
- **Icon-only by default:** unfamiliar or destructive actions become guesswork.
- **Tooltip as accessible name:** the control remains unnamed programmatically.
- **Two equally dominant actions:** priority becomes unclear without a genuine equal choice.
- **Rigid padding ratio:** translations overflow or compact tools waste space.
- **Visible icon equals target:** small glyphs receive undersized hit areas.
- **Mixed icon families:** inconsistent weight and geometry destabilize the interface.

## Checklist

- [ ] Is each control a link, button, or composite widget according to behavior?
- [ ] Does the label clearly predict the outcome or destination?
- [ ] Does every icon add recognizable meaning?
- [ ] Do icon-only controls have accessible names and sufficient context?
- [ ] Are icon family, optical size, weight, and alignment consistent?
- [ ] Is target size independent from glyph size?
- [ ] Do padding and width survive localization and zoom?
- [ ] Is action hierarchy appropriate to task and consequence?
- [ ] Are keyboard focus and all applicable states complete?
- [ ] Do button groups wrap or stack without loss?
