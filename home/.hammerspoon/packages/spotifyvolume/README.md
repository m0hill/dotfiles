# Spotify Volume

Use the normal audio volume keys with **Option** held to adjust Spotify's app volume:

- **Option + Volume Down**: Spotify volume down by 7 percentage points.
- **Option + Volume Up**: Spotify volume up by 7 percentage points.

On a standard Mac keyboard these are the speaker keys on F11/F12. Use the actual volume-key events, not plain function-key events; the Fn/Globe requirement depends on your keyboard settings.

Plain volume keys still control macOS volume. F7/F9 retain their normal previous/next-track behavior. Mute is unchanged. Option+Shift+volume keeps the native fine-volume shortcut; other modifier combinations pass through too.

If Spotify is not running or cannot be controlled, the key press passes through normally (Option+volume may open macOS Sound settings). Hammerspoon needs Accessibility permission to intercept media keys and Automation permission to control Spotify.
