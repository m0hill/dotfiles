# Spotify Volume

Minimal Hammerspoon module that uses the unused media keys for Spotify volume:

- F7 / Previous/Rewind: Spotify volume down by `5%`
- F9 / Next/Fast-forward: Spotify volume up by `5%`

The real Mac volume up/down/mute keys are left alone.

If Spotify is not running or cannot be controlled, the key press is passed through normally. Hammerspoon needs Accessibility permission to catch the keys and Automation permission to control Spotify.
