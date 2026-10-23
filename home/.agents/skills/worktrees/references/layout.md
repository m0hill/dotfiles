# Root layout and setup

```text
~/work/sind/caretomo/
  .bare/             Shared Git repository, refs, and worktree registrations
  .git               gitdir: ./.bare
  .worktrees.json    Local setup profile; outside all tracked checkouts
  mise.toml          Local Node/Python versions inherited by the checkouts
  AGENTS.md          Routes agents to the skill and selected checkout's guides
  .local/            Setup markers, locks, migration backups
  main/              Default source for ignored configuration and dependencies
  500/               Task checkout (for example, branch mohil/500)
```

The `wt` executable and skill are maintained in dotfiles. Each repository has its
own root and setup profile. Infrastructure is independent of Caretomo tasks.

## Migration

`wt migrate /path/to/clone /path/to/new-root --profile caretomo` migrates only the
primary checkout. It first records refs, worktree status, and the original Git
configuration; it retains the original Git metadata under `.local/migration/`.
Existing linked checkout files stay at their old locations, attached to that
retained metadata, and are excluded from the new task system. An old-path symlink
points at the new main checkout for callers using the previous location.

Migration preserves the primary checkout's index, working files, ignored files,
local refs, remotes, stashes, and reflogs. It refuses in-progress Git operations,
linked source checkouts, submodules, an occupied destination, and cross-device
moves. Stop concurrent Git writes before migrating. Existing processes may retain
their old cwd; the compatibility symlink keeps absolute runtime paths usable.
Restart them from the new checkout when convenient.

Migration is a local operation, not a push or a rewrite of shared history. The
backup contains repository-local configuration and must stay private. Inspect
`.local/migration/manifest.json` for the previous paths and preserved state. If a
step fails, retain both source and destination and use that manifest to recover;
do not rerun migration blindly over a partially moved repository.

## Setup profile

`wt migrate` accepts `--profile caretomo` for the maintained profile. For another
repository it writes an empty setup profile that must be configured before use.

The JSON schema has `version: 1`, `source` (one checkout name), `remote`,
`env_files` (repository-relative ignored files), and `steps`. Each step has a
repository-relative `cwd`, `seed_dirs` relative to that cwd, and a nonempty
`command` argv array. Commands run directly without a shell, in listed order.
Use locked package-manager commands and project hook installers. Profiles are
trusted local executable configuration; keep credentials in ignored env files.

Seeding is only for regenerable dependency directories. It copies rather than
symlinks/hardlinks back to the source. On macOS, APFS cloning is required for
seeding; a clone failure stops setup instead of silently doing an expensive copy.
On Linux, GNU `cp --reflink=auto` uses reflinks where available. Relative links
inside a dependency tree are preserved. Package-manager install runs afterward
to reconcile dependencies and regenerate executable wrappers at their new path.
Build caches are not seeded. `.venv` seeding is rejected because its executables
contain absolute paths. uv recreates virtualenvs using its package cache.

Environment files are copied with mode 0600 only when absent. A tracked or
non-ignored destination is rejected before copying. `wt setup` never overwrites
an existing destination env file. An empty marker records successful setup;
`wt setup` always reruns reconciliation, including after switching branches.
