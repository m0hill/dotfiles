export ZSH="$HOME/.oh-my-zsh"

alias assume=". assume"
alias ga='git add .'
alias gs='git status -sb'
alias gsw='git switch'
alias gpu='git push'
alias gpo='git push -u origin HEAD'
alias gsr='git reset --soft HEAD~1'
alias gca='git commit --amend --no-edit'
alias gcm='git commit -m'
alias gl='git log --graph --pretty="%Cred%h%Creset -%C(auto)%d%Creset %s %Cgreen(%ar) %C(bold blue)<%an>%Creset"'

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
