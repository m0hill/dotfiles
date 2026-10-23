from __future__ import annotations

from dataclasses import asdict
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import unittest
from unittest.mock import patch

import dev
import coordination
import test_worktrees
from worktrees import WorktreeError


class DevIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = test_worktrees.WorktreeIntegrationTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.migrate()
        self.fixture.configure()
        self.root = self.fixture.root
        self.fixture.wt("new", "500", "mohil/500", "--base", "main", "--offline")
        self.settings = dev.Config(
            "test-session", "test-postgres", 55440, "test_user", "test_main"
        )
        self.runtime = dev.Runtime("test-owned-workspace", {}, None)
        dev.save(self.root, self.runtime)
        (self.root / ".dev.json").write_text(json.dumps(asdict(self.settings)))

    def cli(self, identifier: str, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                sys.executable,
                str(Path(dev.__file__)),
                "-r",
                str(self.root),
                "--agent-id",
                identifier,
                "--agent-name",
                f"Agent {identifier}",
                *arguments,
            ],
            text=True,
            capture_output=True,
            check=False,
        )

    def test_busy_agent_is_identified_and_request_is_deduplicated(self) -> None:
        self.assertEqual(
            self.cli("alice", "reserve", "main", "--reason", "browser test").returncode,
            0,
        )
        for _ in range(2):
            result = self.cli("bob", "reserve", "500", "--reason", "recording test")
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIn("Agent alice [alice] on main", result.stderr)
        state = coordination.load(self.root)
        self.assertEqual([item.agent.id for item in state.waiting], ["bob"])
        before = dev.state_file(self.root).read_bytes()
        for command in (
            ("switch", "500"),
            ("down",),
            ("db-init", "500"),
            ("release", "--result", "steal"),
        ):
            result = self.cli("bob", *command)
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertIn("reserved by Agent alice", result.stderr)
        self.assertEqual(dev.state_file(self.root).read_bytes(), before)
        self.assertEqual(self.cli("bob", "cancel").returncode, 0)
        self.assertEqual(coordination.load(self.root).waiting, [])

    def test_release_preserves_running_stack_and_waiter_can_reserve(self) -> None:
        self.runtime.active = dev.Active("main", "main", "test_main")
        dev.save(self.root, self.runtime)
        before = dev.state_file(self.root).read_bytes()
        self.assertEqual(
            self.cli("alice", "reserve", "main", "--reason", "test").returncode, 0
        )
        waiter = subprocess.Popen(
            [
                sys.executable,
                str(Path(dev.__file__)),
                "-r",
                str(self.root),
                "--agent-id",
                "bob",
                "--agent-name",
                "Bob",
                "reserve",
                "500",
                "--reason",
                "next test",
                "--wait",
                "10",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            deadline = time.monotonic() + 5
            while (
                not coordination.load(self.root).waiting and time.monotonic() < deadline
            ):
                time.sleep(0.05)
            self.assertEqual(
                [item.agent.id for item in coordination.load(self.root).waiting],
                ["bob"],
            )
            self.assertEqual(
                self.cli("alice", "release", "--result", "passed").returncode, 0
            )
            _, stderr = waiter.communicate(timeout=10)
            self.assertEqual(waiter.returncode, 0, stderr)
            owner = coordination.load(self.root).reservation
            self.assertIsNotNone(owner)
            if owner is not None:
                self.assertEqual(owner.agent.id, "bob")
            self.assertEqual(dev.state_file(self.root).read_bytes(), before)
            events = [
                json.loads(line)
                for line in (self.root / ".local/events.jsonl").read_text().splitlines()
            ]
            self.assertEqual(
                [item["action"] for item in events[-4:]],
                ["reserved", "requested", "released", "reserved"],
            )
            self.assertEqual(events[-2]["agent"]["name"], "Agent alice")
        finally:
            if waiter.poll() is None:
                waiter.kill()
                waiter.communicate()

    def test_database_assignment_is_stable_and_independent_of_branch_syntax(
        self,
    ) -> None:
        self.assertEqual(dev.database_name(self.settings, "main"), "test_main")
        assigned = {
            dev.database_name(self.settings, name)
            for name in ("500", "login-fix", "login.fix")
        }
        self.assertEqual(len(assigned), 3)
        for database in assigned:
            self.assertEqual(dev.sql_name(database), database)
            self.assertLessEqual(len(database), 63)

    def test_another_worktree_cannot_take_over_an_active_stack(self) -> None:
        self.runtime.active = dev.Active("main", "main", "test_main")
        dev.save(self.root, self.runtime)
        before = dev.state_file(self.root).read_bytes()
        with patch("dev.herdr", return_value={}):
            with self.assertRaisesRegex(WorktreeError, "Stack belongs to main"):
                dev.up(self.root, self.settings, "500")
        self.assertEqual(dev.state_file(self.root).read_bytes(), before)

    def test_unmanaged_port_is_refused_without_claiming_the_stack(self) -> None:
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            port = listener.getsockname()[1]
            spec = dev.Service("test", ".", (), port)
            with (
                patch.dict(dev.SERVICES, {"django": spec}),
                patch("dev.herdr", return_value={}),
            ):
                with self.assertRaisesRegex(WorktreeError, "already in use"):
                    dev.up(self.root, self.settings, "500")
            self.assertTrue(dev.port_open(port))
            self.assertIsNone(dev.load_runtime(self.root).active)

    def test_database_configuration_survives_honcho_environment_loading(self) -> None:
        backend = self.root / "500/apps/backend"
        backend.mkdir(parents=True)
        selected = dev.database_name(self.settings, "500")
        (backend / ".env").write_text(f"APP_PG_DB={selected}\nLOCAL_SETTING=fixture\n")
        environment = dev.environment(self.root, self.root / "500", "django", selected)
        output = subprocess.check_output(
            [
                str(Path(sys.executable).parent / "honcho"),
                "run",
                sys.executable,
                "-c",
                "import os; print(os.environ['APP_PG_DB'])",
            ],
            cwd=backend,
            env=environment,
            text=True,
        )
        self.assertEqual(output.strip(), selected)
        with self.assertRaisesRegex(WorktreeError, "database is not initialized"):
            dev.environment(self.root, self.root / "500", "django", "wrong_database")

    def test_service_wrapper_stops_its_child_and_removes_ownership_record(self) -> None:
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
        self.runtime.active = dev.Active(
            "500", "mohil/500", dev.database_name(self.settings, "500")
        )
        dev.save(self.root, self.runtime)
        server = f"from http.server import HTTPServer, BaseHTTPRequestHandler; HTTPServer(('127.0.0.1', {port}), BaseHTTPRequestHandler).serve_forever()"
        code = f"import dev; dev.SERVICES['web'] = dev.Service('test', '.', ({sys.executable!r}, '-c', {server!r}), {port}); raise SystemExit(dev.main())"
        process = subprocess.Popen(
            [sys.executable, "-c", code, "-r", str(self.root), "_run", "web", "500"],
            cwd=Path(__file__).parent,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )
        try:
            deadline = time.monotonic() + 10
            while (
                not dev.port_open(port)
                and process.poll() is None
                and time.monotonic() < deadline
            ):
                time.sleep(0.1)
            self.assertTrue(dev.running(self.root, "web"))
            self.assertTrue(dev.port_open(port))
            process.send_signal(signal.SIGTERM)
            process.communicate(timeout=10)
            self.assertFalse(dev.port_open(port))
            self.assertFalse(dev.process_file(self.root, "web").exists())
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.communicate()


if __name__ == "__main__":
    unittest.main()
