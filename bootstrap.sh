#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

# Check/install Homebrew
if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew not found. Installing..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  
  # Add to PATH for Apple Silicon Macs
  if [[ -f /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  fi
fi

# Install packages from Brewfile
echo "Installing packages from Brewfile..."
brew bundle --file ./Brewfile

# Check stow
if ! command -v stow >/dev/null 2>&1; then
  echo "stow not found. Install with:"
  echo "  macOS: brew install stow"
  echo "  Ubuntu/Debian: sudo apt install stow"
  echo "  Arch: sudo pacman -S stow"
  exit 1
fi

# Install oh-my-zsh (non-interactive)
if [ ! -d "$HOME/.oh-my-zsh" ]; then
  echo "Installing oh-my-zsh..."
  RUNZSH=no CHSH=no KEEP_ZSHRC=yes \
    sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
fi

# Stow packages (idempotent with --restow)
echo "Stowing dotfiles..."
stow -v -t ~ --restow home config

# Stow ghostty to Application Support
mkdir -p ~/Library/Application\ Support/com.mitchellh.ghostty
stow -v -t ~/Library/Application\ Support/com.mitchellh.ghostty --restow ghostty

echo ""
echo "✅ Done!"
echo ""
echo "Next steps:"
echo "  1. Restart your terminal or run: source ~/.zshrc"
echo "  2. Copy secrets template: cp ~/.config/secrets.zsh.template ~/.config/secrets.zsh"
echo "  3. Edit and set permissions: chmod 600 ~/.config/secrets.zsh"
echo "  4. Populate with real values"
