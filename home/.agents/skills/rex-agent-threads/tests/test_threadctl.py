from __future__ import annotations

import importlib.util
import os
import shutil
import tempfile
import time
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).parents[1] / "scripts/threadctl.py"
spec = importlib.util.spec_from_file_location("threadctl", SCRIPT)
assert spec is not None and spec.loader is not None
threadctl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(threadctl)


@unittest.skipUnless(shutil.which("rex"), "Requires a running local Rex server")
class RexThreadTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.cwd = Path(self.directory.name)
        self.label = "threadctl-test-" + uuid.uuid4().hex[:10]
        self.label_patch = patch.object(threadctl, "WORKSPACE_LABEL", self.label)
        self.label_patch.start()
        self.addCleanup(self.label_patch.stop)
        caller = threadctl.rex("new", self.label + "-caller", "--json")
        self.caller_id = caller["session_id"]
        self.addCleanup(threadctl.rex, "kill", self.caller_id)
        block = caller["initial_windows"][0]["block_ids"][0]
        environment = patch.dict(
            os.environ, {"REX_SESSION": self.caller_id, "REX_BLOCK": block}
        )
        environment.start()
        self.addCleanup(environment.stop)
        self.addCleanup(self.close_peers)

    def close_peers(self) -> None:
        session = threadctl.peer_workspace_id()
        if session:
            threadctl.rex("kill", session)

    def start_fixture(self) -> dict[str, object]:
        agent = self.cwd / "fixture_agent.py"
        agent.write_text(
            "import sys, time\n"
            "def status(state):\n"
            "    print('\\x1b]7501;state='+state+':app=pi\\x1b\\\\', end='', flush=True)\n"
            "status('idle')\n"
            "for line in sys.stdin:\n"
            "    print('received: '+line.strip(), flush=True)\n"
            "    if 'HOLD' in line: status('working')\n"
            "    if 'PROBE' in line:\n"
            "        status('working'); time.sleep(.2); status('done')\n"
            "    if 'FINISH' in line: status('done')\n"
            "    if 'EXIT' in line: status('done'); sys.exit(0)\n"
        )
        args = threadctl.parser().parse_args(
            ["start", "--name", "probe", "--cwd", str(self.cwd), "--task", "PROBE task"]
        )
        with patch.object(
            threadctl, "launch_command", return_value=["python3", "-u", str(agent)]
        ):
            return threadctl.command_start(args)

    def test_parallel_creation_uses_one_session_and_distinct_tabs(self) -> None:
        with ThreadPoolExecutor(max_workers=4) as executor:
            panes = list(
                executor.map(
                    lambda i: threadctl.create_peer_tab(f"peer-{i}", self.cwd), range(4)
                )
            )
        self.assertEqual(len({pane["workspace_id"] for pane in panes}), 1)
        self.assertEqual(len({pane["tab_id"] for pane in panes}), 4)
        self.assertEqual(len({pane["pane_id"] for pane in panes}), 4)

    def test_task_delivery_read_wait_busy_protection_and_close(self) -> None:
        created = self.start_fixture()
        block = created["pane_id"]
        self.assertTrue(str(block).startswith("block:"))
        read = threadctl.parser().parse_args(["read", "--peer", "probe"])
        output = threadctl.command_read(read)["transcript"]
        self.assertIn("received: PROBE task", output)
        self.assertIn(created["conversation_id"], output)
        wait = threadctl.parser().parse_args(
            ["wait", "--peer", "probe", "--status", "done", "--timeout", "3000"]
        )
        self.assertIn(threadctl.command_wait(wait)["status"], {"idle", "done"})
        message = threadctl.parser().parse_args(
            ["message", "request", "--to", "probe", "--content", "PROBE followup"]
        )
        threadctl.command_message(message)
        self.assertIn(
            "received: PROBE followup", threadctl.command_read(read)["transcript"]
        )
        threadctl.send_input(block, "HOLD")
        working = threadctl.parser().parse_args(
            ["wait", "--peer", "probe", "--status", "working", "--timeout", "3000"]
        )
        threadctl.command_wait(working)
        close = threadctl.parser().parse_args(["close", "--peer", "probe"])
        with self.assertRaisesRegex(threadctl.ThreadControlError, "only idle or done"):
            threadctl.command_close(close)
        with self.assertRaisesRegex(threadctl.ThreadControlError, "pass --queue"):
            threadctl.deliver(block, "must not arrive", queue=False)
        self.assertNotIn(
            "received: must not arrive", threadctl.command_read(read)["transcript"]
        )
        threadctl.send_input(block, "FINISH")
        threadctl.command_wait(wait)
        threadctl.command_close(close)
        self.assertEqual(threadctl.command_list(None)["peers"], [])

    def test_exited_agent_status_cannot_route_a_message_into_a_shell(self) -> None:
        created = self.start_fixture()
        block = created["pane_id"]
        threadctl.send_input(block, "EXIT")
        deadline = time.monotonic() + 5
        while threadctl.get_pane(block).get("agent") is not None:
            self.assertLess(time.monotonic(), deadline, "Fixture did not exit")
            time.sleep(0.1)
        with self.assertRaisesRegex(
            threadctl.ThreadControlError, "not running an agent"
        ):
            threadctl.deliver(block, "printf SHOULD_NOT_EXECUTE", queue=False)

    def test_close_refuses_a_pane_outside_peer_session(self) -> None:
        args = threadctl.parser().parse_args(
            ["close", "--peer", os.environ["REX_BLOCK"]]
        )
        with self.assertRaisesRegex(threadctl.ThreadControlError, "not a peer"):
            threadctl.command_close(args)


if __name__ == "__main__":
    unittest.main()
