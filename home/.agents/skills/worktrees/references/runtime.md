# Caretomo runtime

Run `dev` from the root or any checkout, or select the root with `dev -r <root>`.
The executable is in dotfiles and works from GUI agents as well as terminals.

```bash
wt new 500 mohil/500
dev db-init 500                 # Create its database and apply migrations
dev --agent-name "Recording fix" reserve 500 --reason "Browser recording tests"
dev status                     # JSON: active checkout, owner, waiting agents, ports
# After reserving: use up if stopped/already on 500; switch if another checkout runs.
dev switch 500                 # Stop old stack, then start ALL services for 500
dev logs worker                # Django + worker share one Honcho pane
dev release --result "Recording tests passed"  # Leave services running

dev events --lines 30           # Recent lifecycle events with agent identities
dev down                       # Stop applications/tools; leave Postgres visible
dev down --all                 # Also stop Postgres; preserve its volume
```

## Agent coordination

Running services and reservations are separate. Reserve for the short period
when your tests need the stack; release when finished, even on failure. Release
leaves the services available to you and the next agent. While reserved, another
agent cannot start, stop, switch, initialize databases, or release the stack.
The owner can use `up` or `switch` for its reserved checkout. Commands in a manual
terminal work without a reservation when nobody holds one.

Codex uses `CODEX_THREAD_ID` automatically. Other agents pass
`--agent-id <stable-chat-or-session-id>` before the command. Give the reservation a
readable name with `--agent-name "Recording fix"`; the ID distinguishes agents
with similar names. Keep the same ID across commands; never reuse another chat's ID.
The reservation's name is reused for its owner's runtime events. `wt` also accepts
these flags for checkout/setup events. Without a supplied name, logs show a short
Codex ID or a manual terminal identity. IDs represent local coordination, not an
authentication boundary.

If busy, `reserve` reports the owner's name, full ID, branch, reason, and start
time, records one request per agent, and exits **2**. It never changes services.
Continue work that does not need servers, or retry with a bounded wait:

```bash
dev --agent-name "Login fix" reserve 501 --reason "Login browser tests" --wait 60
dev cancel                     # Remove your waiting request if no longer needed
```

A successful wait atomically acquires the reservation; it does not switch services.
A timeout leaves the request visible for the owner. Requests are a visible waiting
list, not a scheduler: there is no automatic notification, FIFO guarantee, or
wake-up of an idle GUI chat. Agents inspect `status`/`events` when they next work.
Reservations do not expire. If an agent disappears, confirm it is no longer using
the stack, then use `dev release --force --result "<reason>"` only when the user
explicitly requests recovery. Force-release is logged and leaves services running.

`up` refuses a different active checkout and unexpected occupied ports. A switch
stops the previous stack, including workers and reloaders, before launching the
next. It does not run `git switch` in a checkout. Keep each worktree on its task
branch while its stack runs. A root operation already in progress reports a
`wt/dev` lock conflict; retry after it finishes.

Startup failures retain ownership and successful processes for inspection. Use
`dev logs <service>` and `dev status`, then retry `up` for the same checkout or use
`down`. Readiness checks verify open service ports; an open port alone does not
prove a complete application workflow works. Manage services through this launcher
instead of starting additional unmanaged servers or workers.

## AWS access

Local Caretomo commands and services use **`sind-dev`** in `ap-northeast-1`.
The outer `mise.toml` sets the profile/region and clears exported temporary keys;
`dev` also sets the profile for its application processes, including GUI launches.
Credentials stay in the user's shared AWS SSO cache, outside checkouts.

For agent commands, use `aws --profile sind-dev <service> ...`. For SDK-based
commands from a GUI or noninteractive shell, run `mise exec -- <command>` from the
selected checkout; merely changing directory does not configure an existing GUI
process. Activated terminal shells pick up mise's directory environment.

Before AWS-dependent testing, verify the login with:

```bash
mise exec -- aws --profile sind-dev sts get-caller-identity
```

If authentication has expired, ask the user to run this from any terminal:

```bash
aws sso login --profile sind-dev
```

Then retry with `sind-dev`. Supported SDK providers refresh temporary credentials
while the SSO session remains valid; the user must log in again when that session
expires. Keep `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN`
out of application env files. Honcho reloads `.env`, so the launcher reports
nonempty static keys or a conflicting/empty `AWS_PROFILE` there rather than letting
them override SSO. Other AWS profiles remain available for separately authorized
work; local Caretomo testing uses only `sind-dev`. Authentication does not grant
permissions or enable a provider that the application disables in development.

## Browser verification: URLs and seeded accounts

Before opening the app or making test requests, successfully reserve the stack,
select your checkout, and confirm `dev status` shows that checkout and branch.
Every worktree uses the same URLs; the running stack determines which code and
database you test. A busy reservation means wait or continue offline work.

For a database populated by `apps/backend/scripts/seed_db.py`, start with
`http://clinic1.localhost:3000/login?patientID=patient00001&prefilledUserID=prac0001`.
The password for all accounts below is **`kirokun@123`**, a development fixture
constant in that script. Use these values directly for local verification;
the user does not need to provide a URL or credentials.

| Test role | Hospital subdomain | Login user ID |
| --- | --- | --- |
| Doctor | `clinic1` or `clinic2` | `prac0001` or `prac0005` |
| Nurse administrator | `clinic1` or `clinic2` | `prac0002` or `prac0006` |
| Nurse | `clinic1` or `clinic2` | `prac0003` or `prac0007` |
| Caretaker | `clinic1` or `clinic2` | `prac0004` or `prac0008` |
| Hospital administrator | `clinic1` | `admin001` |
| Hospital administrator | `clinic2` | `admin002` |
| Trial hospital administrator | `trial1` | `admin001` |
| Trial practitioners | `trial1` | Same `prac0001`–`prac0008` role order above |
| Visiting nurse | `visitnr1` | `nurse0001`, `nurse0002`, or `nurse0003` |

Build another login URL with the chosen hospital and display ID:
`http://<hospital>.localhost:3000/login?patientID=patient00001&prefilledUserID=<id>`.
The browser's user field takes the **display ID**, not the internal Django
username (such as `pracclinic10`). All seeded hospitals have `patient00001`;
normal/trial hospitals have 15 patients each, and the visiting hospital has one.
The seed creates sample encounters, problems, wards, and quotas; normal hospitals
enable doctor posting. Feature-specific fixtures or flags may still need setup.

When changing roles or testing after a worktree/database switch, use a fresh
browser session or append `&forceLogout=true` to the login URL in your test
session. An existing login token can otherwise retain the previous role/database
identity. Use the available browser tool to log in and exercise the actual flow;
record the checkout, role, URL, and observed result, without tokens or passwords
in screenshots or shared PR evidence.

Other local entry points: Storybook `http://localhost:6006`, Phoenix
`http://localhost:6007`, and Django admin `http://localhost:8000/admin/`.
Django admin uses username `admin` and the same seeded password; this superuser
and `service_account` are separate from hospital browser users.

These accounts exist **after seeding**, not after migrations alone. `dev db-init`
creates an empty migrated database. If login fails, inspect the selected checkout's
seed script, README, and local account/fixture presence before retrying; repeated
password guesses can trigger login cooldown. Prepare missing fixtures in the
task's disposable database. `just seed` drops that database and deletes that
checkout's backend media, so run it only for an authorized disposable reset with
services stopped, preserving any data needed. Follow the checkout README to update
the generated FastAPI `KIROKUN_DB_API_KEY` in its ignored env file. Keep existing
populated databases intact when only browser access is missing.

## Herdr layout

```text
Caretomo · <branch>
  App         [ just dev-all: Django + worker | pnpm dev: Next.js ]
  Database    PostgreSQL container logs, host port, and database name
  FastAPI     make dev
  Storybook   pnpm storybook (port 6006)
  Phoenix     just phoenix   (port 6007)
```

All services start on every `up`/`switch`; tabs and panes are reused on switching.
The stopped workspace is named `Caretomo`. Its sidebar position is user-managed.
Every command targets the configured Herdr session and saved
resource IDs; it does not use focus or sidebar order. The launcher creates no
agent panes and leaves existing user workspaces alone. Its panes remain inspectable
after commands exit. The database tab follows Docker logs; closing that pane does
not stop the container. `status` reports container state separately from its log
process. Use `down --all` for a complete shutdown.

## Databases and configuration

The root-local `.dev.json` names the Herdr session, existing PostgreSQL container,
host port, database user, and main database. Caretomo currently reuses the seeded
container rather than creating a second one. Consult this file for the actual
port; it need not be 5432. Credentials remain in ignored application env files.

`main` retains its existing database. Other worktrees get a stable generated name
based on their directory, independently of branch-name syntax. `db-init` creates
the database if absent, sets that checkout's ignored Django `.env` to the assigned
database/host/port, then runs `just migrate` and the separate Procrastinate-alias
migrations required by Django's database router. Honcho reloads `.env`, so storing the
assignment there keeps both Django and the worker on the same database.
Initialization applies migrations but never runs the destructive seed command or
copies another branch's job queue. Populate development fixtures separately when
needed. Database volumes and task databases survive `down` and worktree removal.

Root-local `.local/runtime.json` records the owned workspace, panes, and active
checkout. `.local/services/` records live launcher processes with process start
times. These are local runtime state, not project files. Do not edit or delete
ownership records while the stack is running. Stop services before removing a
worktree. No application or origin changes are required.

`.local/coordination.json` holds the reservation and waiting requests;
`.local/events.jsonl` records checkout setup, database initialization, runtime
operations, reservations, requests, and releases with UTC times and agent names/IDs.
Failed operations get a failure event without capturing env files or command output.
These records are written by the helpers under the root lock; use commands rather
than editing them by hand. All state stays outside application Git history.
