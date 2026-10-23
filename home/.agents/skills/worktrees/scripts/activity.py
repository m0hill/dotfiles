"""Identity and local lifecycle events shared by wt and dev."""

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path


@dataclass(frozen=True)
class Agent:
    id: str
    name: str


def agent(identifier: str | None, name: str | None) -> Agent:
    identifier = identifier or os.environ.get("CODEX_THREAD_ID")
    if not identifier:
        raise ValueError("Set --agent-id to this agent's stable chat/session ID")
    label = (
        f"Terminal {identifier}"
        if identifier.startswith("manual:")
        else f"Codex {identifier[:8]}"
    )
    return Agent(identifier, name or label)


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def event(root: Path, actor: Agent, action: str, detail: object) -> None:
    # Callers hold the root lock so each event remains a complete JSON line.
    path = root / ".local/events.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.open("a") as output:
        path.chmod(0o600)
        output.write(
            json.dumps(
                {
                    "at": now(),
                    "agent": asdict(actor),
                    "action": action,
                    "detail": detail,
                }
            )
            + "\n"
        )
