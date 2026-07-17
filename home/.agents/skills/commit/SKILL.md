---
name: commit
description: Create Git commits in Mohil's message style.
disable-model-invocation: true
---

# Commit

1. Run `git status --short`.
2. If files are already staged, commit only those files.
3. Run `git diff --check --cached`, then commit.
4. Report the commit hash, subject, and remaining changes.

## Subject style

Use `<prefix>: <result>` with one prefix:

- `feat` — new behavior
- `fix` — corrected behavior
- `ref` — restructuring without behavior change
- `test` — test-only changes
- `chore` — configuration, docs, dependencies, generated files, or maintenance
