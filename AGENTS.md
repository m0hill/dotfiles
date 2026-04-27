# AGENTS.md - Dotfiles Repository

Guidelines for AI assistants working with this GNU Stow-based dotfiles repository.

## Repository Structure

```
dotfiles/
├── bootstrap.sh          # One-command setup script
├── Brewfile             # Homebrew dependencies
├── .gitignore           # Global ignore rules
├── home/                # Stow package: ~/
│   ├── .zshrc          # Shell config with guards
│   ├── .gitconfig      # Git config (portable paths)
│   └── ...
└── config/              # Stow package: ~/.config/ + ~/Library/
    ├── .config/
    │   ├── atuin/      # Shell history
    │   ├── mise/       # Runtime versions
    │   └── ...
    └── Library/Application Support/com.mitchellh.ghostty/
        └── config
```

## Build/Test Commands

### Test Changes (Always dry-run first)
```bash
# Preview what stow will do (NO changes made)
cd ~/dotfiles
stow -n -v -t ~ home config                    # Preview home/config
stow -n -v -t ~/Library/Application\ Support/com.mitchellh.ghostty ghostty

# Apply changes
stow -v -t ~ --restow home config              # Restow packages
stow -v -t ~/Library/Application\ Support/com.mitchellh.ghostty --restow ghostty
```

### Single Package Testing
```bash
stow -n -v -t ~ home          # Test only home package
stow -n -v -t ~ config        # Test only config package
```

### Check Current State
```bash
ls -la ~ | grep "dotfiles"    # See active symlinks
git status                     # Check what's changed
```

### Bootstrap Testing (Fresh Machine Simulation)
```bash
./bootstrap.sh                 # Full setup: Homebrew + packages + stow
```

## Code Style Guidelines

### Shell Scripts (bootstrap.sh)
- **Use `set -euo pipefail`** at top of all scripts
- **Guard external commands**: `command -v tool >/dev/null && eval "..."`
- **Quote variables**: `"$HOME"`, `"$0"`, not `$HOME`
- **Portable paths**: Use `~` not `/Users/mohil/...`
- **Non-interactive installs**: Use flags like `RUNZSH=no CHSH=no KEEP_ZSHRC=yes`

### Git Config
- **Use `~` for paths**: `excludesfile = ~/.config/git/ignore`
- **Never hardcode user paths**: Avoid `/Users/mohil/`

### Zsh Config
- **Source with guards**: `[ -f "$file" ] && source "$file"`
- **Check before eval**: `command -v tool >/dev/null && eval "$(...)"`
- **macOS-specific guards**: `[[ -x /opt/homebrew/bin/brew ]] && ...`

### Brewfile
- Group by type: `brew`, `cask`, `vscode`, `cargo`
- Comment sections for clarity
- Keep minimal: only essential tools

### Secrets Management
- **Template pattern**: `secrets.zsh.template` with `=YOUR_VALUE_HERE`
- **Gitignore**: Add `.config/secrets.zsh` to root `.gitignore`
- **Never commit real values**: Check with `git diff --cached`
- **Permissions**: `chmod 600 ~/.config/secrets.zsh`

## Adding New Configs

### Standard ~/.config/ tool
```bash
mkdir -p config/.config/toolname
mv ~/.config/toolname/* config/.config/toolname/
stow -n -v -t ~ config    # Test
stow -v -t ~ config       # Apply
```

### Non-standard location (like Ghostty)
```bash
mkdir toolname
mv ~/Library/Application\ Support/com.vendor.toolname/config toolname/
stow -v -t ~/Library/Application\ Support/com.vendor.toolname toolname
```

### Home directory dotfile
```bash
mv ~/.mydotfile home/
stow -v -t ~ home
```

## Common Patterns

### Check for Sensitive Data Before Commit
```bash
# Scan for tokens, keys, passwords
grep -r "api_key\|token\|password\|secret" --include="*.sh" --include="*.zsh" .
# Review all new files
git diff --name-only --cached
```

### Restore from Backup
```bash
# If stow breaks something
cp -a ~/dotfiles-backup-*/. ~/
```

### Clean Up Dead Symlinks
```bash
find ~ -type l ! -exec test -e {} \; -print  # Find broken links
find ~ -type l ! -exec test -e {} \; -delete # Remove them
```

## Security & Safety Rules

1. **Always backup before major changes**
2. **Never commit**: `secrets.zsh`, `.env`, tokens, SSH keys, history files
3. **Use `.gitignore`**: Add patterns before they become problems
4. **Test on dry-run first**: `stow -n` is your safety net
5. **Check machine-specific paths**: Avoid absolute paths in configs

## Cross-Platform Notes

- **macOS-specific**: Ghostty path, Homebrew locations
- **Tool guards**: Scripts must work even if tools missing
- **Brewfile**: macOS-only (Homebrew); separate Linux setup if needed

<!-- opensrc:start -->

## Source Code Reference

Source code for dependencies is available in `opensrc/` for deeper understanding of implementation details.

See `opensrc/sources.json` for the list of available packages and their versions.

Use this source code when you need to understand how a package works internally, not just its types/interface.

### Fetching Additional Source Code

To fetch source code for a package or repository you need to understand, run:

```bash
npx opensrc <package>           # npm package (e.g., npx opensrc zod)
npx opensrc pypi:<package>      # Python package (e.g., npx opensrc pypi:requests)
npx opensrc crates:<package>    # Rust crate (e.g., npx opensrc crates:serde)
npx opensrc <owner>/<repo>      # GitHub repo (e.g., npx opensrc vercel/ai)
```

<!-- opensrc:end -->