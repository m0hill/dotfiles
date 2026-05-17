# Agent Guidelines

## Project Structure

```
power-spoons/
├── init.lua              # Hammerspoon entry point
├── README.md             # User-facing docs
├── AGENTS.md             # This file
└── packages/
    ├── manager/
    │   └── init.lua      # Local controller + menubar
    ├── tiler/
    │   ├── init.lua      # Module entry point
    │   ├── tiler.json    # Local settings, created on demand
    │   └── README.md
    ├── stt/
    ├── gemini/
    └── lyrics/
```

## Runtime Model

- This repo is a plain `~/.hammerspoon` config
- No Spoon packaging
- No remote registry
- No versioned package files
- No runtime downloads
- Each package keeps its JSON beside its code

## Build/Test/Lint Commands

- **Reload config**: Open Hammerspoon console and click "Reload Config" or run `hs.reload()`
- **Test script**: `hs /Users/mohil/.hammerspoon/init.lua`
- **No formal tests**: Test manually in Hammerspoon

## Code Style

### Language & Structure

- Language: Lua 5.3+ (Hammerspoon runtime)
- Packages live in `packages/`
- Each package returns a factory function that takes the local controller
- Factory returns a table with `start()`, `stop()`, and optionally `getMenuItems()` and `getHotkeySpec()`
- Package pattern: `return function(manager) ... end`

### Docstrings (Optional)

Packages can include docstrings at the top of init.lua for documentation:

```lua
--- Package Name
--- Brief description of what the package does.
---
--- @package packageid
--- @version v1
--- @author yourname
```

### Variables & Naming

- `SCREAMING_SNAKE_CASE` for constants and config tables (e.g., `CONFIG`, `MODELS`, `LANGUAGES`)
- `camelCase` for local functions (e.g., `createIndicator`, `updateMenuBar`, `formatTime`)
- `snake_case` for module-level state variables (e.g., `currentTrackId`, `pollTimer`, `menubar`)
- Prefix private settings keys with module name (e.g., `"lyrics.overlay.frame"`, `"tiler.gap"`)

### Imports & Dependencies

- Access Hammerspoon APIs via `hs.*`
- Use `manager.getSecret(key)` for package-owned secrets
- Use `manager.getSetting(packageId, key, default)` for package settings

### Error Handling

- Use `pcall()` for JSON parsing: `local ok, result = pcall(hs.json.decode, data)`
- Check dependencies at init time (e.g., check for `sox` binary and API keys)
- Validate state before operations (e.g., check if file exists with `hs.fs.attributes()`)
- Gracefully handle missing data with fallback messages in UI

### Secrets Management

- Secrets live in each package JSON file beside the package code
- Access secrets via `manager.getSecret("KEY_NAME")`
- Never hardcode API keys in source files

### Settings Management

- Each package gets its own settings file: `packages/{packageId}/{packageId}.json`
- Access via manager API:
  ```lua
  manager.getSetting(packageId, "key", defaultValue)
  manager.setSetting(packageId, "key", value)
  ```
- Settings and secrets are plain JSON
- Settings persist across restarts automatically

### Menubar Integration

- Packages can expose menu items via `getMenuItems()`
- Menu items are plain tables: `{ title = "...", fn = function() ... end }`
- Returned menu items are inserted into the package submenu automatically
- The controller handles menu rendering and refresh

### Hotkeys (Configurable)

Packages can expose configurable hotkeys using the Spoons-compatible `getHotkeySpec()` convention:

```lua
-- Default hotkey (used if user hasn't customized)
local DEFAULT_HOTKEY = { { "cmd", "shift" }, "s" }

function P.getHotkeySpec()
    return {
        capture = {
            fn = startCapture,  -- Simple: single function
            description = "Start Capture",
        },
        record = {
            fn = { press = startRecording, release = stopRecording },  -- Hold-style
            description = "Hold to Record",
        },
    }
end

function P.start()
    -- Get configured or default hotkey
    local hotkeyDef = manager.getHotkey(PACKAGE_ID, "capture", DEFAULT_HOTKEY)
    if hotkeyDef then
        local spec = P.getHotkeySpec()
        boundHotkeys = manager.bindHotkeysToSpec(PACKAGE_ID, spec, { capture = hotkeyDef })
    end
end
```

Users can customize hotkeys via the menubar UI. The controller stores custom hotkeys in the package JSON under the `settings.hotkeys` key.

---

## Creating a New Package

1. Create `packages/mypackage/init.lua`
2. Return `function(manager) ... end`
3. Add `start()` and `stop()`
4. Optionally add `getMenuItems()` and `getHotkeySpec()`
5. Register metadata in `packages/manager/init.lua`

## Manager API Reference

### Secrets

```lua
manager.getSecret(key)                    -- Get API key
manager.setSecret(key, value)             -- Set API key (usually via GUI)
```

### Settings

```lua
manager.getSetting(packageId, key, default)     -- Get setting with default
manager.setSetting(packageId, key, value)       -- Set setting
manager.getSettings(packageId)                  -- Get all settings as table
manager.setSettings(packageId, table)           -- Set all settings
```

### Hotkeys

```lua
manager.getHotkey(packageId, action, default)   -- Get configured hotkey with fallback
manager.setHotkey(packageId, action, hotkeyDef) -- Set hotkey (nil to clear)
manager.parseHotkeyString("Cmd+Shift+S")        -- Parse string to {{mods}, key}
manager.formatHotkeyString({{"cmd", "shift"}, "s"}) -- Format to string
manager.bindHotkeysToSpec(packageId, spec, mapping) -- Bind hotkeys from spec
```

## Package Lifecycle

1. **Start:** Controller loads local package code → factory executes → `start()` called
2. **Stop:** `stop()` called → instance removed from memory

## Persistence

- **Package code:** `packages/{packageId}/init.lua`
- **Settings + secrets:** `packages/{packageId}/{packageId}.json`

All persisted package data is plain JSON beside the package code.
