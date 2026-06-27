# Screenshot Copy

Watches the native macOS screenshot folder and copies each newly saved screenshot to the clipboard as both image data and a file path fallback.

Works with screenshots saved by shortcuts like:

- `Cmd+Shift+3`
- `Cmd+Shift+4`
- `Cmd+Shift+5`

Notes:

- If an app accepts image paste, it should receive the image.
- If an app only accepts text, it can paste the screenshot file path instead.
- If macOS is already set to save screenshots to Clipboard, this module has nothing to do.
- It watches the folder configured by `defaults read com.apple.screencapture location`, falling back to `~/Desktop`.
- Use the Hammerspoon menubar → Automations → Screenshot Copy to open or refresh the watched folder.
