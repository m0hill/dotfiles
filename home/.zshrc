export ZSH="$HOME/.oh-my-zsh"

path=(
  "$HOME/.local/bin"
  "$HOME/.opencode/bin"
  "/opt/homebrew/opt/postgresql@15/bin"
  "$HOME/.bun/bin"
  "/Applications/Tailscale.app/Contents/MacOS"
  $path
)
typeset -U path PATH

[ -f "$HOME/.config/secrets.zsh" ] && source "$HOME/.config/secrets.zsh"

[[ -f "$HOME/.atuin/bin/env" ]] && source "$HOME/.atuin/bin/env"

ZSH_THEME=""

plugins=(
  git
  zsh-completions
  zsh-autosuggestions
  zsh-syntax-highlighting
)
source "$ZSH/oh-my-zsh.sh"

command -v mise >/dev/null && eval "$(mise activate zsh)"
command -v zoxide >/dev/null && eval "$(zoxide init zsh)"
command -v atuin >/dev/null && eval "$(atuin init zsh)"
command -v starship >/dev/null && eval "$(starship init zsh)"
