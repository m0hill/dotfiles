# Dark mode

Dark mode is a theme with predominantly dark surfaces and light foreground content. It is not a mechanical inversion, a fixed black-and-white palette, or inherently more accessible.

## Principles

- Respect user choice. Follow the operating-system preference by default and persist an explicit override when the product offers one.
- Theme semantic roles rather than individual hex values. Map each foreground/background pair separately in light and dark schemes.
- Recheck contrast in the final dark context; minimum ratios are requirements, not a hierarchy recipe.
- Communicate depth with coordinated tonal surfaces, borders, shadows, occlusion, and motion. Dark themes can use shadows; lighter raised surfaces are one convention rather than a law.
- Retune accents by appearance and purpose. Do not indiscriminately desaturate every color or preserve light-theme values unchanged.
- Test the entire experience, including components, states, media, charts, platform chrome, embedded content, printing, and forced-colors modes.
- Avoid health or battery claims that are not specific to the display technology, user, and context.

## Applying the guidance

### Define the mode contract

Decide:

1. whether the theme follows the system, has an explicit `System/Light/Dark` setting, or both;
2. how the preference persists across sessions and signed-in devices;
3. which browser, OS, system-bar, and embedded surfaces need coordination;
4. what happens when the system preference changes while the product is open;
5. whether low-light use, media viewing, energy use, accessibility, or preference is the actual motivation.

Do not force dark-only presentation unless the task or environment justifies it. Different visual conditions and impairments benefit from different polarities.

### Build a semantic theme

Maintain primitive, semantic, and—where necessary—component tokens. Define foreground and background together.

At minimum map:

- canvas, base surface, nested layer, raised surface, overlay, and scrim;
- primary, supporting, muted, inverse, link, and visited-link content;
- subtle, strong, selected, error, and focus boundaries;
- actions and their hover, pressed, selected, and unavailable states;
- information, success, warning, and error families;
- selection, caret, highlight, charts, syntax highlighting, and data visualization.

Remove hard-coded assumptions such as white cards, dark text, and fixed-color assets.

### Structure surfaces and depth

Use the smallest tonal ladder that makes relationships visible.

- Use **tonal difference** for persistent nested or raised surfaces.
- Use **borders** when adjacent surfaces are too similar or a boundary matters more than elevation.
- Use **theme-specific shadows** where they remain visible.
- Use **occlusion, position, scrims, and motion** for temporary overlays.
- Keep elevation semantics consistent across themes; a menu should not appear below its trigger because colors were remapped.

Do not rely on shadow alone to identify a layer or control. Material’s tonal plus shadow elevation is one implementation precedent, not a universal formula ([Material 3 elevation](https://developer.android.com/develop/ui/compose/designsystems/material3#elevation)).

### Tune foregrounds and accents

- Avoid maximum white for every foreground; establish hierarchy while keeping required text readable.
- Do not make supporting content so dim that it becomes illegible.
- Review saturated colors on actual dark surroundings, where they may appear brighter or vibrate.
- Adjust hue, tone, and chroma as a pair with the foreground; saturation alone does not determine contrast.
- Preserve semantic distinctions and reinforce them without color alone.
- Keep brand colors recognizable while supplying alternate tones where required for contrast.

### Adapt imagery and specialized content

- Supply theme-aware logos, illustrations, icons, and empty states when a single asset would glare or disappear.
- Do not globally invert photographs or product imagery.
- Retest maps, heat maps, charts, syntax highlighting, diffs, and annotations.
- Check captions, controls, translucent overlays, and text over imagery.
- Give embedded and third-party content a deliberate surrounding treatment when it cannot follow the theme.
- Keep print styling independent from the dark screen theme.

### Integrate with the platform

On the web, declare supported schemes so browser-provided controls can coordinate. Use semantic CSS variables or a consistent theming mechanism, initialize the theme without a visible flash, and verify form controls, scrollbars, selection, autofill, and metadata such as theme colors. Respect forced-colors mode and avoid opting out unless supplying an equivalent adaptation ([CSS Color Adjustment](https://www.w3.org/TR/css-color-adjust-1/)).

## Accessibility

- Test actual text pairs against [WCAG contrast minimums](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
- Keep meaningful control boundaries, state indicators, icons, and focus cues perceivable ([WCAG 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)).
- Do not claim dark mode is universally better for low vision, photosensitivity, eye strain, or dyslexia.
- Offer user choice where both themes are viable and avoid surprising theme switches.
- Test zoom, larger text, grayscale/color-vision differences, forced colors, increased contrast, reduced transparency, and realistic ambient light.
- Ensure theme controls have accessible names, states, keyboard operation, and no flicker or content loss.

## Failure modes

- **Mechanical inversion:** semantic roles, imagery, and hierarchy are reversed without review.
- **Dark mode has no shadows:** useful depth cues are removed because of an absolute rule.
- **Every raised surface is lighter:** nesting becomes striped and elevation semantics flatten.
- **Dim means sophisticated:** supporting text and borders become imperceptible.
- **Desaturate everything:** brand and semantic distinctions disappear.
- **Pure black as a requirement:** palette choice is treated as a definition rather than a contextual decision.
- **Only the happy path is themed:** errors, focus, autofill, charts, dialogs, and embedded content remain light or inaccessible.
- **Dark mode as accessibility mode:** individual user needs and contrast settings are ignored.

## Checklist

- [ ] Does the default respect system preference and any explicit override?
- [ ] Are all colors mapped through semantic roles?
- [ ] Are foreground/background pairs tested in each state?
- [ ] Is depth communicated with a coherent combination of cues?
- [ ] Are accents and brand colors retuned intentionally?
- [ ] Do images, charts, code, controls, and embedded content work in both themes?
- [ ] Are focus, selection, validation, loading, and unavailable states complete?
- [ ] Have forced colors, zoom, larger text, and realistic lighting been tested?
- [ ] Does the page initialize without a theme flash?
- [ ] Are unsupported health and accessibility claims absent?
