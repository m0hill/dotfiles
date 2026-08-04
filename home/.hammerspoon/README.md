# Hammerspoon Config

This repo now acts as a plain `~/.hammerspoon` config.

There is one local menubar controller and local modules for launcher, tiling, autofocus, screenshots, color picking, port monitoring, local scripts, speech, OCR, overlays, and Spotify controls:

- `packages/launcher/`
- `packages/tiler/`
- `packages/autofocus/`
- `packages/screenshotcopy/`
- `packages/colorpicker/`
- `packages/ports/`
- `packages/codexgateway/`
- `packages/paper/`
- `packages/stt/`
- `packages/gemini/`
- `packages/lyrics/`
- `packages/spotifyvolume/`
- `packages/nomusic/`

No Spoon. No registry. No package versions.

## Structure

```text
~/.hammerspoon/
├── init.lua
├── packages/
│   ├── manager/
│   │   └── init.lua
│   ├── launcher/
│   │   ├── init.lua
│   │   └── launcher.json
│   ├── tiler/
│   │   ├── init.lua
│   │   └── tiler.json
│   ├── autofocus/
│   │   ├── init.lua
│   │   └── autofocus.json
│   ├── screenshotcopy/
│   │   ├── init.lua
│   │   └── screenshotcopy.json
│   ├── colorpicker/
│   │   ├── init.lua
│   │   └── colorpicker.json
│   ├── ports/
│   │   ├── init.lua
│   │   ├── ports.json
│   │   └── README.md
│   ├── codexgateway/
│   │   ├── init.lua
│   │   ├── codexgateway.json
│   │   └── README.md
│   ├── stt/
│   │   ├── init.lua
│   │   └── stt.json
│   ├── gemini/
│   │   ├── init.lua
│   │   └── gemini.json
│   ├── lyrics/
│   │   ├── init.lua
│   │   └── lyrics.json
│   └── spotifyvolume/
│       ├── init.lua
│       ├── spotifyvolume.json
│       └── README.md
└── README.md
```

Each package owns its own JSON file beside its code. That JSON stores:

- whether the module is enabled
- package settings
- package secrets
- hotkey overrides

## Usage

1. Put this repo at `~/.hammerspoon/`
2. Reload Hammerspoon
3. Use the menubar icon to enable modules, set secrets, and change hotkeys

The controller menu always shows all local modules.

## Modules

### Tiler

- `Ctrl+Option+Left/Right` snap the focused window to left/right half on the current screen
- `Ctrl+Option+Up` moves from the MacBook display to the external monitor, choosing an empty left/right half or maximizing if none is free
- `Ctrl+Option+Down` moves from the external monitor to the MacBook display and maximizes
- `Ctrl+Option+Return` maximizes with the configured gap
- default gap is `4px`

### Launcher

- `Cmd+Space` opens the app/file/clipboard command palette
- `Cmd+Shift+V` opens clipboard history

### Autofocus

- focuses on mouse-down so clicks on another monitor are less likely to be wasted only activating the app
- does not track mouse movement, so it avoids focus-follow-mouse jitter

### Screenshot Copy

- watches the native macOS screenshot folder
- copies newly saved screenshots from `Cmd+Shift+3`, `Cmd+Shift+4`, and `Cmd+Shift+5` to the clipboard as image data plus a path fallback
- uses the configured macOS screenshot location, falling back to `~/Desktop`

### Color Picker

- press `Cmd+Option+C`
- click any pixel on any screen
- copies the color as a hex code like `#AABBCC`

### Ports

- shows listening localhost TCP ports inside the manager's Ports submenu
- rows show `:port process pid` with actions to open, copy details, copy the list, or terminate after confirmation
- refreshes every `5s` using `lsof`

### Codex Gateway

- monitors the `com.m0hill.codex-gateway` user LaunchAgent
- reports local `/health` status
- provides start, restart, stop, and log actions
- disabling the module stops monitoring, not the gateway service

### STT

- local Parakeet v3 speech-to-text
- Apple Silicon and macOS 14+ only
- default trigger is `Right Option` alone
- can switch to a normal combo trigger in the menu
- requires `sox` and the local `stt-helper` binary
- stores the Parakeet model under `~/Library/Application Support/Hammerspoon/STT/cache`

### Gemini OCR

- press `Cmd+Shift+S`
- select a screen region
- extracted text is copied and pasted
- requires `GEMINI_API_KEY`

### Lyrics

- floating synced Spotify lyrics overlay
- remembers position, visibility, and scale

### Spotify Volume

- uses F7 / Previous for Spotify volume down and F9 / Next for volume up
- leaves the real Mac volume up/down/mute keys alone
- each press changes Spotify's `sound volume` by `5%`
- requires Hammerspoon Accessibility permission and Spotify Automation permission

### No Music

- prevents Apple Music and legacy iTunes from launching
- uses a small Swift `NSWorkspace` listener managed by Hammerspoon
- builds its helper automatically on first start
- can optionally open Spotify, another app, or a URL instead

## Notes

- package JSON files are created or updated when you change settings in the menu
- secrets now live inside each package JSON file
- the controller still provides shared helpers for settings, secrets, notifications, sounds, and hotkeys

## Troubleshooting

- STT needs the helper installed once: see `packages/stt/README.md`
- Gemini needs Screen Recording permission for Hammerspoon
- If a module fails, check the Hammerspoon console and toggle the module off/on
