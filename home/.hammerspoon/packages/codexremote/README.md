# Codex Remote

A small web page for sending messages and photos from a phone to the thread currently open in Codex Desktop.

The HTTP server binds only to the Mac's Tailscale IPv4 address. It is not exposed on Wi-Fi, localhost, or the public internet. There is intentionally no additional authentication.

## Use

1. Leave Codex Desktop open on the thread you want to control.
2. Start Tailscale on the Mac and phone.
3. Reload Hammerspoon.
4. Open the Hammerspoon menubar → **Codex Remote** → **Copy Remote URL**.
5. Open that URL on the phone.
6. Continue the open thread, or tap **Start new chat** before sending. New chats automatically receive an instruction to copy every Codex response to the configured ntfy topic.

The URL has the form `http://100.x.x.x:8765`.

Codex Remote uses macOS Accessibility rather than blind mouse coordinates or clipboard pasting. It can press Codex's **New chat** button, send the ntfy delivery instruction, find the enabled composer, focus it, write the message, find the Send button, and press it. If Codex already contains an unsent draft or is not ready to send, the page reports an error instead of overwriting the draft.

Selected photos are uploaded unchanged to `/tmp/codex-remote/`. Their absolute paths are appended to the message so Codex can inspect them using its filesystem tools. You can send a message, photos, or both. Each photo can be up to 25 MB; macOS eventually clears the temporary files.

## Requirements

- Hammerspoon Accessibility permission
- Codex Desktop running with a thread open and filesystem access enabled when sending photos
- Tailscale connected on both devices
- Mac awake and logged in

## Testing and troubleshooting

- Use **Test Codex Composer Focus** in the Hammerspoon menubar. It focuses the composer without changing or sending text.
- If the module says it is waiting, start Tailscale and choose **Retry Tailscale**.
- The page is available only while Tailscale is connected.
- The port can be changed in `codexremote.json`.
