# Hammerspoon Config

This repo now acts as a plain `~/.hammerspoon` config.

There is one local menubar controller and four local modules:

- `packages/stt/`
- `packages/whisper/`
- `packages/gemini/`
- `packages/lyrics/`

No Spoon. No registry. No package versions.

## Structure

```text
~/.hammerspoon/
├── init.lua
	├── packages/
	│   ├── manager/
	│   │   └── init.lua
	│   ├── stt/
	│   │   ├── init.lua
	│   │   └── stt.json
	│   ├── whisper/
	│   │   ├── init.lua
│   │   └── whisper.json
│   ├── gemini/
│   │   ├── init.lua
│   │   └── gemini.json
│   └── lyrics/
│       ├── init.lua
│       └── lyrics.json
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

### Whisper

- hold `Option+/` to record
- release to transcribe and paste
- requires `sox` and `GROQ_API_KEY`

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

## Notes

- package JSON files are created or updated when you change settings in the menu
- secrets now live inside each package JSON file
- the controller still provides shared helpers for settings, secrets, notifications, sounds, and hotkeys

## Troubleshooting

- Whisper needs `sox`: run `brew install sox`
- STT needs the helper installed once: see `packages/stt/README.md`
- Gemini needs Screen Recording permission for Hammerspoon
- If a module fails, check the Hammerspoon console and toggle the module off/on
