from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("worktrees.py")


class WorktreeIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name).resolve()
        self.source = self.base / "original"
        self.root = self.base / "canonical"
        self.source.mkdir()
        self.git(self.source, "init", "-b", "main")
        self.git(self.source, "config", "user.name", "Worktree Test")
        self.git(self.source, "config", "user.email", "worktree@example.invalid")
        self.git(self.source, "config", "core.hooksPath", ".githooks")
        (self.source / ".gitignore").write_text(".env\nnode_modules/\nsetup-output\n")
        (self.source / "tracked").write_text("original\n")
        (self.source / ".env").write_text("LOCAL_ONLY=fixture\n")
        dependencies = self.source / "node_modules"
        dependencies.mkdir()
        (dependencies / "package").write_text("source-package\n")
        (self.source / "setup.py").write_text(
            "from pathlib import Path\n"
            "Path('setup-output').write_text(str(Path.cwd()))\n"
        )
        self.git(self.source, "add", ".")
        self.git(self.source, "commit", "-m", "initial")

    def git(self, path: Path, *args: str) -> str:
        return subprocess.check_output(
            ["git", "-C", str(path), *args], text=True, stderr=subprocess.PIPE
        ).strip()

    def wt(self, *args: str, success: bool = True) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "-r", str(self.root), *args],
            text=True,
            capture_output=True,
            check=False,
        )
        if success:
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0)
        return result

    def migrate(self) -> None:
        self.wt("migrate", str(self.source), str(self.root))

    def configure(self, command: list[str] | None = None) -> None:
        config = {
            "version": 1,
            "source": "main",
            "remote": "origin",
            "env_files": [".env"],
            "steps": [
                {
                    "cwd": ".",
                    "seed_dirs": ["node_modules"],
                    "command": command or [sys.executable, "setup.py"],
                }
            ],
        }
        (self.root / ".worktrees.json").write_text(json.dumps(config))

    def test_migration_preserves_index_dirty_files_stash_refs_and_old_checkouts(
        self,
    ) -> None:
        (self.source / "tracked").write_text("stashed\n")
        self.git(self.source, "stash", "push", "-m", "keep stash")
        stash = self.git(self.source, "rev-parse", "refs/stash")
        old = self.base / "old-task"
        self.git(self.source, "worktree", "add", "-b", "old-task", str(old))
        (old / "tracked").write_text("old work in progress\n")
        (old / ".env").write_text("OLD_LOCAL=fixture\n")
        (self.source / "tracked").write_text("staged\n")
        self.git(self.source, "add", "tracked")
        (self.source / "tracked").write_text("unstaged\n")
        (self.source / "untracked").write_text("keep me\n")
        status = self.git(self.source, "status", "--porcelain")
        old_status = self.git(old, "status", "--porcelain")
        staged = self.git(self.source, "ls-files", "--stage")
        self.migrate()
        main = self.root / "main"
        self.assertTrue(self.source.is_symlink())
        self.assertEqual(self.git(main, "status", "--porcelain"), status)
        self.assertEqual(self.git(old, "status", "--porcelain"), old_status)
        self.assertEqual(self.git(main, "rev-parse", "refs/stash"), stash)
        self.assertEqual((main / ".env").read_bytes(), b"LOCAL_ONLY=fixture\n")
        self.assertEqual(self.git(main, "ls-files", "--stage"), staged)
        self.assertNotIn(str(old), self.git(self.root, "worktree", "list"))
        self.assertEqual((main / "untracked").read_text(), "keep me\n")
        self.wt("doctor")

    def test_create_seeds_independent_files_runs_setup_and_preserves_env_on_retry(
        self,
    ) -> None:
        self.migrate()
        self.configure()
        self.wt("new", "task-1", "task/1", "--base", "main", "--offline")
        task = self.root / "task-1"
        self.assertEqual((task / "setup-output").read_text(), str(task))
        self.assertEqual((task / ".env").stat().st_mode & 0o777, 0o600)
        (task / ".env").write_text("TASK_LOCAL=keep\n")
        (task / "node_modules/package").write_text("task-package\n")
        self.wt("new", "task-1", "task/1", "--offline")
        self.assertEqual((task / ".env").read_text(), "TASK_LOCAL=keep\n")
        self.assertEqual(
            (self.root / "main/node_modules/package").read_text(), "source-package\n"
        )
        self.assertEqual(self.git(task, "status", "--porcelain"), "")
        self.assertIn("setup recorded", self.wt("list").stdout)

    def test_failed_setup_keeps_checkout_and_can_be_resumed(self) -> None:
        self.migrate()
        self.configure([sys.executable, "-c", "raise SystemExit(7)"])
        self.wt("new", "task-2", "task/2", "--base", "main", "--offline", success=False)
        self.assertTrue((self.root / "task-2/.git").is_file())
        self.assertFalse((self.root / ".local/setup/task-2").exists())
        self.configure()
        self.wt("setup", "task-2")
        self.assertTrue((self.root / ".local/setup/task-2").is_file())

    def test_tracked_env_is_rejected_without_modifying_it(self) -> None:
        self.migrate()
        self.configure()
        self.wt("new", "task-3", "task/3", "--base", "main", "--offline")
        task = self.root / "task-3"
        self.git(task, "add", "--force", ".env")
        before = (task / ".env").read_bytes()
        self.wt("setup", "task-3", success=False)
        self.assertEqual((task / ".env").read_bytes(), before)
        self.assertFalse((self.root / ".local/setup/task-3").exists())
        self.wt("doctor")

    def test_existing_env_does_not_require_source_but_missing_env_does(self) -> None:
        self.migrate()
        self.configure()
        self.wt("new", "500", "mohil/500", "--base", "main", "--offline")
        task = self.root / "500"
        (task / ".env").write_text("TASK_LOCAL=keep\n")
        (self.root / "main/.env").unlink()
        self.wt("setup", "500")
        self.assertEqual((task / ".env").read_text(), "TASK_LOCAL=keep\n")
        (task / ".env").unlink()
        failure = self.wt("setup", "500", success=False)
        self.assertIn("Missing setup source file", failure.stderr)
        self.assertFalse((self.root / ".local/setup/500").exists())

    def test_branch_selection_tracks_remote_and_uses_explicit_stack_base(self) -> None:
        remote = self.base / "remote.git"
        subprocess.run(
            ["git", "clone", "--bare", str(self.source), str(remote)],
            check=True,
            capture_output=True,
        )
        self.git(self.source, "remote", "add", "origin", str(remote))
        self.git(self.source, "fetch", "origin")
        self.git(self.source, "remote", "set-head", "origin", "--auto")
        self.git(self.source, "push", "origin", "main:refs/heads/remote-task")
        self.migrate()
        self.configure()
        self.wt("new", "remote-task", "remote-task")
        self.assertEqual(
            self.git(
                self.root / "remote-task", "rev-parse", "--abbrev-ref", "@{upstream}"
            ),
            "origin/remote-task",
        )
        (self.root / "remote-task/tracked").write_text("parent change\n")
        self.git(self.root / "remote-task", "commit", "-am", "parent change")
        parent_head = self.git(self.root / "remote-task", "rev-parse", "HEAD")
        self.wt("new", "child", "task/child", "--base", "remote-task")
        self.assertEqual(
            self.git(self.root / "child", "rev-parse", "HEAD"), parent_head
        )
        self.wt("new", "duplicate", "remote-task", "--offline", success=False)


if __name__ == "__main__":
    unittest.main()
