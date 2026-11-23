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
# Vanilla pi: built-in tools only, no skills/MCP/extensions/context files.
alias piv='pi --model abliteration/abliterated-model-large-flash --no-skills --no-mcp --no-extensions --no-prompt-templates --no-context-files --tools read,bash,edit,write'

[ -f "$HOME/.config/secrets.zsh" ] && source "$HOME/.config/secrets.zsh"

[[ -f "$HOME/.atuin/bin/env" ]] && source "$HOME/.atuin/bin/env"

ZSH_THEME=""

# Keep completion setup local to this shell instead of exporting Oh My Zsh's
# paths to children. Add Homebrew completions for non-login shells as well.
typeset +x FPATH
[[ -d /opt/homebrew/share/zsh/site-functions ]] && fpath=(/opt/homebrew/share/zsh/site-functions $fpath)

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
