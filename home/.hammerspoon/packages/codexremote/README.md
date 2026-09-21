# Codex Remote

A small web page for sending messages from a phone to the thread currently open in Codex Desktop.

The HTTP server binds only to the Mac's Tailscale IPv4 address. It is not exposed on Wi-Fi, localhost, or the public internet. There is intentionally no additional authentication.

## Use

1. Leave Codex Desktop open on the thread you want to control.
2. Start Tailscale on the Mac and phone.
3. Reload Hammerspoon.
4. Open the Hammerspoon menubar → **Codex Remote** → **Copy Remote URL**.
5. Open that URL on the phone.

The URL has the form `http://100.x.x.x:8765`.

Codex Remote uses macOS Accessibility rather than blind mouse coordinates or clipboard pasting. It finds the enabled Codex composer, focuses it, writes the message, finds the Send button, and presses it. If Codex already contains an unsent draft or is not ready to send, the page reports an error instead of overwriting the draft.

## Requirements

- Hammerspoon Accessibility permission
- Codex Desktop running with a thread open
- Tailscale connected on both devices
- Mac awake and logged in

## Testing and troubleshooting

- Use **Test Codex Composer Focus** in the Hammerspoon menubar. It focuses the composer without changing or sending text.
- If the module says it is waiting, start Tailscale and choose **Retry Tailscale**.
- The page is available only while Tailscale is connected.
- The port can be changed in `codexremote.json`.
