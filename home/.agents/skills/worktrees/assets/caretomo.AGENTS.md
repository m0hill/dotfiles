# Local Caretomo workspaces

This directory is a local Git container. Application code lives in `main/` and
task checkouts, each containing the full Caretomo monorepo. Infrastructure is
managed separately.

Before creating or resuming a task checkout, read
`~/.agents/skills/worktrees/SKILL.md` and use `wt`. The helper owns local environment
copying, dependency setup, hook installation, and checkout registration. Use an
explicit base for stacked branches. A task is ready when `wt new` or `wt setup`
succeeds; repair failed setup with `wt setup <name>`.

Run Git and application commands in the selected checkout and read its AGENTS.md
and application guides. Keep `main` available as the setup source. The outer
`.worktrees.json` and `mise.toml` are personal configuration, outside tracked code.
For servers, background workers, PostgreSQL, Storybook, or Phoenix, read the
worktrees skill's `references/runtime.md` and use `dev`. It manages one active
checkout in explicit Herdr panes, including from GUI agents. Before using servers
for tests, reserve the stack with your stable chat/session ID and a readable task
name. Once reserved, select your checkout with `dev up` or `dev switch`. If busy,
request access and work independently or use a bounded wait; never interrupt
another agent's reservation. Release after testing, even when tests fail; release
leaves services running. Use force-release only on the user's explicit instruction.
`dev status` shows the owner and requests; `dev events` shows lifecycle history.
`wt` setup does not start services. Initialize a task database explicitly with
`dev db-init`; regular startup never seeds or resets data.

Before browser verification, read the runtime reference's **Browser verification**
section for local hospital URLs, role-specific seeded login IDs/password, session
switching, and missing-fixture handling. Use those local accounts directly;
reserve the stack and confirm the active checkout before testing.

Local AWS access uses `sind-dev`; read the runtime reference's **AWS access**
section for shared SSO login and GUI command setup. Run SDK commands with
`mise exec --` and AWS CLI commands with `--profile sind-dev`.
