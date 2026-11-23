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
# Homebrew exports FPATH; keep inherited completion paths from accumulating in nested shells.
typeset -U fpath FPATH

# Shims pick each project's pinned tools in non-interactive shells too (agents, git hooks).
command -v mise >/dev/null && eval "$(mise activate zsh --shims)"

# Keep Draw Things CLI models out of the (uninstalled) app's sandbox container.
export DRAWTHINGS_MODELS_DIR="$HOME/.local/share/draw-things/models"
