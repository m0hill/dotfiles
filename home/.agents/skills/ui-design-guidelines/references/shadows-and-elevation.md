# Shadows and elevation

Elevation is the semantic relationship between overlapping surfaces. Shadows are one possible visual cue, not the elevation model itself.

## Principles

- Use elevation to explain overlap, hierarchy, or interaction—not as default decoration.
- Do not equate greater elevation with a darker shadow. Perceived separation also depends on blur, offset, surface tone, border, backdrop, and display conditions.
- Define a small set of semantic elevation roles such as base, raised, overlay, modal, and inset.
- Keep implied light direction and layer ordering coherent throughout the product.
- Use the weakest treatment that still communicates the relationship, without sacrificing perceivability for subtlety.
- Design light, dark, and colored themes independently. Shadows can exist in dark themes, often alongside tonal surfaces and edge cues.
- Never make shadow the only cue required to identify a control, focus state, or layer.

## Applying the guidance

### Build the layer model first

Inventory actual relationships such as:

- page or base surface;
- inset region;
- raised control or card;
- sticky navigation;
- menu, popover, or drag preview;
- nonmodal panel;
- modal dialog and scrim.

Collapse these into the fewest levels that explain the interface. Define which levels can overlap and how focus, hit testing, dismissal, and stacking behave. A visual shadow does not create the actual interaction layer.

### Define coherent elevation tokens

For each role specify:

- surface and adjacent background colors;
- optional edge stroke;
- shadow layers with color, alpha, offset, blur, and spread;
- light-, dark-, and colored-surface variants;
- hover, pressed, focused, and dragged behavior where applicable;
- forced-colors fallback;
- intended components and prohibited uses.

A practical model might include:

- **Base:** ordinary content plane, usually without shadow.
- **Raised:** restrained separation for a genuinely raised persistent surface.
- **Overlay:** clear separation over variable content.
- **Modal:** overlay treatment plus a scrim and correct modal behavior.
- **Inset:** recessed regions or pressed feedback, not a default card style.

One or two shadow layers may separate edge definition from apparent distance. Adopt one coherent system rather than mixing formulas from unrelated design systems.

### Tune relationships in context

- Review components over every background they can encounter: neutral, colored, image, gradient, data visualization, and another raised surface.
- Compare adjacent elevation levels together; isolated shadow samples do not reveal hierarchy.
- Keep offset direction consistent.
- Adapt shadow color and opacity to the surrounding surface.
- Leave enough room to avoid clipping shadows at container boundaries.
- Prefer borders or tonal separation when repeated shadows make dense lists and grids noisy.

### Treat themes and surfaces separately

- **Light surfaces:** restrained dark shadows often work; an edge stroke may preserve near-edge definition.
- **Dark surfaces:** combine theme-specific shadows with tonal layers or lighter edge cues rather than reusing light-theme values.
- **Colored surfaces:** validate perceived separation because the same shadow can appear stronger or weaker as luminance and chroma change.
- **Busy imagery:** use a local surface, stroke, or scrim; a soft shadow alone may disappear.

### Connect elevation to state

Use elevation changes only when they reinforce the interaction model, such as lifting a draggable item or opening an overlay.

- A pressed tactile control usually moves visually toward the surface by reducing outer shadow, changing offset, or adding restrained inset shading.
- Hover elevation is supplemental and must not be the only indication that something is interactive.
- Keep transitions immediate enough for task-focused interfaces and honor reduced-motion preferences.
- Do not animate layout dimensions to simulate depth.

## Accessibility

- Ensure controls and state indicators remain identifiable when shadows are suppressed in forced-colors mode ([CSS Color Adjustment](https://www.w3.org/TR/css-color-adjust-1/#forced-colors-properties)).
- Required visual boundaries and indicators generally need sufficient contrast against adjacent colors ([WCAG 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)).
- Keep keyboard focus distinct from ordinary elevation and hover effects.
- Preserve a clear boundary for low-contrast tactile or neumorphic controls.
- Test zoom, dark mode, increased contrast, forced colors, reduced motion, and lower-quality displays.
- Make actual stacking, reading order, focus management, and dismissal correct; visual depth cannot substitute for semantics.

## Failure modes

- **Every card floats:** decorative shadows create noise without explaining hierarchy.
- **Higher means darker:** overlay shadows become harsh rather than broader or contextually clearer.
- **Light-mode shadow reused in dark mode:** depth disappears or looks muddy.
- **Shadow-only boundary:** controls vanish in forced colors or low contrast.
- **Component name defines elevation:** every popover receives the same treatment regardless of backdrop and interaction.
- **Inconsistent light direction:** neighboring surfaces imply incompatible physical models.
- **Clipped shadow:** overflow creates false edges and breaks the elevation cue.
- **Visual layer without interaction layer:** modal focus, hit testing, dismissal, or stacking remains incorrect.

## Checklist

- [ ] Does each elevation level represent a real relationship?
- [ ] Are the number and order of levels documented?
- [ ] Do surface, border, shadow, and scrim work together?
- [ ] Is light direction consistent?
- [ ] Have tokens been tested over every reachable background?
- [ ] Do light, dark, and colored surfaces have appropriate variants?
- [ ] Are pressed, dragged, overlay, and modal states semantically correct?
- [ ] Do controls remain identifiable without shadows?
- [ ] Are focus and reduced-motion behaviors complete?
