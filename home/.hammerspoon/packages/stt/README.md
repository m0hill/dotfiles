# STT

Press a trigger once to start recording, then press it again to transcribe locally with Parakeet Ultra and paste. The Swift helper uses FluidAudio 0.17.5 with `AsrModelVersion.ultra`. Press `Escape` while recording to cancel without transcribing.

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
- Parakeet Ultra cache lives under `~/Library/Application Support/Hammerspoon/STT/cache`
- Ultra uses its own model directory; an existing v3 download is not reused or deleted

## Upgrading from Parakeet v3

Rebuild and install the helper using the setup commands above, then reload Hammerspoon and click `Download Model`. Ultra requires a separate download (roughly 630 MB). The upgrade does not automatically delete v3; after verifying Ultra, its old `cache/FluidAudio/Models/parakeet-tdt-0.6b-v3` directory can be removed. `Delete Model` now deletes only Ultra.

After installing and testing the helper, `helper/.build` is also safe to remove: it is a regenerable Swift build cache, not a runtime dependency.

## Latency

- Resolve `rec` once when STT starts, not on the recording trigger.
- Launch capture before canvas, sound, menu updates, or model initialization. Helper executable checks use filesystem attributes, not a shell.
- Load Ultra in a helper process while recording. Once `rec` exits and finalizes the WAV, send `transcribe` on stdin to release the waiting helper. Cancel, short recordings, and disabling STT terminate that helper.
- The microphone is still opened on demand, never kept listening while idle. Models are released after each dictation rather than held in memory indefinitely.

The preload/off-hot-path approach was informed by [Handy's recorder lifecycle](https://github.com/cjpais/Handy/blob/56d64f586275d4663a14e70b3777ae0f108f65fb/src-tauri/src/managers/audio.rs). Handy also supports keeping its microphone stream warm; this implementation deliberately does not enable that behavior.

A local five-run generated-speech probe measured median helper latency of 138.5 ms cold versus 47.8 ms after preload. This excludes hardware capture startup, WAV finalization, and pasting, and is not an accuracy benchmark. A separate real Hammerspoon task/lifecycle probe using the same synthetic WAV delivered the transcript to a mocked paste boundary in 131 ms after stop. Very short recordings may still wait for model loading to finish.

## Checks

From the dotfiles repo root:

```sh
swift build -c release --package-path home/.hammerspoon/packages/stt/helper
```

Manually check recording, transcription/paste, Escape cancellation, and disabling STT while recording. Hardware microphone readiness still needs a manual dictation check.

## Troubleshooting

- if the menu says `Helper missing`, build and install `stt-helper`
- if the menu says `Secure Input`, macOS is blocking the `Right Option` trigger
- if `Download Model` fails, retry from the STT menu and check the Hammerspoon console
