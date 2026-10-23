"""Local stack reservations. Call mutations while holding the root lock."""

from dataclasses import asdict, dataclass
import json
from pathlib import Path

from activity import Agent, agent as agent, event as event, now as now
from worktrees import WorktreeError, mapping, string, write_json


@dataclass(frozen=True)
class Request:
    agent: Agent
    checkout: str
    branch: str
    reason: str
    since: str


@dataclass
class Coordination:
    reservation: Request | None
    waiting: list[Request]


def parse_request(value: object) -> Request:
    item = mapping(value)
    actor = mapping(item.get("agent"))
    return Request(
        Agent(string(actor.get("id")), string(actor.get("name"))),
        string(item.get("checkout")),
        string(item.get("branch")),
        string(item.get("reason")),
        string(item.get("since")),
    )


def load(root: Path) -> Coordination:
    path = root / ".local/coordination.json"
    if not path.exists():
        return Coordination(None, [])
    data = mapping(json.loads(path.read_text()))
    raw = data.get("reservation")
    waiting = data.get("waiting")
    if not isinstance(waiting, list):
        raise WorktreeError("Expected a waiting list in coordination.json")
    return Coordination(
        parse_request(raw) if raw is not None else None,
        [parse_request(item) for item in waiting],
    )


def save(root: Path, state: Coordination) -> None:
    write_json(root / ".local/coordination.json", asdict(state))


def describe(request: Request) -> str:
    return f"{request.agent.name} [{request.agent.id}] on {request.branch} ({request.checkout}): {request.reason}, since {request.since}"


def reserve(root: Path, request: Request) -> bool:
    state = load(root)
    owner = state.reservation
    if owner is not None and owner.agent.id != request.agent.id:
        if not any(
            item.agent.id == request.agent.id
            and item.checkout == request.checkout
            and item.reason == request.reason
            for item in state.waiting
        ):
            state.waiting = [
                item for item in state.waiting if item.agent.id != request.agent.id
            ]
            state.waiting.append(request)
            save(root, state)
            event(root, request.agent, "requested", asdict(request))
        return False
    if owner is not None and owner.checkout != request.checkout:
        raise WorktreeError(
            "Release your current reservation before reserving another checkout"
        )
    if owner is None:
        state.reservation = request
        state.waiting = [
            item for item in state.waiting if item.agent.id != request.agent.id
        ]
        save(root, state)
        event(root, request.agent, "reserved", asdict(request))
    return True


def guard(root: Path, actor: Agent, checkout: str | None = None) -> None:
    owner = load(root).reservation
    if owner is not None:
        if owner.agent.id != actor.id:
            raise WorktreeError(
                f"Stack reserved by {describe(owner)}. Use dev reserve to request access; do not interrupt it."
            )
        if checkout is not None and checkout != owner.checkout:
            raise WorktreeError(
                f"Your reservation is for {owner.checkout}; release it before selecting {checkout}"
            )


def release(root: Path, actor: Agent, result: str, force: bool) -> None:
    state = load(root)
    if not force:
        guard(root, actor)
    previous = state.reservation
    state.reservation = None
    state.waiting = [item for item in state.waiting if item.agent.id != actor.id]
    save(root, state)
    event(
        root,
        actor,
        "force-released" if force else "released",
        {"result": result, "previous": asdict(previous) if previous else None},
    )


def cancel(root: Path, actor: Agent) -> None:
    state = load(root)
    state.waiting = [item for item in state.waiting if item.agent.id != actor.id]
    save(root, state)
    event(root, actor, "cancelled-request", None)
