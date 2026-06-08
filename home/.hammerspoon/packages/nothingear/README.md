# Nothing Ear

Control paired Nothing Ear earbuds from the Hammerspoon menu over BLE.

Validated device path:

- BLE service: `FD90`
- write characteristic: `68745353-1810-4B13-83A2-C1B21B652C9B`
- notify characteristic: `CA235943-1810-45E6-8326-FC8CA3BC45CE`

Music can keep playing while commands are sent.

## Setup

Build and install from the Hammerspoon menu:

1. Reload Hammerspoon.
2. Open `Automations > Nothing Ear`.
3. Click `Build / Install Helper`.
4. Click `Recheck Status`.

Manual equivalent:

```sh
swift build -c release --package-path ~/.hammerspoon/packages/nothingear/helper
APP=~/Library/Application\ Support/Hammerspoon/NothingEar/NothingEarHelper.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp ~/.hammerspoon/packages/nothingear/helper/NothingEarHelper-Info.plist "$APP/Contents/Info.plist"
cp ~/.hammerspoon/packages/nothingear/helper/.build/release/nothingear-helper "$APP/Contents/MacOS/nothingear-helper"
chmod +x "$APP/Contents/MacOS/nothingear-helper"
codesign --force --deep --sign - "$APP"
```

Smoke check:

```sh
~/Library/Application\ Support/Hammerspoon/NothingEar/NothingEarHelper.app/Contents/MacOS/nothingear-helper status
~/Library/Application\ Support/Hammerspoon/NothingEar/NothingEarHelper.app/Contents/MacOS/nothingear-helper anc-query
~/Library/Application\ Support/Hammerspoon/NothingEar/NothingEarHelper.app/Contents/MacOS/nothingear-helper battery
```

## Menu controls

- ANC: strong, medium, weak, smart, off, comfortable, transparency, smart ANC 2
- EQ: balanced, more voice, more treble, more bass, Dirac EQ, custom
- Battery refresh
- Bass boost query/set
- Protocol version query

## Storage

- package settings: `packages/nothingear/nothingear.json`
- helper app: `~/Library/Application Support/Hammerspoon/NothingEar/NothingEarHelper.app`
