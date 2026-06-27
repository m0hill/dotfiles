# Impeccable Inventory and Selection

Source reviewed: `pbakaus/impeccable` main branch, npm package `impeccable`, Apache-2.0.

## What Impeccable offers

| Area | What it is | Short description | Pi selection |
|---|---|---|---|
| Universal skill | `/impeccable <command>` | One agent skill that routes design tasks through a shared command vocabulary. | Adopt concept via this Pi skill, not the full generated bundle by default. |
| PRODUCT.md | Strategic context | Captures register, users, purpose, personality, anti-references, principles, accessibility. | Adopt. This is core. |
| DESIGN.md | Visual system context | Captures colors, type, elevation, components, do/don't rules with machine-readable frontmatter. | Adopt. This is core. |
| `.impeccable/design.json` | Visual sidecar | Stores richer token metadata, ramps, motion, breakpoints, snippets beyond DESIGN.md frontmatter. | Optional. Use only if a project needs tooling around tokens. |
| `init` flow | Project setup | Scans repo, interviews user, writes PRODUCT.md, offers DESIGN.md, configures live mode. | Adopt the scan + interview + docs parts. Skip live config unless asked. |
| `document` flow | Design extraction | Generates DESIGN.md from existing CSS/tokens/components/rendered output. | Adopt. Very useful. |
| `extract` flow | DS consolidation | Finds repeated UI patterns/tokens and extracts reusable components only when value is clear. | Adopt. Strong incremental design-system practice. |
| `shape` flow | Brief before code | Produces confirmed UX/UI direction before implementation. | Adopt for non-trivial UI. Keep compact when obvious. |
| `craft` flow | Build end-to-end | Shape, build production code, inspect in browser, iterate. | Adopt concept. Use existing Pi/browser tools rather than Impeccable live machinery. |
| `critique` flow | UX review | Independent design review + detector evidence + scored issues/personas. | Adopt lightweight version. Full scoring optional. |
| `audit` flow | Technical checks | Accessibility, performance, responsive, theming, anti-patterns. | Adopt. Run detector where useful. |
| `polish` flow | Pre-ship pass | Fixes spacing, alignment, consistency, states, micro-details. | Adopt. High value. |
| Refinement commands | bolder/quieter/distill/harden/onboard | Focused improvement modes for intensity, simplicity, resilience, first-run/empty states. | Adopt as vocabulary/workflows. |
| Enhancement commands | animate/colorize/typeset/layout/delight/overdrive | Focused improvements for motion, color, typography, layout, personality, ambitious effects. | Adopt selectively. Product UI should stay restrained. |
| Fix commands | clarify/adapt/optimize | UX copy, responsive adaptation, UI performance. | Adopt. |
| `pin` / `unpin` | Shortcut management | Creates standalone command aliases like `/audit`. | Skip in Pi; skill commands already exist as `/skill:name`. |
| `hooks` management | Hook lifecycle | Turns detector hooks on/off and manages ignore rules. | Optional/ask first. Pi does not use these provider-native hooks directly. |
| Detector CLI | `npx impeccable detect` | Scans files, dirs, or URLs for deterministic UI anti-patterns and quality issues. | Adopt as warning-only evidence. |
| Detector ignores | `npx impeccable ignores ...` | Manage ignored rules/files/values via `.impeccable/config.json`. | Adopt only for repos that run detector repeatedly. |
| Provider hooks | Claude/Codex/Cursor hooks | Auto-runs detector around UI edits and surfaces reminders. | Ask before enabling. Not native Pi yet. Could inspire a future Pi extension. |
| Live mode | Browser element variants | Injects helper script, lets user select elements, generates hot-swapped variants, accept/discard. | Powerful but heavy. Ask before use. Prefer normal browser QA first. |
| Browser extension | DevTools/panel | Runs detector/visual overlays in browser extension. | Skip by default. |
| Subagents | asset producer/manual edit applier | Helper agents for assets and live/manual edit application in certain harnesses. | Skip by default in Pi unless reimplemented. |
| Palette script | Seed palette guidance | Generates brand seed/color guidance for new projects. | Optional. Use only when starting greenfield visual identity. |
| Context scripts | context/context-signals | Load PRODUCT/DESIGN and suggest next commands. | Adopt behavior in instructions, not scripts. |
| Installer/link/update | `npx impeccable install/link/update` | Installs generated skills for many harnesses including Pi. | Do not run by default; user must opt in. |
| Website/docs/tests | impeccable.style + test suite | Product docs, examples, detector tests, build pipeline. | Reference only. |

## The 23 user-facing commands

| Command | Short description | Selection |
|---|---|---|
| `init` | Set up PRODUCT.md/DESIGN.md/live config. | Adopt docs; skip live unless asked. |
| `document` | Extract visual system into DESIGN.md. | Adopt. |
| `extract` | Consolidate repeated patterns/tokens/components. | Adopt. |
| `shape` | Plan UI/UX before code. | Adopt. |
| `craft` | Shape + build + visual iteration. | Adopt concept. |
| `critique` | UX/design review with scoring and detector evidence. | Adopt lightweight/full as task requires. |
| `audit` | A11y/perf/responsive/design-quality checks. | Adopt. |
| `polish` | Final pass before shipping. | Adopt. |
| `bolder` | Increase visual impact/personality. | Adopt for brand surfaces; careful in product UI. |
| `quieter` | Reduce loudness/overstimulation. | Adopt. |
| `distill` | Remove complexity/noise. | Adopt. |
| `harden` | Edge cases, errors, i18n, overflow, production states. | Adopt strongly. |
| `onboard` | First-run and empty states. | Adopt. |
| `animate` | Purposeful motion/micro-interactions. | Adopt with reduced-motion checks. |
| `colorize` | Add strategic color. | Adopt, token-driven. |
| `typeset` | Improve font choices/hierarchy/readability. | Adopt. |
| `layout` | Fix spacing, rhythm, hierarchy, composition. | Adopt. |
| `delight` | Add memorable touches/personality. | Adopt sparingly. |
| `overdrive` | Ambitious shaders/physics/visual effects. | Ask first; not default. |
| `clarify` | UX copy, labels, errors, instructions. | Adopt. |
| `adapt` | Responsive/device adaptation. | Adopt. |
| `optimize` | UI performance, rendering, images, bundle. | Adopt. |
| `live` | In-browser variant generation. | Optional/ask first. |

## Selection principle

The valuable part is not a visual style. It is a control system for AI UI work:

1. Persistent project context (`PRODUCT.md`, `DESIGN.md`).
2. Shared workflow vocabulary.
3. Deterministic checks as evidence.
4. Browser inspection after code changes.
5. Explicit governance for adding tokens/components.

Use those. Do not outsource taste to generic rules.
