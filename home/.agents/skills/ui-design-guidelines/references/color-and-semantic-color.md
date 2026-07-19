# Color and semantic color

Treat color as a system of roles, not a collection of hex values. Color can support hierarchy, state, identity, and data interpretation, but it must not be the only carrier of important meaning.

## Principles

- Define raw palette values, then map them to semantic roles such as `text-primary`, `surface-raised`, `action-primary`, `focus-ring`, and `status-error`.
- Start from interface requirements: surfaces, readable content, actions, interaction states, feedback, and data visualization. One brand hue is a useful constraint, not a complete system.
- Establish comprehension without hue first, then use color to reinforce it. WCAG prohibits color as the only visual means of conveying important information or action ([WCAG 1.4.1](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)).
- Test each actual foreground/background pair. A color is not “accessible” in isolation.
- Treat mappings such as red/error and green/success as contextual conventions, not innate or universal meanings.
- Keep functional and decorative roles distinct so brand expression does not dilute state signals.
- Choose data palettes according to the data relationship rather than reusing a brand ramp indiscriminately.

## Applying the guidance

### Build the system from roles

Inventory:

1. **Foundations:** canvas, surfaces, overlays, borders, dividers, and scrims.
2. **Content:** primary, supporting, muted, inverse, link, visited link, and icons.
3. **Interaction:** actions, hover, pressed, selected, focus, and unavailable states.
4. **Feedback:** information, success, warning, error, and domain-specific critical states.
5. **Data:** categorical, sequential, and diverging series plus axes and annotations.
6. **Expression:** brand, illustration, editorial, and decorative roles.

Keep three layers when needed:

- **Primitive tokens:** visual values such as `purple-600`.
- **Semantic tokens:** intent such as `action-primary-bg`.
- **Component tokens:** a narrow mapping such as `button-primary-bg-hover`.

Components should normally consume semantic or component roles rather than arbitrary palette steps.

### Construct purposeful ramps

- Build a deliberate progression in perceived lightness; equal RGB or HSL increments may not look equally spaced.
- Give used stops defined roles instead of choosing numbers by eye.
- Test complete pairs for text, icons, borders, and states.
- Provide appropriate foreground, border/icon, and surface roles within a status family.
- Do not expect one brand ramp to distinguish focus, selection, disabled state, errors, successes, and chart categories safely.

### Assign semantics deliberately

Name intent before choosing hue. Validate conventions against culture, domain, platform, and neighboring colors.

- Pair statuses with explicit text and, where useful, distinct icons or shapes.
- Keep one meaning per semantic role and apply it consistently.
- Do not use error or success colors decoratively near ordinary content.
- Distinguish warning, error, destructive action, and emergency by consequence and language, even if related hues are used.
- Treat labels such as “new,” “beta,” or “featured” as product concepts rather than automatic success states.

### Design interaction states as a set

Review default, hover, pressed, selected, focus, invalid, unavailable, and loading states together.

- Never remove focus indication without an effective replacement.
- Keep focus distinguishable from validation error and selection.
- Use more than a subtle hue shift when the state matters.
- Preserve understandable unavailable states even where a contrast exception technically applies.

### Match palettes to data

- Use **categorical** palettes for unrelated groups, with redundant labels, shapes, or line styles.
- Use **sequential** palettes for ordered low-to-high values.
- Use **diverging** palettes around a meaningful midpoint.
- Avoid using familiar error red as an ordinary data series when users may infer failure.
- Prefer direct labels and provide underlying values or an accessible table.

### Theme by remapping roles

Do not mechanically invert a palette. Re-evaluate each semantic role in every theme:

- preserve hierarchy among canvas, surfaces, overlays, and borders;
- retune accents that dominate or vibrate on a different surround;
- test content, controls, focus, and status pairs again;
- coordinate browser and platform-provided controls with the declared color scheme;
- support forced-colors behavior rather than disabling it casually.

## Accessibility

- Normal text generally needs at least 4.5:1 contrast; large text needs at least 3:1 ([WCAG 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)).
- Required control boundaries, state indicators, meaningful icons, focus indicators, and graphics generally need 3:1 against adjacent colors ([WCAG 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)).
- Add visible non-color cues; a screen-reader label does not replace the visible cue needed by sighted users who cannot distinguish hues.
- Test grayscale and color-vision simulations as diagnostics, not proof. Include representative users where risk is high.
- Check light, dark, forced-colors, increased-contrast settings, print, zoom, and lower-quality displays.
- Review culturally and professionally specific meanings instead of assuming universal color psychology.

## Failure modes

- **One brand hue for everything:** actions, focus, selection, status, and charts become ambiguous.
- **Passing contrast equals accessible:** red/green may still be indistinguishable and meaning may remain color-only.
- **Accessible swatch:** contrast is claimed without naming the adjacent color and state.
- **Universal color psychology:** emotional or semantic associations are presented as facts.
- **Ramp without roles:** teams still choose values arbitrarily.
- **Status color as decoration:** error and success signals lose meaning.
- **Color-only charts:** legends require distant hue matching without redundant encoding.
- **Mechanical theme inversion:** hierarchy and contrast collapse in the alternate theme.
- **Decoration prohibited:** expressive color is removed unnecessarily instead of being kept subordinate to function.

## Checklist

- [ ] Can essential hierarchy and meaning be understood without hue?
- [ ] Are primitives separated from semantic and component roles?
- [ ] Does every semantic role have one documented purpose?
- [ ] Are brand, interaction, status, data, and decorative roles distinct?
- [ ] Are actual foreground/background pairs tested in every state and theme?
- [ ] Are focus, error, and selection distinguishable from one another?
- [ ] Do statuses include explicit text or another non-color cue?
- [ ] Does the chart palette match the data relationship?
- [ ] Have alternate themes, forced colors, zoom, and display variation been checked?
- [ ] Have domain and cultural meanings been validated where consequential?
