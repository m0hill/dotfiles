#!/usr/bin/env python3
"""Local task checkouts with branch-aware dependency bootstrapping (Python 3.11+)."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import shutil
import subprocess
import sys
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import activity


class WorktreeError(Exception):
    pass


@dataclass(frozen=True)
class Step:
    cwd: Path
    seed_dirs: tuple[Path, ...]
    command: tuple[str, ...]


@dataclass(frozen=True)
class Profile:
    source: str
    remote: str
    env_files: tuple[Path, ...]
    steps: tuple[Step, ...]


@dataclass(frozen=True)
class Checkout:
    path: Path
    head: str
    branch: str | None


def run(args: Sequence[str], cwd: Path, *, capture: bool = False) -> str:
    result = subprocess.run(
        args,
        cwd=cwd,
        check=True,
        text=True,
        stdout=subprocess.PIPE if capture else sys.stderr,
        stderr=subprocess.PIPE if capture else None,
    )
    return result.stdout.strip() if capture else ""


def git(root: Path, *args: str) -> str:
    return run(["git", "-C", str(root), *args], root, capture=True)


def succeeds(root: Path, *args: str) -> bool:
    return (
        subprocess.run(
            ["git", "-C", str(root), *args],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        ).returncode
        == 0
    )


def name(value: str) -> str:
    if not value or value.startswith((".", "-")) or Path(value).name != value:
        raise WorktreeError(f"Expected a direct child name, got {value!r}")
    return value


def relative(value: str) -> Path:
    path = Path(value)
    if not value or path.is_absolute() or ".." in path.parts or ".git" in path.parts:
        raise WorktreeError(f"Expected a repository-relative path, got {value!r}")
    return path


def inside(base: Path, part: Path) -> Path:
    target = base / part
    if not target.resolve().is_relative_to(base.resolve()):
        raise WorktreeError(f"Path escapes its checkout: {target}")
    return target


def strings(value: object) -> tuple[str, ...]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise WorktreeError("Expected an array of strings in setup profile")
    return tuple(item for item in value if isinstance(item, str))


def mapping(value: object) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise WorktreeError("Expected an object in setup profile")
    return {key: item for key, item in value.items() if isinstance(key, str)}


def string(value: object) -> str:
    if not isinstance(value, str) or not value:
        raise WorktreeError("Expected a nonempty string in setup profile")
    return value


def profile(root: Path) -> Profile:
    raw: object = json.loads((root / ".worktrees.json").read_text())
    data = mapping(raw)
    if data.get("version") != 1:
        raise WorktreeError("Setup profile must have version 1")
    raw_steps = data.get("steps")
    if not isinstance(raw_steps, list):
        raise WorktreeError("Setup profile needs a steps array")
    steps: list[Step] = []
    for raw_step in raw_steps:
        item = mapping(raw_step)
        command = strings(item.get("command"))
        seeds = tuple(relative(p) for p in strings(item.get("seed_dirs")))
        if not command or any(".venv" in p.parts or "venv" in p.parts for p in seeds):
            raise WorktreeError(
                "Steps need a command; virtualenv seeding is unsupported"
            )
        steps.append(Step(relative(string(item.get("cwd"))), seeds, command))
    return Profile(
        name(string(data.get("source"))),
        string(data.get("remote")),
        tuple(relative(p) for p in strings(data.get("env_files"))),
        tuple(steps),
    )


def discover(selected: str | None) -> Path:
    if selected:
        root = Path(selected).expanduser().resolve()
    else:
        common = Path(
            git(Path.cwd(), "rev-parse", "--path-format=absolute", "--git-common-dir")
        )
        root = common.parent
    if (
        not (root / ".bare").is_dir()
        or git(root, "rev-parse", "--is-bare-repository") != "true"
    ):
        raise WorktreeError("Use -r to select a canonical root containing .bare/")
    return root


def checkouts(root: Path) -> list[Checkout]:
    output = git(root, "worktree", "list", "--porcelain", "-z")
    result: list[Checkout] = []
    for block in output.split("\0\0"):
        fields: dict[str, str] = {}
        for line in block.split("\0"):
            if line:
                key, _, value = line.partition(" ")
                fields[key] = value
        if "worktree" in fields and "bare" not in fields:
            result.append(
                Checkout(Path(fields["worktree"]), fields["HEAD"], fields.get("branch"))
            )
    return result


def checkout(root: Path, selected: str) -> Path:
    path = root / name(selected)
    if path not in [item.path for item in checkouts(root)]:
        raise WorktreeError(f"Not a registered task checkout: {path}")
    return path


@contextmanager
def locked(root: Path) -> Iterator[None]:
    local = root / ".local"
    local.mkdir(exist_ok=True, mode=0o700)
    with (local / "lock").open("w") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise WorktreeError(
                "Another wt/dev operation is running in this root; retry after it finishes"
            ) from error
        yield


def clone_directory(source: Path, destination: Path) -> None:
    if destination.exists() or destination.is_symlink():
        raise WorktreeError(f"Copy destination already exists: {destination}")
    args = ["cp", "-cR"] if sys.platform == "darwin" else ["cp", "-a", "--reflink=auto"]
    run([*args, str(source), str(destination)], source.parent)


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.chmod(0o600)
    temporary.replace(path)


def setup_marker(root: Path, target: Path) -> Path:
    return root / ".local" / "setup" / target.name


def setup(root: Path, target: Path) -> None:
    config = profile(root)
    source = checkout(root, config.source)
    state_file = setup_marker(root, target)
    state_file.unlink(missing_ok=True)
    missing_env: list[tuple[Path, Path]] = []
    # Preflight all env destinations before writing any local configuration.
    for relative_path in config.env_files:
        dst = inside(target, relative_path)
        if succeeds(
            target, "ls-files", "--error-unmatch", "--", str(relative_path)
        ) or not succeeds(target, "check-ignore", "--quiet", "--", str(relative_path)):
            raise WorktreeError(
                f"Environment destination must be ignored and untracked: {dst}"
            )
        if not dst.exists():
            src = inside(source, relative_path)
            if not src.is_file():
                raise WorktreeError(f"Missing setup source file: {src}")
            missing_env.append((src, dst))
    for src, dst in missing_env:
        dst.parent.mkdir(parents=True, exist_ok=True)
        with dst.open("xb") as handle:
            os.fchmod(handle.fileno(), 0o600)
            handle.write(src.read_bytes())
        print(f"Copied {dst.relative_to(target)}", file=sys.stderr)
    for step in config.steps:
        cwd = inside(target, step.cwd)
        if not cwd.is_dir():
            raise WorktreeError(f"Setup directory is absent on this branch: {cwd}")
        for seed in step.seed_dirs:
            dst = inside(cwd, seed)
            src = inside(inside(source, step.cwd), seed)
            if src.is_dir() and not dst.exists():
                print(f"Seeding {step.cwd / seed}", file=sys.stderr)
                clone_directory(src, dst)
        print(f"Installing/setup in {step.cwd}", file=sys.stderr)
        environment = os.environ.copy()
        environment["CI"] = "true"
        environment.pop("VIRTUAL_ENV", None)
        # Inherited Git overrides must not redirect lifecycle scripts to another checkout.
        for key in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"):
            environment.pop(key, None)
        subprocess.run(
            step.command, cwd=cwd, env=environment, stdout=sys.stderr, check=True
        )
    state_file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    state_file.touch(mode=0o600)
    print(f"Ready: {target}", file=sys.stderr)


def create(
    root: Path, selected: str, branch: str, base: str | None, offline: bool
) -> Path:
    target = root / name(selected)
    config = profile(root)
    if not succeeds(root, "check-ref-format", "--branch", branch):
        raise WorktreeError(f"Invalid branch: {branch}")
    if target.exists():
        checkout(root, selected)
        if git(target, "symbolic-ref", "--short", "HEAD") != branch:
            raise WorktreeError("Existing checkout is on a different branch")
        setup(root, target)
        return target
    if not offline:
        run(["git", "fetch", "--prune", config.remote], root)
    if succeeds(root, "show-ref", "--verify", "--quiet", f"refs/heads/{branch}"):
        args = ["worktree", "add", str(target), branch]
    elif succeeds(
        root,
        "show-ref",
        "--verify",
        "--quiet",
        f"refs/remotes/{config.remote}/{branch}",
    ):
        args = [
            "worktree",
            "add",
            "--track",
            "-b",
            branch,
            str(target),
            f"{config.remote}/{branch}",
        ]
    else:
        if base is None:
            base = git(
                root, "symbolic-ref", "--short", f"refs/remotes/{config.remote}/HEAD"
            )
        git(root, "rev-parse", "--verify", f"{base}^{{commit}}")
        args = ["worktree", "add", "--no-track", "-b", branch, str(target), base]
    run(["git", *args], root)
    setup(root, target)
    return target


def list_checkouts(root: Path) -> None:
    for item in checkouts(root):
        status = git(item.path, "status", "--porcelain=v1")
        changes = len(status.splitlines()) if status else 0
        branch = (
            item.branch.removeprefix("refs/heads/")
            if item.branch
            else f"detached:{item.head[:9]}"
        )
        upstream = "no upstream"
        if succeeds(item.path, "rev-parse", "--verify", "@{upstream}"):
            upstream = "ahead/behind " + git(
                item.path, "rev-list", "--left-right", "--count", "HEAD...@{upstream}"
            ).replace("\t", "/")
        ready = (
            "setup recorded"
            if setup_marker(root, item.path).exists()
            else "setup needed"
        )
        print(
            f"{item.path.relative_to(root)}\t{branch}\t{changes} changes\t{upstream}\t{ready}"
        )


def doctor(root: Path) -> None:
    config = profile(root)
    source = checkout(root, config.source)
    for item in checkouts(root):
        if not item.path.is_relative_to(root):
            raise WorktreeError(f"Checkout outside the canonical root: {item.path}")
        if (
            Path(
                git(
                    item.path, "rev-parse", "--path-format=absolute", "--git-common-dir"
                )
            ).resolve()
            != root / ".bare"
        ):
            raise WorktreeError(f"Incorrect Git registration: {item.path}")
    for path in config.env_files:
        if not inside(source, path).is_file():
            raise WorktreeError(f"Missing source env file: {path}")
    print(f"Healthy: {root} ({len(checkouts(root))} checkouts)")


def migrate(source: Path, root: Path, selected_profile: str | None) -> None:
    source, root = source.resolve(), root.absolute()
    if selected_profile and shutil.which("mise") is None:
        raise WorktreeError(
            "The Caretomo profile requires mise for its pinned runtimes"
        )
    if root.exists() or root.is_relative_to(source) or source.is_relative_to(root):
        raise WorktreeError("Migration destination must be new and outside the source")
    original_git = source / ".git"
    if not original_git.is_dir() or original_git.is_symlink():
        raise WorktreeError(
            "Migration source must be a primary checkout with its own .git directory"
        )
    if git(source, "config", "--get", "core.bare") != "false":
        raise WorktreeError("Migration source must be a non-bare checkout")
    for entry in (
        "MERGE_HEAD",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "BISECT_LOG",
        "rebase-merge",
        "rebase-apply",
        "index.lock",
        "HEAD.lock",
        "config.lock",
        "config.worktree",
        "modules",
    ):
        if (original_git / entry).exists():
            raise WorktreeError(f"Resolve source Git state before migration: {entry}")
    if git(source, "ls-files", "--stage").find("160000 ") != -1:
        raise WorktreeError("Submodule migration is unsupported")
    branch = git(source, "symbolic-ref", "--short", "HEAD")
    old_checkouts = checkouts(source)
    states = {
        str(item.path): git(item.path, "status", "--porcelain=v1", "-z")
        for item in old_checkouts
    }
    refs = git(source, "show-ref")
    root.parent.mkdir(parents=True, exist_ok=True)
    if source.stat().st_dev != root.parent.stat().st_dev:
        raise WorktreeError(
            "Migration requires source and destination on the same filesystem"
        )
    root.mkdir()
    backup = root / ".local" / "migration"
    backup.mkdir(parents=True, mode=0o700)
    write_json(
        backup / "manifest.json",
        {
            "source": str(source),
            "destination": str(root),
            "branch": branch,
            "refs": refs,
            "status": states,
            "worktrees": [
                {"path": str(item.path), "head": item.head, "branch": item.branch}
                for item in old_checkouts
            ],
        },
    )
    # Preserve all Git metadata before touching the original checkout. The new
    # registry starts with main only; old checkouts retain their own metadata.
    clone_directory(original_git, root / ".bare")
    copied_registrations = root / ".bare" / "worktrees"
    if copied_registrations.exists():
        shutil.rmtree(copied_registrations)
    (root / ".git").write_text("gitdir: ./.bare\n")
    git(root, "config", "core.bare", "true")
    git(root, "config", "core.logAllRefUpdates", "true")
    git(root, "config", "worktree.useRelativePaths", "true")
    main = root / "main"
    run(["git", "worktree", "add", "--no-checkout", str(main), branch], root)
    main_git = Path(git(main, "rev-parse", "--absolute-git-dir"))
    for entry in ("index", "ORIG_HEAD", "logs/HEAD"):
        src = original_git / entry
        if src.is_file():
            dst = main_git / entry
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
    original_git.rename(backup / "original.git")
    for item in old_checkouts:
        if item.path != source:
            marker = item.path / ".git"
            registration = Path(
                marker.read_text().removeprefix("gitdir: ").strip()
            ).name
            marker.write_text(
                f"gitdir: {backup / 'original.git' / 'worktrees' / registration}\n"
            )
    subprocess.run(
        [
            "git",
            "--git-dir",
            str(backup / "original.git"),
            "config",
            "core.bare",
            "true",
        ],
        check=True,
    )
    for working_file in source.iterdir():
        working_file.rename(main / working_file.name)
    source.rmdir()
    source.symlink_to(main, target_is_directory=True)
    if selected_profile:
        assets = Path(__file__).resolve().parent.parent / "assets"
        shutil.copy2(assets / f"{selected_profile}.json", root / ".worktrees.json")
        shutil.copy2(assets / f"{selected_profile}.mise.toml", root / "mise.toml")
        shutil.copy2(assets / f"{selected_profile}.AGENTS.md", root / "AGENTS.md")
        run(["mise", "trust", str(root / "mise.toml")], root)
    else:
        write_json(
            root / ".worktrees.json",
            {
                "version": 1,
                "source": "main",
                "remote": "origin",
                "env_files": [],
                "steps": [],
            },
        )
    if refs != git(root, "show-ref") or states[str(source)] != git(
        main, "status", "--porcelain=v1", "-z"
    ):
        raise WorktreeError(f"Migration verification failed; preserve {backup}")
    for item in old_checkouts:
        if item.path != source and states[str(item.path)] != git(
            item.path, "status", "--porcelain=v1", "-z"
        ):
            raise WorktreeError(f"Old checkout verification failed: {item.path}")
    print(f"Migrated to {main}; original Git metadata retained at {backup}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "-r", "--root", help="Canonical repository root (otherwise discovered from cwd)"
    )
    parser.add_argument(
        "--agent-id", help="Stable agent ID; defaults to CODEX_THREAD_ID"
    )
    parser.add_argument("--agent-name", help="Readable agent/task name")
    commands = parser.add_subparsers(dest="action", required=True)
    new = commands.add_parser(
        "new", help="Create/resume a branch checkout and complete setup"
    )
    new.add_argument("name")
    new.add_argument("branch")
    new.add_argument("--base")
    new.add_argument("--offline", action="store_true")
    for action in ("setup", "path"):
        command = commands.add_parser(action)
        command.add_argument("name")
    commands.add_parser("list")
    commands.add_parser("doctor")
    migration = commands.add_parser(
        "migrate", help="Migrate primary checkout only; retain old Git metadata"
    )
    migration.add_argument("source")
    migration.add_argument("destination")
    migration.add_argument("--profile", choices=["caretomo"])
    args = parser.parse_args()
    try:
        if args.action == "migrate":
            migrate(
                Path(args.source).expanduser(),
                Path(args.destination).expanduser(),
                args.profile,
            )
            return 0
        root = discover(args.root)
        if args.action == "path":
            print(checkout(root, args.name))
        elif args.action == "list":
            list_checkouts(root)
        elif args.action == "doctor":
            doctor(root)
        else:
            actor = activity.agent(
                args.agent_id
                or os.environ.get("CODEX_THREAD_ID")
                or f"manual:{os.getuid()}",
                args.agent_name,
            )
            with locked(root):
                activity.event(
                    root, actor, f"{args.action}-started", {"checkout": args.name}
                )
                try:
                    if args.action == "new":
                        print(
                            create(
                                root, args.name, args.branch, args.base, args.offline
                            )
                        )
                    elif args.action == "setup":
                        target = checkout(root, args.name)
                        setup(root, target)
                        print(target)
                except (
                    WorktreeError,
                    OSError,
                    ValueError,
                    subprocess.CalledProcessError,
                ):
                    activity.event(
                        root, actor, f"{args.action}-failed", {"checkout": args.name}
                    )
                    raise
                activity.event(
                    root, actor, f"{args.action}-finished", {"checkout": args.name}
                )
        return 0
    except (WorktreeError, OSError, ValueError, subprocess.CalledProcessError) as error:
        # Captured Git errors contain no copied env file contents.
        detail = (
            error.stderr.strip()
            if isinstance(error, subprocess.CalledProcessError) and error.stderr
            else str(error)
        )
        print(f"wt: {detail}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
