# Rules and Detector Catalogue

Project identity wins over generic rules. Use these as guardrails and review prompts, not as an external taste authority.

## Core guardrails

### Color
- Verify contrast: body text >= 4.5:1, large text >= 3:1.
- Avoid gray text on chromatic backgrounds; use a darker/lighter shade of the background hue or true foreground.
- Use existing semantic color tokens first.
- Do not add arbitrary hex colors unless extending the design system intentionally.

### Typography
- Body/prose line length: 65-75ch when reading is the task.
- Product UI usually wants one well-tuned family; brand surfaces may use more distinctive pairings.
- Avoid crushed display tracking below about `-0.04em`.
- Use `text-wrap: balance` for headings and `pretty` for long prose when supported.
- Test long words, small viewports, and code snippets for overflow.

### Layout
- Vary spacing by relationship: tight inside groups, wider between groups/sections.
- Cards are not the default grouping mechanism. Prefer typography, dividers, whitespace, and layout first.
- Nested cards are almost always wrong.
- Flex for 1D, grid for 2D.
- Use a real z-index scale; avoid `9999` unless a project already standardizes it.

### Motion
- Motion must have a job: state change, feedback, orientation, loading, reveal, or a deliberately memorable brand moment.
- Do not animate layout properties unless there is no better option.
- Prefer smooth ease-out curves; avoid bounce/elastic defaults.
- Always support `prefers-reduced-motion`.
- Do not gate content visibility on JavaScript-triggered reveal classes.

### Product UI specific
- Consistency over surprise.
- Accent color is for primary actions, current selection, and state indicators, not decoration.
- Every interactive component needs default, hover, focus, active, disabled, loading/error when applicable.
- Skeleton states beat centered spinners for content loading.
- Empty states should teach the next action.
- Do not reinvent standard controls for flavor.

### Tailwind and vanilla CSS split
Use Tailwind and CSS as a hybrid system, not as opposing religions.

- Tailwind applies the design system locally: component layout, spacing, responsive behavior, typography application, tokenized colors, borders/radii, and normal hover/focus/active/dark states.
- CSS defines the design system and handles cascade-native/global problems: `@theme` tokens, `@font-face`, base/reset styles, focus defaults, prose/markdown/CMS content, complex selectors, custom utilities, keyframes, third-party overrides, and hard-to-read arbitrary values.
- Prefer components/partials for repeated UI. Do not create CSS classes or `@apply` blocks just to hide long Tailwind class strings.
- `@apply` is an escape hatch, not the architecture. Use it mainly for tiny single-element primitives, third-party overrides, or non-component templating contexts.
- Arbitrary values are fine for true one-offs (`top-[117px]`, custom grid tracks, CSS variables). If repeated, promote the value into a token, utility, or component API.
- If a selector becomes unreadable as Tailwind arbitrary variants, move it to CSS.
- For content-heavy surfaces, docs, markdown, WYSIWYG, or semantic prose, lean more on CSS/base/prose rules because the generated HTML cannot reliably carry utility classes.
- For component-heavy product UI, lean Tailwind-first, with CSS kept small and deliberate.
- Do not add Tailwind to a tiny static page only because it is trendy; if Tailwind is already in the project, use the existing system.
- Knowing CSS remains required. Tailwind is a productivity layer over CSS, not a replacement for understanding layout, cascade, inheritance, specificity, and accessibility.

## Detector rule catalogue

These are the upstream deterministic rules reviewed from Impeccable. Treat `quality` rules as stronger than `slop` taste rules unless project docs say otherwise.

| Rule | Category | Meaning |
|---|---|---|
| `side-tab` | slop | Thick colored side border on card/callout. |
| `border-accent-on-rounded` | slop | Accent border clashes with rounded shape. |
| `overused-font` | slop | Common AI/default font such as Geist/Inter/Roboto. Often ignorable when intentional. |
| `single-font` | slop | One font everywhere on brand pages can flatten hierarchy. |
| `flat-type-hierarchy` | slop | Sizes too close together; hierarchy weak. |
| `gradient-text` | slop | Gradient-clipped text used decoratively. |
| `ai-color-palette` | slop | Purple/violet/cyan AI-template palette tells. |
| `cream-palette` | slop | Warm cream/beige “tasteful AI” default. |
| `nested-cards` | slop | Cards inside cards. |
| `monotonous-spacing` | slop | Same spacing everywhere; no rhythm. |
| `bounce-easing` | slop | Bounce/elastic easing feels dated. |
| `dark-glow` | slop | Dark mode with glowing neon accents as default. |
| `icon-tile-stack` | slop | Rounded icon tile stacked above every heading. |
| `italic-serif-display` | slop | Oversized italic serif hero trope; may be valid in editorial contexts. |
| `hero-eyebrow-chip` | slop | Tiny uppercase/pill label above hero headline. |
| `repeated-section-kickers` | slop | Same small kicker above every section. |
| `numbered-section-markers` | slop | 01/02/03 section scaffolding without real sequence meaning. |
| `em-dash-overuse` | slop | AI-ish copy cadence from repeated em dashes. |
| `marketing-buzzword` | slop | Generic SaaS words: streamline, empower, supercharge, etc. |
| `aphoristic-cadence` | slop | Repeated “Not X. Y.” contrast-copy cadence. |
| `oversized-h1` | slop | Long headline blown up too large for viewport. |
| `extreme-negative-tracking` | slop | Letter spacing so tight glyphs lose shape. |
| `broken-image` | quality | Empty/missing/placeholder image source. |
| `gray-on-color` | quality | Gray text washed out on colored background. |
| `low-contrast` | quality | Text fails WCAG contrast. |
| `layout-transition` | quality | Animating width/height/padding/margin causes layout thrash. |
| `line-length` | quality | Text lines too long for reading. |
| `cramped-padding` | quality | Text too close to bordered/colored container edge. |
| `body-text-viewport-edge` | quality | Body text touches viewport edge. |
| `tight-leading` | quality | Line-height too small for multi-line text. |
| `skipped-heading` | quality | Heading order skips levels. |
| `justified-text` | quality | Justified body text creates rivers without care. |
| `tiny-text` | quality | Body text below readable size. |
| `all-caps-body` | quality | Long uppercase passages harm readability. |
| `wide-tracking` | quality | Excessive tracking on body text. |
| `text-overflow` | quality | Content overflows container. |
| `clipped-overflow-container` | quality | Absolute/fixed child clipped by overflow parent. |
| `design-system-font` | quality | Font outside DESIGN.md. |
| `design-system-color` | quality | Color outside DESIGN.md. |
| `design-system-radius` | quality | Radius outside DESIGN.md. |
| `gpt-thin-border-wide-shadow` | slop | Hairline border plus wide soft shadow “ghost card.” |
| `repeating-stripes-gradient` | slop | Decorative repeating stripe gradients. |
| `theater-slop-phrase` | slop | Meta/theater copy framing instead of specific claim. |
| `image-hover-transform` | slop | Images scaling/rotating on hover as default decoration. |

## How to use detector output

1. Run it on the narrowest relevant files/directories.
2. Group findings by impact.
3. Check false positives against PRODUCT.md/DESIGN.md.
4. Fix quality/accessibility issues first.
5. For taste/slop findings, fix if they conflict with the project direction; ignore with rationale if intentional.
