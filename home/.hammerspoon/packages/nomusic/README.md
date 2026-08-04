# No Music

Prevents Apple Music and legacy iTunes from launching. The module is based on the small core of [noTunes](https://github.com/tombonez/noTunes): a Swift process observes `NSWorkspace.willLaunchApplicationNotification` and force-terminates either Apple music app by bundle identifier.

Hammerspoon owns the lifecycle and settings:

- enabling the module starts the blocker
- disabling it terminates the blocker
- the first start, or a source change, compiles `helper/main.swift` with the installed Xcode Command Line Tools
- the generated binary lives outside the dotfiles repo at `~/Library/Application Support/Hammerspoon/NoMusic/bin/nomusic-helper`

## Replacement

By default, blocked launches do nothing. In **Automations → No Music**, choose **Use Spotify** or set any app path/URL as the replacement. The replacement opens only when a new Music/iTunes launch is intercepted, not when Hammerspoon initially finds and closes an already-running instance.

## Requirements

- macOS
- Hammerspoon running at login
- Xcode Command Line Tools (`xcode-select --install`) for the initial helper build

Use **Rebuild Swift Helper** from the module menu after toolchain changes if needed.
