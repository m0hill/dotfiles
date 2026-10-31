---
name: rex-agent-threads
description: Coordinate independent Pi peer threads in Rex. Use when creating, tasking, messaging, monitoring, or taking over peer agent threads, or when receiving a bracketed peer message such as [request from:X to:Y conversation:C]. Requires REX_SESSION and REX_BLOCK.
---

# Rex agent threads

Each peer is an ordinary, independent interactive agent session (Pi or Claude Code). All peers live in one dedicated `subagents` workspace, one tab per peer, managed entirely by the CLI — never choose or ask about panes, tabs, or workspaces. Any thread may start peers and message any peer, whatever supported agent either end runs. Follow the host's authorization rules for delegating and sending messages.

Everything runs through the `threadctl` command. This file is its complete interface — use the official `rex` skill to inspect Rex when troubleshooting. Every command prints JSON: `ok: true` with the fields shown, or `ok: false` with an `error` that says exactly what to fix.

## Command reference

```text
start   --name NAME (--task TEXT | --task-file PATH) [--cwd DIR]
        [--agent pi|claude] [--model MODEL] [--thinking LEVEL]
message (request|agree|refuse|inform|failure|not-understood|cancel)
        --to PEER (--content TEXT | --content-file PATH)
        [--conversation ID] [--reply-to ID] [--queue]
list
read    --peer PEER [--lines N]
wait    --peer PEER [--status idle|working|blocked|done] [--timeout MS]
focus   --peer PEER
close   --peer PEER
```

`PEER` is a peer name or a pane ID (like `block:01a190e6-0594-7d75-a3a0-22a20edb35ff`). Names must be unique, task-based (e.g. `auth-review`, `db-migration`), and use only letters, numbers, hyphens, underscores.

## Start a tasked peer

`start` always requires a task and delivers it immediately; an idle agent is launched and its task is submitted before success is reported. Unknown status or startup failures leave the pane available for inspection. A peer has no previous conversation context and does not inherit skills you loaded or instructions you read. Put everything it needs in the task: relevant context, constraints, expected output, and the names or paths of any skills or supporting files it must read. Never assume the peer knows what happened earlier in your session.

Before starting a peer, confirm `--agent`, `--model`, and `--thinking` with the user through your question tool (offer the choices from the table below, recommending one). Skip the question only when the user already specified them or asked you to proceed without asking.

Independent `start` commands may run concurrently. `threadctl` atomically creates the shared `subagents` workspace when the first peers race to start, so do not serialize starts or create the workspace separately with raw `rex` commands.

```bash
threadctl start --name auth-review --task-file /tmp/task.md --cwd ~/projects/myapp
```

`--cwd` sets the peer's working directory (default: yours). `--agent` picks which CLI the peer runs (default: `pi`). `--model` and `--thinking` set the model and thinking/effort level, per agent:

| agent | `--model` | `--thinking` |
|---|---|---|
| pi | `sol` `luna` `terra` | `off` `minimal` `low` `medium` `high` `xhigh` `max` |
| claude | `fable` `opus` `sonnet` | `low` `medium` `high` `xhigh` `max` |

Omit either for the agent's defaults; both apply only when a new agent is launched. Starting with the name of an existing *idle* peer reuses it (`"reused": true`); `start` refuses to interrupt a busy peer.

Success returns the pane ID and a `conversation_id` — quote that ID when discussing the exchange.

## Message format

Messages are a one-line bracketed header plus free-text content. The script builds the header; never hand-write it or send messages via raw Rex.

```text
[request from:block:01a190e6-0594-7d75-a3a0-22a20edb35ff to:auth-review conversation:c-1a2b3c4d5e6f]
Review src/auth for authorization bypasses. Return findings with file and line references. Do not edit files.
```

Performatives:

- `request` — ask a peer to do something; mints a new conversation ID unless one is given.
- `agree` — optional early "accepted, working on it" signal.
- `refuse` — understood but not accepted; give a constructive reason.
- `inform` — successful completion; put the actual result in the content, not merely "done".
- `failure` — attempted but did not complete; include the reason.
- `not-understood` — the message cannot be interpreted.
- `cancel` — the result of an earlier request is no longer needed (does not kill the peer's terminal).

Every performative except `request` requires `--conversation` with the ID from the message being answered. One `request` ends in exactly one of `inform`, `failure`, or `refuse`; never respond twice, and never change the conversation ID mid-interaction.

## Send and respond

```bash
# New request to a peer
threadctl message request --to auth-review --content-file /tmp/follow-up.md

# Reply to a received request (use the from: and conversation: values of its header)
threadctl message inform --to block:01a190e6-0594-7d75-a3a0-22a20edb35ff --conversation c-1a2b3c4d5e6f --content-file /tmp/result.md
threadctl message failure --to block:01a190e6-0594-7d75-a3a0-22a20edb35ff --conversation c-1a2b3c4d5e6f --content "Repo unavailable."
```

Responses and cancels may be submitted while the recipient is busy; pass `--queue` to allow a new request while busy. Submission uses the agent's terminal input; the agent CLI decides how to handle input during work. A reply exists only after a successful `message` invocation — printing it locally communicates nothing.

Replies are typed into the recipient's running terminal agent. They do not wake a separate Codex desktop chat. Use `wait` when the current turn needs a result, and `read` to inspect output. A successful send verifies a Rex status transition, not that the requested work succeeded.

## Inspect and take over

```bash
threadctl list                                   # all peer threads and their status
threadctl read --peer auth-review --lines 120    # transcript, without focusing
threadctl wait --peer auth-review --status done --timeout 120000
threadctl focus --peer auth-review               # human takeover of the live session
threadctl close --peer auth-review               # manually close its tab when idle/done
```

`close` is always manual. It closes the peer's pane only when its current agent status is `idle` or `done`; it refuses `working`, `blocked`, `error`, `unknown`, and non-peer panes. Never close a peer merely because it sent a response—wait for the user or controlling agent to explicitly request closure.

`wait --status done` accepts `done` or `idle`, since viewing a completed result can clear its attention state. `focus` also switches the app and requires Rex Remote Control to be enabled; otherwise select the `subagents` session in the sidebar.

Rex status is operational evidence; the peer's message is the communication outcome. If a peer disappears or `wait` times out, report it as unreachable rather than fabricating a response.

## Rules

- Name peers after their task, and never create one without a task.
- Peers are independent; roles exist per request only.
- Assign concurrent writers non-overlapping files or responsibilities.
- Never open the same Pi session in a second process; `focus` the existing pane instead.
