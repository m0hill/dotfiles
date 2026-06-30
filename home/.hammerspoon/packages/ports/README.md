# Ports

Shows local TCP listening ports inside the Hammerspoon manager menu.

## Usage

- The manager submenu shows the current count/status for listening localhost ports.
- Rows show `:port process pid`.
- Each row can open the URL, copy details, or send `SIGTERM` to the process after confirmation.
- Use **Copy Port List** to copy the visible list.
- Use **Show All Interfaces** to include ports bound to non-localhost addresses.

## Notes

- Uses `/usr/sbin/lsof -nP -iTCP -sTCP:LISTEN +c0 -F pcn` under the hood.
- Refreshes every 5 seconds and can be refreshed manually from the menu.
