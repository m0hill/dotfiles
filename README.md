# Dotfiles

Managed with [GNU Stow](https://www.gnu.org/software/stow/).

## Setup

```bash
git clone <repo> ~/dotfiles && cd ~/dotfiles && ./bootstrap.sh
```

## Structure

```
home/     → ~/
config/   → ~/.config/ + ~/Library/Application Support/
```

## Commands

```bash
# Dry-run first
stow -n -v -t ~ home config

# Apply
stow -v -t ~ --restow home config
```

## Secrets

```bash
cp ~/.config/secrets.zsh.template ~/.config/secrets.zsh
chmod 600 ~/.config/secrets.zsh
# Edit with real values
```
