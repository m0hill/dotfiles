#!/usr/bin/env python3
"""Create tasked Pi peer threads in Rex panes and route messages between them."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import TypeAlias, cast

JsonObject: TypeAlias = dict[str, object]

WORKSPACE_LABEL = "subagents"
PANE_ID_PATTERN = re.compile(r"^block:[0-9a-f-]+$")
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


class RexResourceNotFoundError(ThreadControlError):
    pass


def rex_output(*args: str) -> str:
    executable = os.environ.get("REX_BIN", "rex")
    command = [executable, "--autostart=false", *args]
    try:
        completed = subprocess.run(command, capture_output=True, text=True, check=False)
    except OSError as exc:
        raise ThreadControlError(f"Could not run {executable}: {exc}") from exc
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        error_type = (
            RexResourceNotFoundError
            if completed.returncode == 3
            else ThreadControlError
        )
        raise error_type(f"Rex command failed: {shlex.join(command)}: {detail}")
    return completed.stdout


def rex(*args: str) -> JsonObject:
    output = rex_output(*args)
    if not output.strip():
        return {}
    try:
        payload = json.loads(output)
    except json.JSONDecodeError as exc:
        raise ThreadControlError("Rex returned invalid JSON") from exc
    if not isinstance(payload, dict):
        raise ThreadControlError("Rex returned an unexpected response")
    return payload


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
    if not os.environ.get("REX_BLOCK") or not os.environ.get("REX_SESSION"):
        raise ThreadControlError("This command must run inside a Rex terminal")


def current_pane() -> JsonObject:
    return get_pane(os.environ["REX_BLOCK"])


def all_panes() -> list[JsonObject]:
    panes = []
    for session in list_field(rex("ls", "--json"), "sessions"):
        session_id = string_field(session, "session_id")
        try:
            view = rex("session", "inspect", session_id, "--json")
        except RexResourceNotFoundError:
            # Sessions can close between listing them and reading their layout.
            continue
        windows = list_field(view, "windows") if view.get("windows") is not None else []
        for window in windows:
            for layer in list_field(window, "layers"):
                for block in list_field(layer, "blocks"):
                    panes.append(
                        {
                            **block,
                            "pane_id": string_field(block, "block_id"),
                            "workspace_id": session_id,
                            "tab_id": string_field(window, "window_id"),
                        }
                    )
    return panes


def valid_name(value: str) -> str:
    if not value or any(not (char.isalnum() or char in "-_") for char in value):
        raise ThreadControlError(
            "Names must contain only letters, numbers, hyphens, and underscores"
        )
    return value


def pane_location(pane_id: str) -> JsonObject:
    matches = [pane for pane in all_panes() if pane.get("pane_id") == pane_id]
    if not matches:
        raise ThreadControlError(f"Rex pane {pane_id} no longer exists")
    return matches[0]


def get_pane(pane_id: str) -> JsonObject:
    block = pane_location(pane_id)
    session_id = string_field(block, "workspace_id")
    process = rex("block", "call", "-s", session_id, "-b", pane_id, "process")
    records = list_field(
        rex("block", "call", "-s", session_id, "-b", pane_id, "program_status"),
        "records",
    )
    root = next((record for record in records if not record.get("id")), {})
    foreground = process.get("foreground") or {}
    if not isinstance(foreground, dict):
        raise ThreadControlError("Rex returned invalid foreground process information")
    identity = " ".join(
        str(foreground.get(key, "")) for key in ("name", "script", "argv0")
    )
    identity += " " + str(root.get("app", ""))
    agent = next(
        (
            kind
            for kind in [*AGENTS, "codex"]
            if re.search(rf"(?:^|[/ ._-]){kind}(?:$|[/ ._-])", identity)
        ),
        None,
    )
    if foreground.get("name") in SHELLS:
        agent = None
    return {
        **block,
        "pane_id": pane_id,
        "workspace_id": session_id,
        "tab_id": string_field(block, "tab_id"),
        "cwd": foreground.get("cwd"),
        "agent": agent,
        "agent_status": root.get("state", "unknown") if agent else "unknown",
        "status_updated_at": root.get("updated_at"),
    }


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
    return get_pane(string_field(matches[0], "pane_id"))


def sender_address(pane: JsonObject) -> str:
    return string_field(pane, "pane_id")


def peer_workspace_id() -> str | None:
    sessions = list_field(rex("ls", "--json"), "sessions")
    matches = [
        session for session in sessions if session.get("label") == WORKSPACE_LABEL
    ]
    if len(matches) > 1:
        raise ThreadControlError(f"Multiple Rex sessions are named {WORKSPACE_LABEL!r}")
    return string_field(matches[0], "session_id") if matches else None


@contextmanager
def workspace_creation_lock() -> Iterator[None]:
    """Serialize creation of the shared workspace across threadctl processes."""
    lock_path = Path(tempfile.gettempdir()) / f"threadctl-{os.getuid()}-workspace.lock"
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
    with os.fdopen(descriptor, "r+") as lock_file:
        fcntl.flock(lock_file, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock_file, fcntl.LOCK_UN)


def created_pane(result: JsonObject, session_id: str) -> JsonObject:
    blocks = result.get("block_ids")
    if not isinstance(blocks, list) or not blocks or not isinstance(blocks[0], str):
        raise ThreadControlError("Rex did not return a new block ID")
    return {
        "pane_id": blocks[0],
        "workspace_id": session_id,
        "tab_id": string_field(result, "window_id"),
    }


def create_peer_tab(name: str, cwd: Path) -> JsonObject:
    with workspace_creation_lock():
        session_id = peer_workspace_id()
        if session_id is None:
            created = rex(
                "new", WORKSPACE_LABEL, "--cwd", str(cwd), "--window", name, "--json"
            )
            windows = list_field(created, "initial_windows")
            if not windows:
                raise ThreadControlError("Rex did not return an initial window")
            return created_pane(windows[0], string_field(created, "session_id"))
        created = rex(
            "window",
            "new",
            "-s",
            session_id,
            name,
            "--cwd",
            str(cwd),
            "--focus=false",
            "--json",
        )
        return created_pane(created, session_id)


def foreground_non_shell(pane_id: str) -> list[str]:
    session_id = string_field(pane_location(pane_id), "workspace_id")
    info = rex("block", "call", "-s", session_id, "-b", pane_id, "process")
    foreground = info.get("foreground")
    if not isinstance(foreground, dict):
        return ["unknown process"]
    name = str(foreground.get("name", ""))
    return [] if name in SHELLS else [name]


def send_input(pane_id: str, text: str) -> None:
    session_id = string_field(pane_location(pane_id), "workspace_id")
    rex("send", "-s", session_id, "-b", pane_id, text)
    rex("send-key", "-s", session_id, "-b", pane_id, "enter")


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

    if Path(str(pane.get("cwd") or cwd)).resolve() != cwd:
        send_input(pane_id, f"cd {shlex.quote(str(cwd))}")
    send_input(pane_id, shlex.join(launch_command(agent_kind, model, thinking)))
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        pane = get_pane(pane_id)
        if pane.get("agent") == agent_kind and pane.get("agent_status") in {
            "idle",
            "done",
        }:
            return pane
        time.sleep(0.5)
    raise ThreadControlError(
        f"Agent in {pane_id} did not report idle to Rex; inspect the pane. "
        "Working/idle status reporting is required; no task was sent."
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
    if status not in {"idle", "done", "working", "blocked"}:
        raise ThreadControlError(
            f"Recipient status is {status}; inspect it before sending"
        )
    previous_update = pane.get("status_updated_at")
    send_input(pane_id, message)
    if status in {"working", "blocked"}:
        return
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        pane = get_pane(pane_id)
        if pane.get("status_updated_at") != previous_update and pane.get(
            "agent_status"
        ) in {"working", "blocked", "done"}:
            return
        if not pane.get("agent"):
            raise ThreadControlError("Recipient agent exited during delivery")
        time.sleep(0.25)
    raise ThreadControlError(
        "Text was submitted, but Rex did not report processing. "
        "Inspect the transcript before retrying; delivery is uncertain."
    )


def new_conversation() -> str:
    return f"c-{uuid.uuid4().hex[:12]}"


def start_preamble(peer: str, cwd: Path, sender: str, conversation: str) -> str:
    return "\n".join(
        [
            f"You are the Rex peer thread {peer!r} working in {cwd}.",
            "Reply with the threadctl command, for example:",
            (
                f"  threadctl message inform"
                f" --to {sender} --conversation {conversation} --content <result>"
            ),
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
    rex("block", "rename", "-s", string_field(pane, "workspace_id"), pane_id, name)

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
                "status": get_pane(string_field(pane, "pane_id")).get(
                    "agent_status", "unknown"
                ),
            }
            for pane in (
                get_pane(string_field(item, "pane_id"))
                for item in all_panes()
                if item.get("workspace_id") == workspace_id
            )
        ]
        if workspace_id
        else []
    )
    return {"action": "listed", "peers": peers}


def command_read(args: argparse.Namespace) -> JsonObject:
    pane_id = string_field(resolve_peer(args.peer), "pane_id")
    session_id = string_field(pane_location(pane_id), "workspace_id")
    output = rex_output(
        "capture", "-s", session_id, "-b", pane_id, "--trim", "--unwrap"
    )
    return {
        "action": "read",
        "peer": args.peer,
        "pane_id": pane_id,
        "transcript": "\n".join(output.splitlines()[-args.lines :]),
    }


def command_wait(args: argparse.Namespace) -> JsonObject:
    pane_id = string_field(resolve_peer(args.peer), "pane_id")
    status = str(get_pane(pane_id).get("agent_status", "unknown"))
    deadline = time.monotonic() + args.timeout / 1000
    accepted = {"idle", "done"} if args.status == "done" else {args.status}
    while status not in accepted:
        if time.monotonic() >= deadline:
            raise ThreadControlError(
                f"Timed out waiting for {args.peer}: current status {status}"
            )
        time.sleep(0.5)
        status = str(get_pane(pane_id).get("agent_status", "unknown"))
    return {
        "action": "wait-complete",
        "peer": args.peer,
        "pane_id": pane_id,
        "status": status,
    }


def command_focus(args: argparse.Namespace) -> JsonObject:
    pane_id = string_field(resolve_peer(args.peer), "pane_id")
    pane = get_pane(pane_id)
    rex("focus", "-s", string_field(pane, "workspace_id"), pane_id)
    rex(
        "do",
        "session.select",
        "session_id=" + string_field(pane, "workspace_id"),
        "window_id=" + string_field(pane, "tab_id"),
    )
    return {"action": "focused", "peer": args.peer, "pane_id": pane_id}


def command_close(args: argparse.Namespace) -> JsonObject:
    pane = resolve_peer(args.peer)
    pane_id = string_field(pane, "pane_id")
    workspace_id = peer_workspace_id()
    if workspace_id is None or pane.get("workspace_id") != workspace_id:
        raise ThreadControlError(
            f"Pane {pane_id} is not a peer in the {WORKSPACE_LABEL!r} workspace"
        )

    pane = get_pane(pane_id)
    status = str(pane.get("agent_status", "unknown"))
    if status not in {"idle", "done"}:
        raise ThreadControlError(
            f"Peer {pane_id} is {status}; only idle or done peers can be closed"
        )

    tab_id = string_field(pane, "tab_id")
    rex("block", "close", "-s", workspace_id, pane_id)
    return {
        "action": "closed",
        "peer": args.peer,
        "pane_id": pane_id,
        "tab_id": tab_id,
        "status": status,
    }


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

    close = commands.add_parser("close", help="Close an idle or done peer's tab")
    add_peer_argument(close)
    close.set_defaults(handler=command_close)
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
