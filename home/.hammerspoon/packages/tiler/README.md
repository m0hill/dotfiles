# Tiler

Focused-window snapping and screen moves for macOS.

Default hotkeys:

- `Ctrl+Option+Left`: snap focused window to left half on the current screen
- `Ctrl+Option+Right`: snap focused window to right half on the current screen
- `Ctrl+Option+Up`: move from the MacBook display to the external monitor; choose an empty left/right half, otherwise maximize
- `Ctrl+Option+Down`: move from the external monitor to the MacBook display and maximize
- `Ctrl+Option+Return`: cycle maximize with gap and native macOS full screen

The module is tuned for `Built-in Retina Display` below `WR40-PRO`, with vertical-position fallback if screen names are unavailable. It respects the menu bar and Dock by using each screen's visible frame. The default gap is `4px`.
