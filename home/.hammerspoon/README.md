# Hammerspoon Config

This repo now acts as a plain `~/.hammerspoon` config.

There is one local menubar controller and local modules for launcher, screenshots, port monitoring, local scripts, speech, overlays, and Spotify controls:

- `packages/launcher/`
- `packages/screenshotcopy/`
- `packages/ports/`
- `packages/scripts/`
- `packages/stt/`
- `packages/lyrics/`
- `packages/spotifyvolume/`

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
│   ├── screenshotcopy/
│   │   ├── init.lua
│   │   └── screenshotcopy.json
│   ├── ports/
│   │   ├── init.lua
│   │   ├── ports.json
│   │   └── README.md
│   ├── stt/
│   │   ├── init.lua
│   │   └── stt.json
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

### Launcher

- `Cmd+Space` opens the app/file/clipboard command palette
- `Cmd+Shift+V` opens clipboard history

### Screenshot Copy

- watches the native macOS screenshot folder
- copies newly saved screenshots from `Cmd+Shift+3`, `Cmd+Shift+4`, and `Cmd+Shift+5` to the clipboard as image data plus a path fallback
- uses the configured macOS screenshot location, falling back to `~/Desktop`

### Run Script

- Paper is the first script under **Automations → Run Script → Paper**
- use **Add Script…** to add other local scripts
- each script has run, cancel, last-result, reveal, and remove actions
- see `packages/scripts/README.md` for execution behavior and settings

### Ports

- shows listening localhost TCP ports inside the manager's Ports submenu
- rows show `:port process pid` with actions to open, copy details, copy the list, or terminate after confirmation
- refreshes every `5s` using `lsof`

### STT

- local Parakeet v3 speech-to-text
- Apple Silicon and macOS 14+ only
- default trigger is `Right Option` alone
- can switch to a normal combo trigger in the menu
- requires `sox` and the local `stt-helper` binary
- stores the Parakeet model under `~/Library/Application Support/Hammerspoon/STT/cache`

### Lyrics

- floating synced Spotify lyrics overlay
- remembers position, visibility, and scale

### Spotify Volume

- uses F7 / Previous for Spotify volume down and F9 / Next for volume up
- leaves the real Mac volume up/down/mute keys alone
- each press changes Spotify's `sound volume` by `5%`
- requires Hammerspoon Accessibility permission and Spotify Automation permission

## Notes

- package JSON files are created or updated when you change settings in the menu
- secrets now live inside each package JSON file
- the controller still provides shared helpers for settings, secrets, notifications, sounds, and hotkeys

## Troubleshooting

- STT needs the helper installed once: see `packages/stt/README.md`
- If a module fails, check the Hammerspoon console and toggle the module off/on
