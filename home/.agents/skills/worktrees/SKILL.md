---
name: worktrees
description: Create and bootstrap task worktrees, run Caretomo development services in Herdr, find local browser verification URLs and seeded logins, inspect checkout status, or migrate a local clone into a canonical .bare root.
---

# Task worktrees

Use `wt` for the local worktree lifecycle. Its implementation lives in
[`scripts/worktrees.py`](scripts/worktrees.py); `wt --help` describes the commands.
The root contains `.bare/`, a `.git` pointer, `main/`, and task directories.
Run application commands inside a checkout, never in the outer container.

## Create or resume a task

```bash
wt -r ~/work/sind/caretomo new 500 mohil/500
# A stacked task must name its actual parent:
wt -r ~/work/sind/caretomo new 501 mohil/501 --base mohil/500
```

Creation fetches the remote, reuses a matching local or remote branch, or creates
one from the specified base (otherwise the remote default). Existing matching
checkouts resume setup. A branch already checked out elsewhere is an error.
`--offline` skips fetching; it does not change dependency installation behavior.

The root-local `.worktrees.json` owns setup. The Caretomo profile is maintained in
[`assets/caretomo.json`](assets/caretomo.json). Setup copies missing ignored env
files from `main`, seeds configured dependency directories with independent
copy-on-write copies on macOS, then runs locked installs and the hook installer.
It preserves existing env files and reports missing source configuration as an
error only when copying a missing file. Python environments are recreated through
uv, not copied with stale paths.
Installs follow the selected branch's lockfiles; they do not upgrade dependencies.
The root's local `mise.toml` pins Node and Python for every checkout beneath it.

The first argument is a directory name; the second is any valid Git branch name.

`wt setup 500` retries failed setup. A failure retains the checkout and exits
nonzero; consider it ready only after setup succeeds. `wt path 500` prints the
path for `cd "$(wt path 500)"`. A shell command cannot change its parent shell.

## Inspect and finish

`wt list` reports each checkout's branch, changes, upstream divergence, and setup
state. `wt doctor` checks Git registrations, root configuration, and source files.

Use standard Git commands for cleanup. Before `git worktree remove <path>`,
account for local changes, unpushed commits, and ignored files such as `.env`;
preserve anything needed. Delete a branch only after its commits are integrated
or explicitly discarded. Keep `main` as the setup source.

## Development services

For Caretomo servers, workers, PostgreSQL, Storybook, or Phoenix, read
[`references/runtime.md`](references/runtime.md) and use `dev`. GUI and terminal
agents use the same launcher. `wt` prepares files; `dev` manages one active
worktree's services in owned Herdr panes and assigns task databases explicitly.
Reserve the stack with your stable chat/session ID and a readable task name before
using servers for testing. Another agent's reservation blocks changes; request
access and continue independent work or use a bounded wait. Release after testing,
including failure, so the next agent can use it. See the runtime reference for
commands and recovery. Read the selected checkout's AGENTS.md.

For manual browser checks, read the runtime reference's **Browser verification**
section for hospital URLs, seeded role-specific display IDs/password, and session
switching. Use the documented local fixtures directly rather than asking the user
for credentials. Reserve before browser/API testing and verify the active checkout;
an empty migrated database still needs fixtures.

For AWS-dependent local work, use `sind-dev` and read the runtime reference's
**AWS access** section. SDK commands use `mise exec --`; AWS CLI commands name
`--profile sind-dev`. Reuse the shared SSO login instead of copying temporary keys.

## Migrate or configure another repository

Read [`references/layout.md`](references/layout.md) before migrating a clone or
adding a root-local setup profile. Migrations and remote pushes require the user's
authorization; ordinary task creation does not authorize either.

Workflow inspired by [dmmulroy's worktrees skill](https://github.com/dmmulroy/.dotfiles/tree/main/home/.agents/skills/worktrees).
