---
name: herdr-agent-threads
description: Coordinate independent Pi peer threads in Herdr. Use when creating, tasking, messaging, monitoring, or taking over peer agent threads, or when receiving a bracketed peer message such as [request from:X to:Y conversation:C]. Requires HERDR_ENV=1.
---

# Herdr agent threads

Each peer is an ordinary, independent interactive agent session (Pi or Claude Code). All peers live in one dedicated `subagents` workspace, one tab per peer, managed entirely by the CLI — never choose or ask about panes, tabs, or workspaces. Any thread may start peers and message any peer, whatever agent either end runs; there is no hierarchy and no restrictions.

Everything runs through the `threadctl` command. This file is its complete interface — never read its implementation or raw Herdr state. Every command prints JSON: `ok: true` with the fields shown, or `ok: false` with an `error` that says exactly what to fix.

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

`PEER` is a peer name or a pane ID (like `w9:p1`). Names must be unique, task-based (e.g. `auth-review`, `db-migration`), and use only letters, numbers, hyphens, underscores.

## Start a tasked peer

`start` always requires a task and delivers it immediately; a peer is never created idle. A peer has no previous conversation context and does not inherit skills you loaded or instructions you read. Put everything it needs in the task: relevant context, constraints, expected output, and the names or paths of any skills or supporting files it must read. Never assume the peer knows what happened earlier in your session.

Before starting a peer, confirm `--agent`, `--model`, and `--thinking` with the user through your question tool (offer the choices from the table below, recommending one). Skip the question only when the user already specified them or asked you to proceed without asking.

Independent `start` commands may run concurrently. `threadctl` atomically creates the shared `subagents` workspace when the first peers race to start, so do not serialize starts or create the workspace separately with raw `herdr` commands.

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

Messages are a one-line bracketed header plus free-text content. The script builds the header; never hand-write it or send messages via raw Herdr.

```text
[request from:w9:p1 to:auth-review conversation:c-1a2b3c4d5e6f]
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
threadctl message inform --to w9:p1 --conversation c-1a2b3c4d5e6f --content-file /tmp/result.md
threadctl message failure --to w9:p1 --conversation c-1a2b3c4d5e6f --content "Repo unavailable."
```

Responses and cancels queue automatically if the recipient is busy; pass `--queue` only to intentionally deliver a new request to a busy peer. A reply exists only after a successful `message` invocation — printing it locally communicates nothing.

**Fire and forget.** Replies are push-delivered: the peer's message lands in your session and wakes you. After sending a request, end your turn — never sleep or poll. Use `wait` only when the current turn cannot proceed without the result.

## Inspect and take over

```bash
threadctl list                                   # all peer threads and their status
threadctl read --peer auth-review --lines 120    # transcript, without focusing
threadctl wait --peer auth-review --status done --timeout 120000
threadctl focus --peer auth-review               # human takeover of the live session
threadctl close --peer auth-review               # manually close its tab when idle/done
```

`close` is always manual. It closes the peer's entire tab only when its current agent status is `idle` or `done`; it refuses `working`, `blocked`, `unknown`, and non-peer panes. Never close a peer merely because it sent a response—wait for the user or controlling agent to explicitly request closure.

Herdr status is operational evidence; the peer's message is the communication outcome. If a peer disappears or `wait` times out, report it as unreachable rather than fabricating a response.

## Rules

- Name peers after their task, and never create one without a task.
- Peers are independent; roles exist per request only.
- Assign concurrent writers non-overlapping files or responsibilities.
- Never open the same Pi session in a second process; `focus` the existing pane instead.
