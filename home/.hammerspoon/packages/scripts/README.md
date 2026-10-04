# Run Script

Run local scripts from **Automations → Run Script**. **Paper** is the first entry and runs `~/projects/paper/paper.sh`; Paper must already be running.

Each script has its own submenu with **Run**, its last result, **Reveal in Finder**, and **Remove from Menu…**. Removal only removes the menu entry, not the script file. Use **Add Script…** to choose another file and give it a name.

Only one script runs at a time. The running script offers **Cancel Run**. Completion and failure notifications include the script's output.

`.sh` files run with `/bin/bash`. Other scripts must be executable and have an appropriate shebang. Tasks have the mise shims and Homebrew binaries on their `PATH`; scripts should resolve their own working directory rather than assuming the current one.

The script list is stored in `packages/scripts/scripts.json` under `settings.scripts`:

```json
{
  "enabled": true,
  "settings": {
    "scripts": [
      { "name": "Paper", "path": "~/projects/paper/paper.sh" },
      { "name": "Another Script", "path": "~/bin/another-script.sh" }
    ]
  },
  "secrets": {}
}
```

An empty list stays empty; it does not automatically restore Paper.
