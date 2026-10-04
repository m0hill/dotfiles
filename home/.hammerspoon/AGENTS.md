# Hammerspoon agent instructions

## Before changing a module

- Read its README for behavior and setup. Read `packages/manager/init.lua` when changing registration, settings, secrets, or hotkeys; treat its implementation as the API reference.
- Keep product descriptions, module lists, setup steps, and user-facing shortcuts in READMEs, not this file.
- This is a live, symlinked config. Editing files changes the user's next reload. Preserve unrelated work and inspect ignored settings only as needed; never print secrets or clipboard contents.

## Implementation contracts

- Keep side effects in `start()`, not in the package factory. Make `stop()` release hotkeys, event taps, watchers, timers, tasks, windows, and callbacks owned by the module.
- Restart safely: stop an existing instance before starting it again. Invalidate pending callbacks so a stopped instance cannot update UI, paste, or report stale task results.
- Keep long-running external commands asynchronous with `hs.task`. Pass executable arguments as arrays rather than building shell command strings.
- Route settings, secrets, notifications, and configurable hotkeys through the controller. Preserve enabled state and custom settings when renaming a package; migrate existing data if present.
- Consume keyboard events only when the requested action succeeds; otherwise preserve native behavior. Pair consumed key-down events with their releases, including when modifiers change before release.
- Keep menu construction read-only. Menu callbacks must account for state changing after the menu was built. `manager.refreshMenu()` intentionally waits for the next menu opening; rebuilding an open menu closes it.
- For launcher UI changes, check the actual custom `hs.ui` API before implementing; fork documentation is at `~/projects/hammerspoon/extensions/ui/README.md` on this machine. Preserve the native HUD shell rather than approximating its material with CSS.
- Treat clipboard history and cached images as private user data. Keep them ignored by git, bound storage, and clean up evicted files. Use escaped text when rendering clipboard content in HTML.
- When removing a module, stop its live instance, remove its registration and docs, and privately back up local settings before removing its directory.

## Verify and apply

- Format changed Lua files with `stylua` and check the diff for whitespace errors.
- Validate Lua syntax in Hammerspoon's runtime with `hs -c 'assert(loadfile(hs.configdir .. "/packages/<module>/init.lua"))'`. A standalone Lua interpreter cannot verify Hammerspoon APIs or the custom fork.
- Run existing package-specific checks and exercise consequential behavior with isolated fixtures. Avoid changing the real clipboard, executing maintenance scripts, or adjusting Spotify volume just to validate code.
- For module-only changes, use the live controller's `stopModule(id)` then `startModule(id)`; this preserves whether the module is enabled. Do not call `startModule` twice without stopping.
- Registration changes require a config reload. Coordinate a full `hs.reload()` when unrelated modules are being edited or an automation is in flight; if deferred, explicitly tell the user the menu will update on reload.
- Report what was verified and whether changes are active or awaiting reload. Keep runtime JSON, clipboard/image caches, helper build output, and model downloads out of commits.
