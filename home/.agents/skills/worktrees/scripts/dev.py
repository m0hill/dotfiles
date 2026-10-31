#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["python-dotenv==1.2.2"]
# ///
"""One active Caretomo development stack, displayed in owned Rex panes."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shlex
import signal
import socket
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path

from dotenv import dotenv_values, set_key

import coordination
from worktrees import (
    WorktreeError,
    checkout,
    discover,
    git,
    locked,
    mapping,
    run,
    string,
    write_json,
)


@dataclass(frozen=True)
class Config:
    session: str
    container: str
    postgres_port: int
    postgres_user: str
    main_database: str


@dataclass(frozen=True)
class Active:
    name: str
    branch: str
    database: str


@dataclass
class Runtime:
    workspace: str
    panes: dict[str, str]
    active: Active | None


@dataclass(frozen=True)
class Service:
    label: str
    directory: str
    command: tuple[str, ...]
    port: int | None


SERVICES = {
    "django": Service("Django + worker", "apps/backend", ("just", "dev-all"), 8000),
    "web": Service(
        "Next.js", "apps/web", ("corepack", "pnpm", "dev", "--port", "3000"), 3000
    ),
    "fastapi": Service("FastAPI", "legacy/ai-service", ("make", "dev"), 8001),
    "storybook": Service(
        "Storybook", "apps/web", ("corepack", "pnpm", "storybook", "--exact-port"), 6006
    ),
    "phoenix": Service("Phoenix", "apps/backend", ("just", "phoenix"), 6007),
    "database": Service("Database", ".", (), None),
}


def sql_name(value: str) -> str:
    if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", value):
        raise WorktreeError(f"Expected a local PostgreSQL identifier, got {value!r}")
    return value


def config(root: Path) -> Config:
    data = mapping(json.loads((root / ".dev.json").read_text()))
    port = data.get("postgres_port")
    if not isinstance(port, int) or not 1 <= port <= 65535:
        raise WorktreeError("postgres_port must be a TCP port number")
    return Config(
        string(data.get("session")),
        string(data.get("container")),
        port,
        sql_name(string(data.get("postgres_user"))),
        sql_name(string(data.get("main_database"))),
    )


def database_name(settings: Config, name: str) -> str:
    if name == "main":
        return settings.main_database
    slug = re.sub(r"[^a-z0-9_]", "_", name.lower())[:35]
    return f"caretomo_{slug}_{hashlib.sha256(name.encode()).hexdigest()[:6]}"


def rex(*args: str) -> dict[str, object]:
    output = run(["rex", "--autostart=false", *args], Path.cwd(), capture=True)
    return mapping(json.loads(output)) if output else {}


def first_block(result: dict[str, object]) -> str:
    blocks = result.get("block_ids")
    if not isinstance(blocks, list) or not blocks:
        raise WorktreeError("Rex did not return a terminal block")
    return string(blocks[0])


def state_file(root: Path) -> Path:
    return root / ".local" / "runtime.json"


def load_runtime(root: Path) -> Runtime:
    data = mapping(json.loads(state_file(root).read_text()))
    raw_active = data.get("active")
    active = None
    if raw_active is not None:
        item = mapping(raw_active)
        active = Active(
            string(item.get("name")),
            string(item.get("branch")),
            string(item.get("database")),
        )
    panes = {key: string(value) for key, value in mapping(data.get("panes")).items()}
    return Runtime(string(data.get("workspace")), panes, active)


def save(root: Path, runtime: Runtime) -> None:
    write_json(state_file(root), asdict(runtime))


def ensure_workspace(root: Path, settings: Config) -> Runtime:
    if state_file(root).exists():
        runtime = load_runtime(root)
        rex("session", "inspect", runtime.workspace, "--json")
        return runtime
    result = rex(
        "new", settings.session, "--cwd", str(root), "--window", "App", "--json"
    )
    windows = result.get("initial_windows")
    if not isinstance(windows, list) or not windows:
        raise WorktreeError("Rex did not return an initial window")
    runtime = Runtime(
        string(result.get("session_id")),
        {"django": first_block(mapping(windows[0]))},
        None,
    )
    save(root, runtime)
    return runtime


def ensure_pane(root: Path, settings: Config, runtime: Runtime, service: str) -> str:
    if service not in runtime.panes:
        if service == "web":
            result = rex(
                "split",
                "-s",
                runtime.workspace,
                "-b",
                runtime.panes["django"],
                "--split=right",
                "--cwd",
                str(root),
                "--focus=false",
                "--json",
            )
        else:
            result = rex(
                "window",
                "new",
                "-s",
                runtime.workspace,
                SERVICES[service].label,
                "--cwd",
                str(root),
                "--focus=false",
                "--json",
            )
        runtime.panes[service] = first_block(result)
        save(root, runtime)
    pane_id = runtime.panes[service]
    pane = rex("block", "inspect", pane_id, "--json")
    if pane.get("session_id") != runtime.workspace:
        raise WorktreeError("Saved pane is outside the owned runtime session")
    rex("block", "rename", "-s", runtime.workspace, pane_id, SERVICES[service].label)
    return pane_id


def process_file(root: Path, service: str) -> Path:
    return root / ".local" / "services" / f"{service}.json"


def started(pid: int) -> str:
    result = subprocess.run(
        ["ps", "-p", str(pid), "-o", "lstart="],
        text=True,
        capture_output=True,
        check=False,
    )
    return result.stdout.strip()


def running(root: Path, service: str) -> bool:
    path = process_file(root, service)
    if not path.exists():
        return False
    data = mapping(json.loads(path.read_text()))
    pid = data.get("pid")
    return (
        isinstance(pid, int)
        and bool(data.get("started"))
        and started(pid) == data.get("started")
    )


def port_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.2):
            return True
    except OSError:
        return False


def postgres(root: Path, settings: Config) -> None:
    run(["docker", "start", settings.container], root)
    binding = run(
        ["docker", "port", settings.container, "5432/tcp"], root, capture=True
    )
    if not binding.endswith(f":{settings.postgres_port}"):
        raise WorktreeError(
            "Configured PostgreSQL container port does not match .dev.json"
        )
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        result = subprocess.run(
            [
                "docker",
                "exec",
                settings.container,
                "pg_isready",
                "-U",
                settings.postgres_user,
                "-d",
                "postgres",
            ],
            capture_output=True,
            check=False,
        )
        if result.returncode == 0:
            return
        time.sleep(0.2)
    raise WorktreeError("PostgreSQL did not become ready")


def sql(root: Path, settings: Config, query: str) -> str:
    return run(
        [
            "docker",
            "exec",
            settings.container,
            "psql",
            "-X",
            "-U",
            settings.postgres_user,
            "-d",
            "postgres",
            "-At",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            query,
        ],
        root,
        capture=True,
    )


def database_exists(root: Path, settings: Config, database: str) -> bool:
    return (
        sql(
            root,
            settings,
            f"SELECT 1 FROM pg_database WHERE datname = '{sql_name(database)}'",
        )
        == "1"
    )


def environment(
    root: Path, target: Path, service: str, database: str
) -> dict[str, str]:
    directory = SERVICES[service].directory
    env_path = (
        target / directory / (".env.local" if directory == "apps/web" else ".env")
    )
    values = {
        key: value
        for key, value in dotenv_values(env_path).items()
        if value is not None
    }
    result = os.environ.copy()
    for key in ("VIRTUAL_ENV", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "PORT"):
        result.pop(key, None)
    result.update(values)
    # Honcho reloads .env, so stale file credentials must be removed at source.
    aws_keys = ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN")
    if any(values.get(key) for key in aws_keys) or values.get("AWS_PROFILE") not in (
        None,
        "sind-dev",
    ):
        raise WorktreeError(
            f"Remove static AWS keys or a conflicting AWS_PROFILE from {env_path}; local services use sind-dev SSO"
        )
    for key in aws_keys:
        result.pop(key, None)
    result["AWS_PROFILE"] = "sind-dev"
    result["AWS_REGION"] = "ap-northeast-1"
    result["AWS_DEFAULT_REGION"] = "ap-northeast-1"
    result["APP_ENVIRONMENT"] = "development"
    result["PYTHONUNBUFFERED"] = "1"
    if directory == "apps/backend":
        if values.get("APP_PG_DB") != database:
            raise WorktreeError(
                "Checkout database is not initialized; run dev db-init for this checkout"
            )
        result["PHOENIX_PORT"] = "6007"
        result["PHOENIX_COLLECTOR_ENDPOINT"] = "http://localhost:6007"
        result["PHOENIX_WORKING_DIR"] = str(root / ".local" / "phoenix")
    if service == "phoenix":
        # Older app checkouts pin Python 3.10, whose SciPy wheel fails on recent macOS.
        result["UV_PYTHON"] = "3.11"
        result["UV_PROJECT_ENVIRONMENT"] = str(root / ".local" / "phoenix-venv")
    return result


def db_init(root: Path, settings: Config, name: str) -> None:
    target = checkout(root, name)
    if name == "main":
        raise WorktreeError(
            "main retains its existing database; initialize task checkouts instead"
        )
    database = database_name(settings, name)
    postgres(root, settings)
    if not database_exists(root, settings, database):
        sql(
            root,
            settings,
            f'CREATE DATABASE "{database}" OWNER "{settings.postgres_user}"',
        )
    env_path = target / "apps/backend/.env"
    if not env_path.is_file():
        raise WorktreeError("Run wt setup before initializing a task database")
    for key, value in {
        "APP_PG_DB": database,
        "APP_PG_HOST": "127.0.0.1",
        "APP_PG_PORT": str(settings.postgres_port),
    }.items():
        set_key(env_path, key, value, quote_mode="never")
    run_env = environment(root, target, "django", database)
    subprocess.run(
        ["mise", "exec", "--", "just", "migrate"],
        cwd=target / "apps/backend",
        env=run_env,
        check=True,
    )
    subprocess.run(
        [
            "mise",
            "exec",
            "--",
            "uv",
            "run",
            "python",
            "backend/manage.py",
            "migrate",
            "procrastinate",
            "--database",
            "procrastinate",
        ],
        cwd=target / "apps/backend",
        env=run_env,
        check=True,
    )
    print(
        f"Initialized {database}. Data seeding is separate; no existing database was reset."
    )


def start_service(
    root: Path, settings: Config, runtime: Runtime, service: str, name: str
) -> None:
    if running(root, service):
        return
    port = SERVICES[service].port
    if port is not None and port_open(port):
        raise WorktreeError(
            f"Port {port} is occupied outside the managed {service} process"
        )
    pane = ensure_pane(root, settings, runtime, service)
    process_file(root, service).unlink(missing_ok=True)
    command = shlex.join(
        [str(Path.home() / ".local/bin/dev"), "-r", str(root), "_run", service, name]
    )
    rex("send", "-s", runtime.workspace, "-b", pane, command)
    rex("send-key", "-s", runtime.workspace, "-b", pane, "enter")
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        if running(root, service) and (port is None or port_open(port)):
            print(f"Started {service}", file=sys.stderr)
            return
        time.sleep(0.25)
    raise WorktreeError(
        f"{service} did not become ready; inspect its Rex pane or dev logs {service}"
    )


def up(root: Path, settings: Config, name: str) -> None:
    target = checkout(root, name)
    branch = git(target, "symbolic-ref", "--short", "HEAD")
    runtime = ensure_workspace(root, settings)
    active = Active(name, branch, database_name(settings, name))
    if runtime.active is not None and runtime.active != active:
        raise WorktreeError(
            f"Stack belongs to {runtime.active.branch} in {runtime.active.name}; use dev switch after reserving the stack"
        )
    for service in [service for service in SERVICES if service != "database"]:
        port = SERVICES[service].port
        if port is not None and port_open(port) and not running(root, service):
            raise WorktreeError(
                f"Port {port} is already in use; no unrelated process was stopped"
            )
    postgres(root, settings)
    if not database_exists(root, settings, active.database):
        raise WorktreeError(f"Run dev db-init {name} before starting this checkout")
    environment(root, target, "django", active.database)
    runtime.active = active
    save(root, runtime)
    rex("session", "rename", runtime.workspace, f"{settings.session} · {branch}")
    start_service(root, settings, runtime, "database", name)
    for service in [service for service in SERVICES if service != "database"]:
        start_service(root, settings, runtime, service, name)


def stop_service(root: Path, settings: Config, runtime: Runtime, service: str) -> None:
    if not running(root, service):
        return
    pane = ensure_pane(root, settings, runtime, service)
    rex("send-key", "-s", runtime.workspace, "-b", pane, "ctrl+c")
    deadline = time.monotonic() + 40
    while running(root, service) and time.monotonic() < deadline:
        time.sleep(0.2)
    if running(root, service):
        raise WorktreeError(f"{service} is still stopping; switching is blocked")
    port = SERVICES[service].port
    if port is not None and port_open(port):
        raise WorktreeError(
            f"Port {port} is still occupied; inspect it before switching"
        )


def down(root: Path, settings: Config, all_services: bool) -> None:
    runtime = load_runtime(root)
    for service in runtime.panes:
        if service != "database":
            stop_service(root, settings, runtime, service)
    if all_services:
        stop_service(root, settings, runtime, "database")
        run(["docker", "stop", settings.container], root)
    runtime.active = None
    save(root, runtime)
    rex("session", "rename", runtime.workspace, settings.session)


def serve(root: Path, settings: Config, service: str, name: str) -> int:
    runtime = load_runtime(root)
    if service != "database" and (
        runtime.active is None or runtime.active.name != name
    ):
        raise WorktreeError("This checkout no longer owns the development stack")
    target = checkout(root, name)
    database = database_name(settings, name)
    spec = SERVICES[service]
    if service == "database":
        command = ["docker", "logs", "--follow", "--tail", "20", settings.container]
        cwd, env = root, os.environ.copy()
        print(
            f"PostgreSQL: {settings.container} · 127.0.0.1:{settings.postgres_port} · database {database}",
            flush=True,
        )
        print(
            "This pane follows logs. dev down --all stops the container without deleting its volume.",
            flush=True,
        )
    else:
        cwd = target / spec.directory
        env = environment(root, target, service, database)
        command = ["mise", "exec", "--", *spec.command]
        print(f"{spec.label} · {name} · database {database}", flush=True)
    marker = process_file(root, service)
    marker.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if running(root, service):
        raise WorktreeError(f"{service} is already running")
    write_json(marker, {"pid": os.getpid(), "started": started(os.getpid())})
    child = subprocess.Popen(command, cwd=cwd, env=env)

    def stop(signum: int, frame: object) -> None:
        if child.poll() is None:
            child.send_signal(signal.SIGTERM)

    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(signum, stop)
    try:
        return child.wait()
    finally:
        marker.unlink(missing_ok=True)


def status(root: Path, settings: Config) -> None:
    runtime = load_runtime(root)
    services = {}
    for name, spec in SERVICES.items():
        port = settings.postgres_port if name == "database" else spec.port
        services[name] = {
            "running": running(root, name),
            "port": port,
            "port_open": port_open(port) if port else None,
            "pane": runtime.panes.get(name),
        }
        if name == "database":
            services[name]["logs_running"] = running(root, name)
            services[name]["running"] = (
                run(
                    [
                        "docker",
                        "inspect",
                        "--format",
                        "{{.State.Running}}",
                        settings.container,
                    ],
                    root,
                    capture=True,
                )
                == "true"
            )
    print(
        json.dumps(
            {
                "active": asdict(runtime.active) if runtime.active else None,
                "session": settings.session,
                "workspace": runtime.workspace,
                "services": services,
                "coordination": asdict(coordination.load(root)),
            },
            indent=2,
        )
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-r", "--root")
    parser.add_argument(
        "--agent-id", help="Stable agent chat/session ID; defaults to CODEX_THREAD_ID"
    )
    parser.add_argument("--agent-name", help="Readable agent/task name")
    commands = parser.add_subparsers(dest="action", required=True)
    for action in ("up", "switch"):
        command = commands.add_parser(
            action,
            help="Start/resume a checkout"
            if action == "up"
            else "Explicitly switch the active checkout",
        )
        command.add_argument("name")
    command = commands.add_parser(
        "db-init", help="Create a task database and apply its migrations"
    )
    command.add_argument("name")
    command = commands.add_parser(
        "down", help="Stop managed services; --all also stops Postgres"
    )
    command.add_argument("--all", action="store_true", dest="all_services")
    commands.add_parser(
        "status", help="Show ownership, processes, ports, and pane IDs as JSON"
    )
    command = commands.add_parser("logs", help="Read a service's Rex terminal")
    command.add_argument("service", choices=[*SERVICES, "worker"])
    command.add_argument("--lines", type=int, default=60)
    command = commands.add_parser(
        "reserve", help="Reserve the stack, or record a request if busy"
    )
    command.add_argument("name")
    command.add_argument("--reason", required=True)
    command.add_argument("--wait", type=int, default=0, metavar="SECONDS")
    command = commands.add_parser(
        "release", help="Release a reservation; leave services running"
    )
    command.add_argument("--result", required=True)
    command.add_argument(
        "--force",
        action="store_true",
        help="Recovery only, with explicit user authorization",
    )
    commands.add_parser("cancel", help="Remove your waiting request")
    command = commands.add_parser(
        "events", help="Read recent lifecycle events as JSON lines"
    )
    command.add_argument("--lines", type=int, default=30)
    command = commands.add_parser(
        "_run", help="Internal: run a service inside its owned pane"
    )
    command.add_argument("service", choices=list(SERVICES))
    command.add_argument("name")
    args = parser.parse_args()
    try:
        root = discover(args.root)
        settings = config(root)
        if args.action == "_run":
            return serve(root, settings, args.service, args.name)
        if args.action == "events":
            path = root / ".local/events.jsonl"
            if path.exists():
                print("\n".join(path.read_text().splitlines()[-max(1, args.lines) :]))
        elif args.action == "reserve":
            actor = coordination.agent(args.agent_id, args.agent_name)
            target = checkout(root, args.name)
            request = coordination.Request(
                actor,
                args.name,
                git(target, "symbolic-ref", "--short", "HEAD"),
                string(args.reason),
                coordination.now(),
            )
            deadline = time.monotonic() + max(0, args.wait)
            last_owner = None
            while True:
                with locked(root):
                    acquired = coordination.reserve(root, request)
                    owner = coordination.load(root).reservation
                if acquired:
                    print(f"Reserved for {coordination.describe(owner or request)}")
                    break
                if owner is not None and owner != last_owner:
                    print(f"Busy: {coordination.describe(owner)}", file=sys.stderr)
                    last_owner = owner
                if time.monotonic() >= deadline:
                    print(
                        "Request recorded. Retry reserve later or use --wait SECONDS; dev cancel removes the request.",
                        file=sys.stderr,
                    )
                    return 2
                time.sleep(min(2, max(0, deadline - time.monotonic())))
        elif args.action == "status":
            status(root, settings)
        elif args.action == "logs":
            service = "django" if args.service == "worker" else args.service
            pane = load_runtime(root).panes.get(service)
            if pane is None:
                raise WorktreeError("That service has no pane yet")
            runtime = load_runtime(root)
            output = run(
                [
                    "rex",
                    "--autostart=false",
                    "capture",
                    "-s",
                    runtime.workspace,
                    "-b",
                    pane,
                    "--trim",
                    "--unwrap",
                ],
                root,
                capture=True,
            )
            print("\n".join(output.splitlines()[-max(1, args.lines) :]))

        else:
            actor = coordination.agent(
                args.agent_id
                or os.environ.get("CODEX_THREAD_ID")
                or f"manual:{os.getuid()}",
                args.agent_name,
            )
            with locked(root):
                owner = coordination.load(root).reservation
                if (
                    args.agent_name is None
                    and owner is not None
                    and owner.agent.id == actor.id
                ):
                    actor = owner.agent
                if args.action == "release":
                    coordination.release(root, actor, args.result, args.force)
                    print("Reservation released; services remain running.")
                    return 0
                if args.action == "cancel":
                    coordination.cancel(root, actor)
                    return 0
                coordination.guard(
                    root, actor, args.name if args.action in ("up", "switch") else None
                )
                coordination.event(
                    root,
                    actor,
                    f"{args.action}-started",
                    {"checkout": getattr(args, "name", None)},
                )
                try:
                    if args.action == "db-init":
                        db_init(root, settings, args.name)
                    elif args.action == "down":
                        down(root, settings, args.all_services)
                    else:
                        if args.action == "switch":
                            target = checkout(root, args.name)
                            database = database_name(settings, args.name)
                            environment(root, target, "django", database)
                            postgres(root, settings)
                            if not database_exists(root, settings, database):
                                raise WorktreeError(
                                    f"Run dev db-init {args.name} before switching"
                                )
                            down(root, settings, False)
                            runtime = load_runtime(root)
                            stop_service(root, settings, runtime, "database")
                        up(root, settings, args.name)
                except (
                    WorktreeError,
                    OSError,
                    ValueError,
                    subprocess.CalledProcessError,
                ):
                    coordination.event(
                        root,
                        actor,
                        f"{args.action}-failed",
                        {"checkout": getattr(args, "name", None)},
                    )
                    raise
                coordination.event(
                    root,
                    actor,
                    f"{args.action}-finished",
                    {"checkout": getattr(args, "name", None)},
                )
        return 0
    except (WorktreeError, OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"dev: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
