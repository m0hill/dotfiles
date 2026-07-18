#!/usr/bin/env python3
"""Create tasked Pi peer threads in Herdr panes and route messages between them."""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import TypeAlias, cast

JsonObject: TypeAlias = dict[str, object]

WORKSPACE_LABEL = "subagents"
PANE_ID_PATTERN = re.compile(r"^w[0-9A-Za-z]+:p[0-9A-Za-z]+$")
RESPONSE_PERFORMATIVES = frozenset(
    {"agree", "refuse", "inform", "failure", "not-understood"}
)
PERFORMATIVES = ["request", *sorted(RESPONSE_PERFORMATIVES), "cancel"]
AGENTS = ["pi", "claude"]
AGENT_MODELS = {
    "pi": ["sol", "luna", "terra"],
    "claude": ["fable", "opus", "sonnet"],
}
AGENT_THINKING = {
    "pi": ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
    "claude": ["low", "medium", "high", "xhigh", "max"],
}
SHELLS = {"zsh", "bash", "fish", "sh", "nu"}
SHELL_SETTLE_SECONDS = 10.0


class ThreadControlError(Exception):
    """An expected CLI failure with an actionable message."""


def herdr(*args: str) -> JsonObject:
    executable = os.environ.get("HERDR_BIN", "herdr")
    command = [executable, *args]
    try:
        completed = subprocess.run(command, capture_output=True, text=True, check=False)
    except OSError as exc:
        raise ThreadControlError(f"Could not run {executable}: {exc}") from exc
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise ThreadControlError(
            f"Herdr command failed ({completed.returncode}): {shlex.join(command)}: {detail}"
        )
    if not completed.stdout.strip():
        return {}
    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise ThreadControlError(
            f"Herdr returned invalid JSON for {shlex.join(command)}"
        ) from exc
    if isinstance(payload, dict):
        for envelope in ("result", "data"):
            if isinstance(payload.get(envelope), dict):
                return cast(JsonObject, payload[envelope])
    raise ThreadControlError("Herdr returned an unexpected response")


def object_field(value: JsonObject, field: str) -> JsonObject:
    result = value.get(field)
    if not isinstance(result, dict):
        raise ThreadControlError(f"Response is missing object field {field!r}")
    return result


def list_field(value: JsonObject, field: str) -> list[JsonObject]:
    result = value.get(field)
    if not isinstance(result, list) or not all(
        isinstance(item, dict) for item in result
    ):
        raise ThreadControlError(f"Response is missing list field {field!r}")
    return cast(list[JsonObject], result)


def string_field(value: JsonObject, field: str) -> str:
    result = value.get(field)
    if not isinstance(result, str) or not result:
        raise ThreadControlError(f"Response is missing string field {field!r}")
    return result


def require_environment() -> None:
    if os.environ.get("HERDR_ENV") != "1":
        raise ThreadControlError("This command must run inside a Herdr-managed pane")


def current_pane() -> JsonObject:
    return object_field(herdr("pane", "current", "--current"), "pane")


def all_panes() -> list[JsonObject]:
    return list_field(herdr("pane", "list"), "panes")


def valid_name(value: str) -> str:
    if not value or any(not (char.isalnum() or char in "-_") for char in value):
        raise ThreadControlError(
            "Names must contain only letters, numbers, hyphens, and underscores"
        )
    return value


def get_pane(pane_id: str) -> JsonObject:
    return object_field(herdr("pane", "get", pane_id), "pane")


def resolve_peer(reference: str) -> JsonObject:
    """Find a pane by pane ID or by unique pane label."""
    if PANE_ID_PATTERN.match(reference):
        return get_pane(reference)
    matches = [pane for pane in all_panes() if pane.get("label") == reference]
    if not matches:
        raise ThreadControlError(
            f"No pane is named {reference!r}; run `threadctl.py list` to see peers"
        )
    if len(matches) > 1:
        ids = ", ".join(string_field(pane, "pane_id") for pane in matches)
        raise ThreadControlError(
            f"Multiple panes are named {reference!r} ({ids}); use a pane ID instead"
        )
    return matches[0]


def sender_address(pane: JsonObject) -> str:
    label = pane.get("label")
    if isinstance(label, str) and label:
        return label
    return string_field(pane, "pane_id")


def peer_workspace_id() -> str | None:
    workspaces = list_field(herdr("workspace", "list"), "workspaces")
    matches = [
        workspace
        for workspace in workspaces
        if workspace.get("label") == WORKSPACE_LABEL
    ]
    if len(matches) > 1:
        raise ThreadControlError(
            f"Multiple workspaces are named {WORKSPACE_LABEL!r}; "
            "close or rename the extras"
        )
    return string_field(matches[0], "workspace_id") if matches else None


def create_peer_tab(name: str, cwd: Path) -> JsonObject:
    """Create the peer's tab (and the workspace if needed); return its root pane."""
    workspace_id = peer_workspace_id()
    if workspace_id is None:
        created = herdr(
            "workspace",
            "create",
            "--cwd",
            str(cwd),
            "--label",
            WORKSPACE_LABEL,
            "--no-focus",
        )
        herdr(
            "tab", "rename", string_field(object_field(created, "tab"), "tab_id"), name
        )
        return object_field(created, "root_pane")
    created = herdr(
        "tab",
        "create",
        "--workspace",
        workspace_id,
        "--cwd",
        str(cwd),
        "--label",
        name,
        "--no-focus",
    )
    return object_field(created, "root_pane")


def foreground_non_shell(pane_id: str) -> list[str]:
    process_info = object_field(
        herdr("pane", "process-info", "--pane", pane_id), "process_info"
    )
    processes = process_info.get("foreground_processes", [])
    if not isinstance(processes, list):
        raise ThreadControlError(f"Pane {pane_id} returned invalid process information")
    return [
        str(process.get("argv0") or process.get("name"))
        for process in processes
        if isinstance(process, dict)
        and str(process.get("argv0") or process.get("name")) not in SHELLS
    ]


def launch_command(agent: str, model: str | None, thinking: str | None) -> list[str]:
    if model and model not in AGENT_MODELS[agent]:
        raise ThreadControlError(
            f"{agent} models are {', '.join(AGENT_MODELS[agent])}; got {model!r}"
        )
    if thinking and thinking not in AGENT_THINKING[agent]:
        raise ThreadControlError(
            f"{agent} thinking levels are {', '.join(AGENT_THINKING[agent])}; "
            f"got {thinking!r}"
        )
    if agent == "pi":
        command = ["pi"]
        if model:
            command.extend(["--model", f"openai-codex/gpt-5.6-{model}"])
        if thinking:
            command.extend(["--thinking", thinking])
        return command
    # Peers run unattended; auto mode avoids permission prompts nobody can answer.
    command = ["claude", "--permission-mode", "auto"]
    if model:
        command.extend(["--model", model])
    if thinking:
        command.extend(["--effort", thinking])
    return command


def ensure_idle_agent(
    pane: JsonObject,
    agent_kind: str,
    model: str | None,
    thinking: str | None,
    cwd: Path,
) -> JsonObject:
    pane_id = string_field(pane, "pane_id")
    pane = get_pane(pane_id)
    agent = pane.get("agent")
    status = str(pane.get("agent_status", "unknown"))
    if agent == agent_kind:
        if status not in {"idle", "done"}:
            raise ThreadControlError(
                f"Peer {pane_id} is {status}; refusing to overwrite active work"
            )
        if model or thinking:
            raise ThreadControlError(
                "--model and --thinking apply only when launching a new peer; "
                f"pane {pane_id} already runs {agent_kind}"
            )
        return pane
    if agent is not None:
        raise ThreadControlError(
            f"Pane {pane_id} runs {agent}, not {agent_kind}; choose another name"
        )

    # Shell startup helpers (e.g. path_helper) briefly hold the foreground in a
    # freshly created pane, so give the shell time to settle before declaring busy.
    deadline = time.monotonic() + SHELL_SETTLE_SECONDS
    while True:
        busy = foreground_non_shell(pane_id)
        if not busy:
            break
        if time.monotonic() >= deadline:
            raise ThreadControlError(
                f"Pane {pane_id} is busy with {', '.join(busy)}; "
                "pick another name or wait for it to finish"
            )
        time.sleep(0.5)

    if Path(str(pane.get("foreground_cwd") or pane.get("cwd") or cwd)).resolve() != cwd:
        herdr("pane", "run", pane_id, f"cd {shlex.quote(str(cwd))}")
    command = launch_command(agent_kind, model, thinking)
    # Launch can fail transiently (e.g. the CLI self-updates and exits asking
    # for a restart), so verify the agent is actually alive and retry once.
    for _ in range(2):
        herdr("pane", "run", pane_id, shlex.join(command))
        try:
            herdr(
                "wait",
                "agent-status",
                pane_id,
                "--status",
                "idle",
                "--timeout",
                "30000",
            )
        except ThreadControlError:
            pass
        time.sleep(1.0)
        pane = get_pane(pane_id)
        if pane.get("agent") == agent_kind and foreground_non_shell(pane_id):
            return pane
    raise ThreadControlError(
        f"Launched {agent_kind} in pane {pane_id} but it did not stay running; "
        "read the pane to inspect its output"
    )


def read_text(args: argparse.Namespace, name: str) -> str:
    value = getattr(args, name, None)
    file_name = getattr(args, f"{name}_file", None)
    if value is not None:
        text = value
    elif file_name is not None:
        path = Path(file_name).expanduser()
        try:
            text = path.read_text(encoding="utf-8")
        except OSError as exc:
            raise ThreadControlError(f"Cannot read {path}: {exc}") from exc
    else:
        raise ThreadControlError(f"Provide --{name} or --{name}-file")
    if not text.strip():
        raise ThreadControlError(f"{name.title()} must not be empty")
    return text.strip()


def render_message(
    performative: str,
    *,
    sender: str,
    receiver: str,
    conversation: str,
    reply_to: str | None,
    content: str,
) -> str:
    fields = [
        performative,
        f"from:{sender}",
        f"to:{receiver}",
        f"conversation:{conversation}",
    ]
    if reply_to:
        fields.append(f"reply-to:{reply_to}")
    return f"[{' '.join(fields)}]\n{content}"


def deliver(pane_id: str, message: str, *, queue: bool) -> None:
    pane = get_pane(pane_id)
    status = str(pane.get("agent_status", "unknown"))
    if status in {"working", "blocked"} and not queue:
        raise ThreadControlError(
            f"Recipient is {status}; pass --queue to enqueue the message anyway"
        )
    if not pane.get("agent"):
        raise ThreadControlError(
            f"Recipient pane {pane_id} is not running an agent; it cannot receive messages"
        )
    # `pane run` is for shell commands; agents need typed text plus an explicit
    # Enter, otherwise the message can sit unsubmitted in the input editor.
    was_idle = status not in {"working", "blocked"}
    for attempt in range(2):
        herdr("pane", "send-text", pane_id, message)
        time.sleep(0.5)
        herdr("pane", "send-keys", pane_id, "enter")
        if not was_idle:
            return
        # A just-launched TUI can swallow the text or the Enter entirely (startup
        # screens, editor not attached yet). Verify the agent started working;
        # re-press Enter, then retry the whole send once before giving up.
        for _ in range(6):
            time.sleep(1.0)
            pane = get_pane(pane_id)
            if not pane.get("agent") or not foreground_non_shell(pane_id):
                raise ThreadControlError(
                    f"Recipient agent in pane {pane_id} exited during delivery; "
                    "the message was not received"
                )
            if str(pane.get("agent_status")) == "working":
                return
            herdr("pane", "send-keys", pane_id, "enter")
        if attempt == 0:
            time.sleep(2.0)
    raise ThreadControlError(
        f"Delivered text to pane {pane_id} but the agent never started processing; "
        "read the pane to inspect its state"
    )


def new_conversation() -> str:
    return f"c-{uuid.uuid4().hex[:12]}"


def start_preamble(peer: str, cwd: Path, sender: str, conversation: str) -> str:
    return "\n".join(
        [
            f"You are the Herdr peer thread {peer!r} working in {cwd}.",
            "Reply with the threadctl command, for example:",
            f"  threadctl message inform"
            f" --to {sender} --conversation {conversation} --content <result>",
            "Only a successful threadctl invocation communicates a reply.",
        ]
    )


def command_start(args: argparse.Namespace) -> JsonObject:
    name = valid_name(args.name)
    task = read_text(args, "task")
    cwd = Path(args.cwd).expanduser().resolve() if args.cwd else Path.cwd()
    if not cwd.is_dir():
        raise ThreadControlError(f"Working directory does not exist: {cwd}")
    sender = sender_address(current_pane())

    existing = [pane for pane in all_panes() if pane.get("label") == name]
    if len(existing) > 1:
        ids = ", ".join(string_field(pane, "pane_id") for pane in existing)
        raise ThreadControlError(
            f"Multiple panes are named {name!r} ({ids}); pick another name"
        )
    if existing and existing[0].get("workspace_id") != peer_workspace_id():
        raise ThreadControlError(
            f"A pane outside the {WORKSPACE_LABEL!r} workspace is already named "
            f"{name!r}; pick another name"
        )

    pane = existing[0] if existing else create_peer_tab(name, cwd)
    pane = ensure_idle_agent(pane, args.agent, args.model, args.thinking, cwd)
    pane_id = string_field(pane, "pane_id")
    herdr("pane", "rename", pane_id, name)

    conversation = new_conversation()
    message = render_message(
        "request",
        sender=sender,
        receiver=name,
        conversation=conversation,
        reply_to=None,
        content=task,
    )
    preamble = start_preamble(name, cwd, sender, conversation)
    deliver(pane_id, f"{preamble}\n\n{message}", queue=False)
    return {
        "action": "started",
        "name": name,
        "agent": args.agent,
        "pane_id": pane_id,
        "cwd": str(cwd),
        "sender": sender,
        "conversation_id": conversation,
        "reused": bool(existing),
    }


def command_message(args: argparse.Namespace) -> JsonObject:
    content = read_text(args, "content")
    sender = sender_address(current_pane())
    target = resolve_peer(args.to)
    target_pane = string_field(target, "pane_id")
    receiver = sender_address(target)

    response = args.performative in RESPONSE_PERFORMATIVES
    if (response or args.performative == "cancel") and not args.conversation:
        raise ThreadControlError(
            f"{args.performative} requires --conversation with the ID "
            "from the message being answered"
        )
    conversation = args.conversation or new_conversation()

    message = render_message(
        args.performative,
        sender=sender,
        receiver=receiver,
        conversation=conversation,
        reply_to=args.reply_to,
        content=content,
    )
    deliver(
        target_pane,
        message,
        queue=args.queue or response or args.performative == "cancel",
    )
    return {
        "action": "message-sent",
        "performative": args.performative,
        "sender": sender,
        "receiver": receiver,
        "receiver_pane_id": target_pane,
        "conversation_id": conversation,
    }


def command_list(args: argparse.Namespace) -> JsonObject:
    workspace_id = peer_workspace_id()
    peers = (
        [
            {
                "name": pane.get("label"),
                "pane_id": string_field(pane, "pane_id"),
                "cwd": pane.get("cwd"),
                "agent": pane.get("agent"),
                "status": pane.get("agent_status", "unknown"),
            }
            for pane in all_panes()
            if pane.get("workspace_id") == workspace_id
        ]
        if workspace_id
        else []
    )
    return {"action": "listed", "peers": peers}


def command_read(args: argparse.Namespace) -> JsonObject:
    pane_id = string_field(resolve_peer(args.peer), "pane_id")
    executable = os.environ.get("HERDR_BIN", "herdr")
    command = [
        executable,
        "pane",
        "read",
        pane_id,
        "--source",
        "recent-unwrapped",
        "--lines",
        str(args.lines),
        "--format",
        "text",
    ]
    try:
        completed = subprocess.run(command, capture_output=True, text=True, check=False)
    except OSError as exc:
        raise ThreadControlError(f"Could not run {executable}: {exc}") from exc
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise ThreadControlError(f"Could not read pane {pane_id}: {detail}")
    return {
        "action": "read",
        "peer": args.peer,
        "pane_id": pane_id,
        "transcript": completed.stdout,
    }


def command_wait(args: argparse.Namespace) -> JsonObject:
    pane_id = string_field(resolve_peer(args.peer), "pane_id")
    status = str(get_pane(pane_id).get("agent_status", "unknown"))
    if status != args.status:
        herdr(
            "wait",
            "agent-status",
            pane_id,
            "--status",
            args.status,
            "--timeout",
            str(args.timeout),
        )
        status = str(get_pane(pane_id).get("agent_status", "unknown"))
    return {
        "action": "wait-complete",
        "peer": args.peer,
        "pane_id": pane_id,
        "status": status,
    }


def command_focus(args: argparse.Namespace) -> JsonObject:
    pane_id = string_field(resolve_peer(args.peer), "pane_id")
    herdr("agent", "focus", pane_id)
    return {"action": "focused", "peer": args.peer, "pane_id": pane_id}


def text_options(parser: argparse.ArgumentParser, name: str) -> None:
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(f"--{name}")
    group.add_argument(f"--{name}-file")


def add_peer_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--peer", required=True, help="Peer name or pane ID")


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)

    start = commands.add_parser(
        "start", help="Start a named Pi peer and immediately task it"
    )
    start.add_argument("--name", required=True, help="Task-based peer name")
    text_options(start, "task")
    start.add_argument("--cwd", help="Peer working directory (default: current)")
    start.add_argument(
        "--agent",
        choices=AGENTS,
        default="pi",
        help="Agent CLI to run in the peer pane (default: pi)",
    )
    start.add_argument(
        "--model",
        help="Model (pi: sol|luna|terra; claude: fable|opus|sonnet; "
        "default: agent's default)",
    )
    start.add_argument(
        "--thinking",
        help="Thinking level (pi: off..max; claude: low..max; "
        "default: agent's default)",
    )
    start.set_defaults(handler=command_start)

    message = commands.add_parser("message", help="Format and route a peer message")
    message.add_argument("performative", choices=PERFORMATIVES)
    message.add_argument("--to", required=True, help="Peer name or pane ID")
    text_options(message, "content")
    message.add_argument("--conversation")
    message.add_argument("--reply-to")
    message.add_argument("--queue", action="store_true")
    message.set_defaults(handler=command_message)

    list_command = commands.add_parser("list", help="List peer threads")
    list_command.set_defaults(handler=command_list)

    read = commands.add_parser("read", help="Read a peer transcript")
    add_peer_argument(read)
    read.add_argument("--lines", type=int, default=120)
    read.set_defaults(handler=command_read)

    wait = commands.add_parser("wait", help="Wait until a peer has a runtime status")
    add_peer_argument(wait)
    wait.add_argument(
        "--status", choices=["idle", "working", "blocked", "done"], default="done"
    )
    wait.add_argument("--timeout", type=int, default=120_000)
    wait.set_defaults(handler=command_wait)

    focus = commands.add_parser("focus", help="Focus a peer pane for human takeover")
    add_peer_argument(focus)
    focus.set_defaults(handler=command_focus)
    return root


def validate_numbers(args: argparse.Namespace) -> None:
    for field in ("lines", "timeout"):
        value = getattr(args, field, None)
        if value is not None and value <= 0:
            raise ThreadControlError(f"--{field} must be positive")


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        require_environment()
        validate_numbers(args)
        result = args.handler(args)
    except ThreadControlError as exc:
        print(
            json.dumps({"ok": False, "error": str(exc)}, sort_keys=True),
            file=sys.stderr,
        )
        return 1
    print(json.dumps({"ok": True, **result}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
