# Typography

Typography makes language readable, establishes hierarchy, and gives interface text an appropriate voice. Treat it as a system of semantic roles, not a collection of attractive font sizes.

## Principles

- Start with real content and reading conditions: labels, paragraphs, numbers, errors, supported languages, display quality, distance, and zoom.
- Use the fewest type families that do the job, not an arbitrary maximum. One versatile family is often efficient; a second can legitimately serve code, mathematics, editorial display, or another script.
- Define named roles such as body, label, supporting text, title, and display. Each role combines family, size, weight, line height, tracking, and color.
- Keep visual roles separate from semantic headings. `h1`–`h6` express document structure, not six predetermined visual sizes ([WCAG 1.3.1](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html)).
- Make hierarchy clear without relying on size alone. Combine typography with content order, spacing, position, and grouping.
- Let text adapt. Prefer relative sizing and flexible containers; do not impose universal size ceilings for landing pages, dashboards, or other products.
- Default to the typeface’s spacing. Tight tracking and compact line height can suit short display text, but they are not universal quality switches.

## Applying the guidance

### Build a semantic type system

1. Inventory actual roles: long-form body, short UI copy, labels, helper text, table values, code, titles, and display text.
2. Name tokens by purpose rather than tag: for example, `body-md`, `label-sm`, and `title-lg`.
3. Remove near-duplicate roles that communicate no meaningful difference.
4. Establish document structure in markup, then map visual roles onto it.
5. Test the entire scale together with real content and every supported weight.

A visual `title-lg` can be used on an `h2`; an application’s `h1` may use a compact title. Never skip or select heading levels merely to obtain a preferred size.

### Select typefaces deliberately

Evaluate candidates with production strings:

- scripts, diacritics, symbols, currencies, and punctuation;
- distinguishability of task-critical glyphs such as `I`, `l`, `1`, `O`, and `0`;
- genuine weights and italics rather than synthetic styles;
- body reading, compact labels, tabular numerals, code, and data alignment;
- rendering on target operating systems and lower-quality displays;
- file size, fallback behavior, loading, licensing, and subsetting.

A “one-font” design still needs a fallback stack for failed downloads and missing glyphs. If adding a second family, give it a specific role and verify that the contrast is useful rather than merely novel.

### Set size, measure, and wrapping for context

There is no universal minimum or maximum CSS pixel size for every typeface, language, display, or viewing distance.

- Use relative units and inherit user defaults where practical.
- Let labels and paragraphs wrap; avoid fixed-height text containers.
- Test long translations, unbroken values, dynamic data, and user-authored content.
- Keep long-form measures comfortable; evaluate line length with the actual language and task rather than blindly applying one character count.
- Use logical start alignment for ordinary reading text unless the language or composition requires another treatment.
- For distant displays such as kiosks or TVs, design for viewing conditions rather than desktop conventions.

### Tune line height and spacing by role

- Short display headings can use a compact line height if lines, accents, and descenders do not collide.
- Multi-line body copy generally needs more line separation for tracking from one line to the next.
- Controls and labels need a line box that avoids clipping under localization and font fallback.
- Prefer unitless line height where inheritance should scale with font size.
- Keep paragraph spacing distinct from line height and component gaps.

Treat numeric ranges from a design system as contextual starting points. Test the actual face, size, measure, script, and rendering environment.

### Adjust tracking only for a reason

- Leave body text at the typeface’s designed spacing by default.
- Modest tightening may suit very large, short display text.
- Modest expansion may help small uppercase labels.
- Negative tracking is risky at small sizes, light weights, dense letter combinations, and in scripts whose shaping rules differ from Latin.
- Always test real strings, localization, fallback fonts, and browser rendering.

### Make font delivery part of the design

Use resilient fallbacks, appropriate loading behavior, and compatible fallback metrics to reduce invisible text and layout shift. Subset only when required characters remain available. Do not let a font failure erase labels, icons, or critical content.

## Accessibility

- Preserve content and functionality at 200% text enlargement and during reflow ([WCAG 1.4.4](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html), [1.4.10](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)).
- Survive user overrides for line, paragraph, letter, and word spacing without clipping or overlap ([WCAG 1.4.12](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html)).
- Meet text contrast requirements in every state and theme.
- Keep headings and labels descriptive of their topic or purpose ([WCAG 2.4.6](https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html)).
- Mark language changes and test scripts with native readers and appropriate typographic guidance.
- Avoid images of text when real text can provide the intended presentation.

## Failure modes

- **One family as a law:** code, mathematics, another script, or editorial content is forced into an unsuitable face.
- **Visual scale equals heading structure:** H1–H6 become size tokens rather than semantics.
- **A fixed size quota:** useful roles are removed or near-duplicates retained merely to hit a number.
- **Dashboard maximum:** key metrics or low-vision needs are constrained by an arbitrary ceiling.
- **Negative tracking as polish:** collisions and reduced readability are mistaken for sophistication.
- **Typeface specimen testing only:** production symbols, fallback, localization, and errors are ignored.
- **Fixed text boxes:** zoom and translation clip or overlap content.
- **Font loading ignored:** invisible text or layout shift damages the experience.

## Checklist

- [ ] Are type roles named by purpose and distinct from heading levels?
- [ ] Does every family have a specific job?
- [ ] Have required scripts, symbols, weights, and fallback glyphs been tested?
- [ ] Are hierarchy differences noticeable without relying on size alone?
- [ ] Do line height and tracking fit the actual face, role, and language?
- [ ] Can text wrap, enlarge, and reflow without loss?
- [ ] Do localization and user spacing overrides remain usable?
- [ ] Does font loading preserve readable content and layout stability?
- [ ] Have unnecessary near-duplicate roles been removed?
