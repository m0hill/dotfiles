[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
[ -f "$HOME/.deno/env" ] && . "$HOME/.deno/env"

[ -f "$HOME/.vite-plus/env" ] && . "$HOME/.vite-plus/env"

path=(
  "$HOME/.local/bin"
  "$HOME/.nub/bin"
  "/Applications/Racket v9.2/bin"
  "/opt/homebrew/opt/postgresql@15/bin"
  "$HOME/.bun/bin"
  "/Applications/Tailscale.app/Contents/MacOS"
  $path
)
typeset -U path PATH
