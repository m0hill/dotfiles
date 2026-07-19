# Image overlays and text legibility

Text over imagery is a variable-background problem, not a styling recipe. A gradient, scrim, shadow, or blur is a treatment; only the final rendered composite can demonstrate legibility.

## Principles

- Measure text contrast against the pixels immediately behind every part of the glyphs. Normal text generally needs 4.5:1 and large text 3:1 ([WCAG 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)).
- Prefer robust compositions in this order: separate solid surface, art-directed safe area, local backplate, localized scrim/gradient, then full-image tint when altering the entire image is acceptable.
- There is no universal overlay opacity, stop position, blur radius, or text color.
- Blur can reduce detail but does not guarantee luminance contrast. Give it a contrast-producing fallback.
- Keep copy and controls as real semantic content above the image rather than baking them into the bitmap.
- Protect both priorities: essential text/actions must remain usable, and essential image content must not be obscured or misleadingly altered.
- Design for crop changes, dynamic imagery, localization, text enlargement, states, and unsupported effects.

## Applying the guidance

### Decide what must remain visible

Classify the content:

1. **Essential text/actions:** headings, prices, legal text, status, and controls.
2. **Essential image details:** faces, products, diagrams, evidence, or details referenced by the copy.
3. **Decorative atmosphere:** content that can tolerate heavier tinting or cropping.

If text and essential image details compete for the same area, recompose the layout. Move the text or provide an opaque surface; an effect cannot create space where the content model has none.

### Choose the least fragile treatment

- **Separate surface:** place text beside, above, or below the image; best for long copy, controls, user-generated imagery, and essential photography.
- **Opaque backplate:** use a solid card, caption bar, or chip for a known background.
- **Art-directed safe area:** crop imagery so text occupies a consistently quiet region; preserve focal-point metadata.
- **Localized scrim or gradient:** shade the content region and extend protection beyond maximum expected copy bounds.
- **Full-image scrim:** suitable when the image is atmospheric or stable local protection is impossible.
- **Halo, outline, or shadow:** potentially useful for short labels but fragile for paragraphs and variable backgrounds.
- **Blur:** supplementary only; keep a solid or gradient fallback responsible for contrast.

### Verify the final composite

- Measure after overlay alpha, image pixels, filters, blend modes, theme, and states have been combined.
- Inspect the least favorable pixels adjacent to every line rather than an average background color.
- Check default, hover, pressed, selected, unavailable, and focus treatments as applicable.
- Ensure text, control labels, meaningful icons, boundaries, and focus indication meet their respective contrast requirements.
- Use a two-color focus indicator or local solid treatment when one ring color cannot survive both light and dark pixels.
- Validate on intended displays and in realistic ambient light; automated color checks alone may not fully sample variable imagery.

### Make variable content safe by construction

For CMS, commerce, social, and user-uploaded imagery:

- constrain copy to a known region with a deterministic minimum backplate or scrim;
- store focal points and safe-area metadata or provide art-directed crops;
- keep a conservative fallback if software chooses light/dark text from image analysis;
- give editors a preview using real copy and controls to change crop or treatment;
- test every reachable frame or position for video, carousels, and parallax backgrounds;
- define loading and error behavior so failed images or filters leave a sufficient explicit color pair.

Average luminance is not enough; a small bright patch behind one character can cause failure.

### Support responsive text growth

- Let the protected region grow with content instead of using a fixed pixel height.
- Test long translations, right-to-left layouts, multiline headings, dynamic type, browser zoom, and user spacing overrides.
- Ensure responsive crops do not move bright detail under the copy or hide the subject.
- At constrained widths or large text settings, switch to a solid surface above or below the image when overlaying is no longer robust.

### Preserve semantics and image meaning

- Keep heading, link, and button semantics in meaningful reading and focus order.
- Provide a contextual text alternative for informative images and mark redundant/decorative imagery appropriately ([WAI Images Tutorial](https://www.w3.org/WAI/tutorials/images/decision-tree/)).
- Do not let an overlay hide details the surrounding text asks sighted users to inspect.
- Do not tint product or documentary imagery so heavily that colors or evidence become misleading.

## Accessibility

- Treat contrast thresholds as a floor, especially for body copy over visually busy backgrounds.
- Keep controls and focus visible over every reachable image region.
- Test 200% text enlargement, narrow reflow, and user text-spacing overrides.
- Provide solid fallbacks for forced-colors, reduced-transparency settings, unsupported `backdrop-filter`, and failed background assets.
- Avoid making background movement or video essential to understanding; honor reduced-motion preferences.
- Keep accessible names aligned with visible labels and ensure decorative layers do not intercept pointer or focus events.
- Test low vision, color-vision differences, zoom, keyboard/switch input, screen readers, and voice input.

## Failure modes

- **Fixed-opacity recipe:** the same overlay is assumed to work over snow, sky, faces, and dark clothing.
- **Average-color checking:** a local highlight behind one glyph is missed.
- **Gradient ends inside copy:** text growth pushes lines into the unprotected transition.
- **Blur as contrast:** detail is reduced while luminance still fails.
- **Text shadow as universal fix:** some glyph edges remain below contrast and forced colors remove the effect.
- **One crop tested:** another viewport moves the subject or bright detail under text.
- **Text baked into imagery:** resize, translation, selection, and semantics are lost.
- **Image meaning sacrificed:** product color or documentary detail is altered for decoration.
- **Effect failure ignored:** unsupported filters or failed images remove the intended protection.

## Checklist

- [ ] Are text and essential image priorities explicit?
- [ ] Could the text use a separate solid surface instead?
- [ ] Is the chosen treatment the least fragile option?
- [ ] Was the final composite measured at its weakest pixels?
- [ ] Do controls, icons, and focus remain visible in every state?
- [ ] Are crops, translations, text growth, and dynamic imagery covered?
- [ ] Is there a robust fallback for failed assets, forced colors, and unsupported filters?
- [ ] Does semantic reading and focus order remain correct?
- [ ] Is informative imagery described without duplicating nearby content?
- [ ] Does the layout switch strategies when overlaying becomes unsafe?
