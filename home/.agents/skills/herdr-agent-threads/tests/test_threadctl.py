from __future__ import annotations

import importlib.util
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import ModuleType
from typing import Callable, cast


SCRIPT = Path(__file__).parents[1] / "scripts" / "threadctl.py"


def load_threadctl() -> ModuleType:
    spec = importlib.util.spec_from_file_location("threadctl_under_test", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class WorkspaceCreationTests(unittest.TestCase):
    def test_parallel_starts_create_one_workspace(self) -> None:
        threadctl = load_threadctl()
        state_lock = threading.Lock()
        workspaces: list[dict[str, object]] = []
        pane_count = 0

        def fake_herdr(*args: str) -> dict[str, object]:
            nonlocal pane_count
            command = args[:2]
            if command == ("workspace", "list"):
                with state_lock:
                    return {"workspaces": [workspace.copy() for workspace in workspaces]}
            if command == ("workspace", "create"):
                # Widen the check/create race so this test fails without locking.
                time.sleep(0.05)
                with state_lock:
                    workspace_id = f"w{len(workspaces) + 1}"
                    workspaces.append(
                        {"workspace_id": workspace_id, "label": threadctl.WORKSPACE_LABEL}
                    )
                    pane_count += 1
                    pane_id = f"{workspace_id}:p{pane_count}"
                return {
                    "tab": {"tab_id": f"{workspace_id}:t1"},
                    "root_pane": {"pane_id": pane_id},
                }
            if command == ("tab", "create"):
                workspace_id = args[args.index("--workspace") + 1]
                with state_lock:
                    pane_count += 1
                    pane_id = f"{workspace_id}:p{pane_count}"
                return {"root_pane": {"pane_id": pane_id}}
            if command == ("tab", "rename"):
                return {}
            raise AssertionError(f"Unexpected Herdr call: {args}")

        threadctl.herdr = fake_herdr
        create_peer_tab = cast(
            Callable[[str, Path], dict[str, object]], threadctl.create_peer_tab
        )
        with ThreadPoolExecutor(max_workers=8) as executor:
            panes = list(
                executor.map(
                    lambda index: create_peer_tab(f"peer-{index}", Path.cwd()),
                    range(8),
                )
            )

        self.assertEqual(1, len(workspaces))
        self.assertEqual(8, len(panes))
        self.assertEqual(8, len({pane["pane_id"] for pane in panes}))


if __name__ == "__main__":
    unittest.main()
