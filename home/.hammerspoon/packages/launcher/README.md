# Launcher

Minimal Hammerspoon command palette for the small Raycast subset I actually use:

- native AppKit launcher UI by default, with `hs.chooser` fallback
- app launching with app icons
- `fd`-backed file search with file-type icons
- clipboard history with content-aware icons

Enable it from the Hammerspoon menubar: **Automations → Launcher → Enable**.

Default hotkeys:

- `Cmd+Space` opens the full launcher: apps, files, and clipboard.
- `Cmd+Shift+V` opens clipboard history only.

Both can be changed from the Launcher hotkey menu.

The native UI is a single Swift/AppKit file at `NativeLauncher.swift`. Hammerspoon builds it on demand into `packages/launcher/bin/native-launcher` and talks to it over an authenticated localhost HTTP server. Disable **Use Native UI** from the Launcher menu to fall back to `hs.chooser`.

Clipboard history is stored locally in `packages/launcher/clipboard.json`, which is ignored by git via the repository `*.json` rule.

## Notes

- File search uses `fd` asynchronously (installed via the Brewfile) over common home folders/dev roots with ignore/exclude rules for consistent low-latency results.
- File results use cached file-type icons by extension, with path-based icons as a fallback for folders or extensionless files.
- Clipboard results use a path icon for copied file paths, a web location icon for URLs, and a text document icon for normal text.
- App search includes aliases for common system app renames, so `settings`, `prefs`, or `preferences` prefer System Settings over matching files/folders.
- The empty launcher ranks apps by persisted launch usage instead of alphabetical order; use **Reset App Usage** from the menu to clear it.
- Clipboard capture ignores common password-manager bundle IDs by default.
- No terminal, fzf, libghostty, cloud sync, extensions, or AI features are involved.
