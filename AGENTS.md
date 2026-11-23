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
│   ├── .agents/skills/ # Personal agent skills (see Agent Skills)
│   └── ...
├── config/              # Stow package: ~/.config/ + ~/Library/
│   ├── .config/
│   │   ├── atuin/      # Shell history
│   │   ├── mise/       # Runtime versions
│   │   └── ...
│   └── Library/       # macOS application configuration
└── executor-apps/       # Executor app sources; not stowed (see Executor Apps)
```

## Build/Test Commands

### Test Changes (Always dry-run first)

```bash
# Preview what stow will do (NO changes made)
cd ~/dotfiles
stow -n -v -t ~ home config                    # Preview home/config

# Apply changes
stow -v -t ~ --restow home config              # Restow packages
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

### macOS application configuration

Prefer an application's native settings. If a file-based configuration is needed,
place it under `config/Library/` at its normal relative path and dry-run the
`config` package before applying Stow.

### Home directory dotfile

```bash
mv ~/.mydotfile home/
stow -v -t ~ home
```

## Agent Skills

`home/.agents/skills/` is the single skill catalog for every local agent: stow
links it to `~/.agents/skills`, and `~/.claude/skills` points at the same folder.
When adding, removing, or renaming a skill, update the attribution, invocation,
and relationship tables in `home/.agents/skills/README.md` in the same change.

`home/.agents/skills/synced/` is written by the Claude app and gitignored; leave
it alone.

## Executor Apps

Agents reach MCP services through one local Executor server
(`http://127.0.0.1:4312`), connected to each agent as `executor mcp`.
`executor-apps/<name>/` holds the source of apps written here (`index.ts` plus
`package.json` pinned to `executor apps framework`). Deploy a change with
`executor apps deploy --app <app-id> --files .` from the app's folder;
`executor apps list` shows app IDs. Accounts connect through Executor's secure
connection flow, so source holds URLs and approval rules, never credentials.

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

- **macOS-specific**: Library configuration paths, Homebrew locations
- **Tool guards**: Scripts must work even if tools missing
- **Brewfile**: macOS-only (Homebrew); separate Linux setup if needed
