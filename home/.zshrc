export ZSH="$HOME/.oh-my-zsh"

alias gs='git status -sb'
alias gsw='git switch'
alias gsm='git switch main'
alias gpl='git pull'
alias gpu='git push'
alias gpo='git push -u origin HEAD'
alias gsl='git stash list'
alias gsa='git stash apply'
alias gsd='git stash drop'
alias grs='git reset --soft HEAD~1'
alias gca='git commit --amend --no-edit'

gcm() {
  if (( $# == 0 )); then
    git commit
  else
    git commit -m "$*"
  fi
}

gsp() {
  if (( $# == 0 )); then
    git stash push
  else
    git stash push -m "$*"
  fi
}

gl() {
  git log --graph \
    --pretty="%Cred%h%Creset -%C(auto)%d%Creset %s %Cgreen(%ar) %C(bold blue)<%an>%Creset" \
    "$@"
}

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
  zsh-completions
  zsh-autosuggestions
  zsh-syntax-highlighting
)
source "$ZSH/oh-my-zsh.sh"

command -v mise >/dev/null && eval "$(mise activate zsh)"
command -v zoxide >/dev/null && eval "$(zoxide init zsh)"
command -v atuin >/dev/null && eval "$(atuin init zsh)"
command -v starship >/dev/null && eval "$(starship init zsh)"
