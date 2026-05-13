---
name: assume
description: Use when running AWS commands through Granted/assume in headless environments, scripts, CI-like shells, or coding-agent harnesses where shell aliases do not persist. Applies when the user asks to assume AWS profiles, test AWS access, run read-only AWS commands, or switch between SIND AWS environments.
---

Use Granted assume in headless mode instead of relying on shell aliases or sourced environment
mutation.

Canonical command format:

```bash
  FORCE_NO_ALIAS=true assume <profile> --exec -- <command...>
```

Examples:

```bash
  FORCE_NO_ALIAS=true assume development --exec -- aws sts get-caller-identity
```

```bash
  FORCE_NO_ALIAS=true assume development --exec -- aws s3 ls
```

For commands involving shell features like pipes, redirects, variable expansion, or multiple
commands, wrap with bash -lc:

```bash
  FORCE_NO_ALIAS=true assume development --exec -- bash -lc 'aws sts get-caller-identity && aws
s3 ls'
```

Important rules:

- Do not use plain assume <profile> in headless/scripted contexts.
- Do not source . /opt/homebrew/bin/assume unless explicitly working in an interactive shell.
- Always include FORCE_NO_ALIAS=true.
- Prefer --exec -- form because it handles command arguments cleanly.
- Credentials are scoped only to the executed command and are not exported afterward.
- For loops/scripts, run FORCE_NO_ALIAS=true assume ... --exec -- ... separately per profile.

Loop example:

```bash
  for profile in sind-cicd sind-dev sind-stage sind-logs sind-ai; do
    echo "== $profile =="
    FORCE_NO_ALIAS=true assume "$profile" --exec -- aws sts get-caller-identity \
      --query '{Account:Account,Arn:Arn}' \
      --output json
  done
```

When asked to test AWS access, prefer safe/read-only commands first:

```bash
  aws sts get-caller-identity
  aws configure get region
  aws s3 ls
  aws ecs list-clusters
  aws logs describe-log-groups --limit 5
```

Never run destructive or mutating AWS commands unless the user explicitly asks and confirms the
target profile/environment.
