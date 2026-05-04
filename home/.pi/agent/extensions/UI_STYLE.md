# Pi Extension Browser UI Style

Use this guide when creating or changing browser-based Pi extension UIs in this directory. The reference implementations are `feedback`, `diff`, and `phone`.

## Design intent

Build UIs that feel like polished terminal-native developer tools:

- Dark, quiet, and text-first.
- Dense but readable.
- Neutral by default; color is semantic and rare.
- Thin borders, layered graphite surfaces, restrained motion.
- Markdown, code, diffs, and annotations should feel first-class.

Avoid generic SaaS styling, bright gradients, heavy shadows, large rounded cards everywhere, or random accent palettes.

## Core tokens

Start every browser UI from this token set unless there is a strong reason not to:

```css
:root {
  --bg: #0a0a0a;
  --surface: #111111;
  --surface-hover: #1a1a1a;
  --surface-inset: #0d0d0d;
  --surface-card: #151515;
  --surface-card-hover: #181818;
  --border-subtle: #1f1f1f;
  --border: #262626;
  --border-strong: #404040;
  --fg: #f6fff5;
  --fg-secondary: #a3a3a3;
  --fg-muted: #737373;
  --accent: #e5e5e5;
  --accent-fg: #0a0a0a;
  --danger: #ef4444;
  --success: #22c55e;
  --warning: #facc15;
  --link: #60a5fa;
  --code: #f87171;
  --pre-bg: #0f0f0f;
  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.3);
  --shadow: 0 4px 6px -1px rgb(0 0 0 / 0.3), 0 2px 4px -2px rgb(0 0 0 / 0.3);
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.4), 0 4px 6px -4px rgb(0 0 0 / 0.4);
  --radius-sm: 6px;
  --radius: 10px;
  --radius-lg: 14px;
  --header-h: 60px;
  --font-ui: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
```

Use semantic variables instead of literal colors in component CSS. If a UI needs a new color, first ask whether it is really a semantic state.

## Base page reset

Use a minimal reset and keep rendering crisp:

```css
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: var(--font-ui);
  font-size: 15px;
  line-height: 1.6;
  background: var(--bg);
  color: var(--fg);
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

Use thin dark scrollbars:

```css
* {
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}

*::-webkit-scrollbar {
  width: 5px;
  height: 5px;
}

*::-webkit-scrollbar-track {
  background: transparent;
}

*::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 999px;
}

*::-webkit-scrollbar-thumb:hover {
  background: var(--border-strong);
}
```

## Layout patterns

### Topbar

Use a 60px topbar for desktop-style tools:

- fixed or normal depending on page needs
- `background: var(--surface)` or a slightly transparent surface on mobile
- `border-bottom: 1px solid var(--border)`
- horizontal padding around 18-28px
- prompt glyph at left (`›` for tools, `π` when Pi itself is the identity)
- title in mono, 13px, semibold
- subtitle/status in muted 12px text

The topbar should make the UI feel like an extension of the terminal, not a website header.

### Three-pane tools

For review/annotation/document tools, prefer:

```txt
fixed topbar
└── shell
    ├── left sidebar: index/files
    ├── main content: document/diff
    └── right sidebar: tools/feedback/annotations
```

Conventions:

- Sidebars use `var(--surface)` and 1px borders.
- Sidebar headers are 48px tall.
- Collapsible sidebars collapse to 44px when useful.
- Main content owns scrolling when possible.
- Right sidebars hold actions, drafts, annotations, and AI output.

### Mobile/chat tools

For phone-style UIs:

- Keep a compact topbar.
- Center the message feed with comfortable side padding.
- Put the composer fixed near the bottom with safe-area support.
- Use a glassy graphite composer only where it improves mobile ergonomics.

## Typography

Use `--font-ui` for interface text and `--font-mono` for:

- prompt glyphs
- file paths
- line numbers
- counts/stats
- code
- compact machine labels

Common type styles:

```css
.section-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--fg-muted);
  text-transform: uppercase;
  white-space: nowrap;
}

.mono-title {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--fg);
}
```

Text hierarchy:

- primary text: `--fg`
- normal body/supporting text: `--fg-secondary`
- labels/hints/empty states: `--fg-muted`

## Buttons

Default buttons are quiet graphite controls. Primary buttons are inverted light controls.

```css
button {
  font-family: var(--font-ui);
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.01em;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--fg-secondary);
  padding: 8px 14px;
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    color 0.15s ease,
    opacity 0.15s ease,
    transform 0.15s ease;
  white-space: nowrap;
  line-height: 1;
}

button:hover {
  background: var(--surface-hover);
  color: var(--fg);
  border-color: var(--border-strong);
  transform: translateY(-0.5px);
  box-shadow: var(--shadow-sm);
}

button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-fg);
  font-weight: 600;
}
```

Icon buttons should be small, transparent, and calm. Do not give icon buttons heavy backgrounds unless active.

## Forms

Use recessed dark inputs:

```css
textarea,
input,
select {
  width: 100%;
  background: var(--surface);
  color: var(--fg);
  border: 1px solid var(--border);
  padding: 10px 12px;
  font-family: var(--font-ui);
  font-size: 14px;
  line-height: 1.5;
  outline: none;
  border-radius: var(--radius-sm);
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

textarea:focus,
input:focus,
select:focus {
  border-color: var(--border-strong);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--link) 15%, transparent);
}
```

For primary editing areas, use `--surface-inset`, `--border-subtle`, and a slight inset highlight.

## Cards and annotations

Cards are subtle containers, not decorative panels:

```css
.card {
  border: 1px solid var(--border);
  background: var(--surface-card);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  box-shadow: none;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease,
    box-shadow 0.15s ease;
}

.card:hover {
  border-color: var(--border-strong);
  background: var(--surface-card-hover);
}
```

Annotation/comment content should usually use:

- 13px body text
- `--surface-hover` or `--surface-inset`
- a 3px left border for quote/comment emphasis
- mono font for quoted code/diff snippets

## Markdown and code

Browser UIs often display assistant output, diffs, or docs. Style markdown carefully.

Rules:

- Headings use `--fg`, strong weight, tight line height.
- `h1`/`h2` often get a subtle bottom border.
- Links use `--link` or understated `--fg` with border underline depending on context.
- Inline code uses `--code`, `--surface-hover`, and a 1px border.
- Code blocks use `--pre-bg`, `--border`, mono font, and horizontal scrolling.
- Tables have thin borders and dark header rows.
- Blockquotes use a 3px left border and muted text.

If rendering user/model-provided markdown as HTML in browser JavaScript, sanitize it or restrict dangerous tags/attributes.

## Loading and empty states

Use quiet empty states:

```css
.no-anno,
.empty-state {
  color: var(--fg-muted);
  font-size: 13px;
  text-align: center;
  padding: 26px 0;
}
```

Use the shared three-dot loader pattern:

```css
.loading {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--fg-muted);
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--fg-muted);
  animation: pulse 1.2s ease-in-out infinite;
}

.dot:nth-child(2) { animation-delay: 0.2s; }
.dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes pulse {
  0%, 100% { opacity: 0.25; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1); }
}
```

## Interaction rules

- Keep transitions between `0.12s` and `0.18s` for simple UI state changes.
- Prefer subtle hover background/border changes over flashy animation.
- Use `transform: translateY(-0.5px)` only for normal buttons, not dense lists or icon buttons.
- Interactive cards should have `role="button"`, `tabindex="0"`, and Enter-key handling when practical.
- Escape should close popovers/dialogs when practical.
- Preserve draft text when switching views or toggling display modes.

## Extension server rules

For browser-based extensions served from Pi:

- Bind local-only UIs to `127.0.0.1` unless remote access is intentional.
- Serve only known files (`index.html`, JS bundle, CSS), not whole directories.
- Validate JSON payloads at the HTTP boundary.
- Clean up servers on `session_shutdown`.
- Prefer `open` on macOS for launching local browser windows.

## When to share CSS

A new UI can copy these patterns locally. If multiple extensions need the same exact primitives, consider extracting a shared stylesheet such as:

```txt
agent/extensions/shared/pi-ui.css
```

Do this only when the shared layer makes extensions simpler. Do not force every UI into a rigid component framework.

## Agent checklist

Before finishing a browser UI, verify:

- It uses the core token palette.
- It has terminal/Pi identity via mono title and prompt glyph.
- It uses muted uppercase section labels.
- Primary actions use the inverted light button style.
- Random colors were not introduced.
- Markdown/code/diff output is styled and readable.
- Empty/loading/error states are present.
- Keyboard and focus behavior are acceptable.
- The layout works at narrow widths or has a deliberate mobile variant.
- Static serving is explicit and safe.
