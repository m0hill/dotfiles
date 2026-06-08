# STT

Press a trigger once to start recording, then press it again to transcribe locally with Parakeet and paste. Press `Escape` while recording to cancel without transcribing.

Apple Silicon and macOS 14+ are required.

## Setup

1. Install `sox`: `brew install sox`
2. Build the helper:
   `swift build -c release --package-path ~/.hammerspoon/packages/stt/helper`
3. Install the helper:
   `mkdir -p ~/Library/Application\ Support/Hammerspoon/STT/bin && cp ~/.hammerspoon/packages/stt/helper/.build/release/stt-helper ~/Library/Application\ Support/Hammerspoon/STT/bin/stt-helper`
4. Smoke check the helper:
   `~/Library/Application\ Support/Hammerspoon/STT/bin/stt-helper status`
5. Reload Hammerspoon
6. Open the controller menu
7. Enable `STT`
8. Click `Download Model`

## Trigger Modes

- default: tap `Right Option` alone to start, tap again to stop
- optional: switch to `Combo` in the STT menu and set a normal hotkey
- cancel: press `Escape` while recording to stop and discard the audio

## Storage

- package settings live in `packages/stt/stt.json`
- helper binary lives at `~/Library/Application Support/Hammerspoon/STT/bin/stt-helper`
- Parakeet cache lives under `~/Library/Application Support/Hammerspoon/STT/cache`

## Troubleshooting

- if the menu says `Helper missing`, build and install `stt-helper`
- if the menu says `Secure Input`, macOS is blocking the `Right Option` trigger
- if `Download Model` fails, retry from the STT menu and check the Hammerspoon console
