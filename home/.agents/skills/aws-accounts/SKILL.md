---
name: aws-accounts
description: Use when running AWS commands, selecting accounts or roles, testing AWS access, or troubleshooting SSO authentication.
---

# AWS accounts

Use native AWS CLI profiles. Select the account and role per command rather than switching shell state with Granted.

1. Discover available profiles with `aws configure list-profiles`. Choose the profile matching the requested environment and permissions; ask if the target is ambiguous. Prefer read-only roles for investigation, especially `sind-prod-view` for production.
2. Include `--profile <name>` on every AWS service command. For SDKs or tools without that flag, scope `AWS_PROFILE=<name>` to the individual process. Clear inherited `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` for those processes so exported credentials cannot override the profile.
3. Before consequential operations, run the identity check below with the same profile. Compare the returned account and role with the intended target. Mutations require explicit user authorization for that operation and environment; authentication alone is not approval.

```bash
aws --profile sind-dev sts get-caller-identity
aws --profile sind-dev ecs list-clusters --no-cli-pager
```

If SSO authentication expires, stop and ask the user to sign in:

```bash
aws sso login --sso-session sind-main
```

The SIND profiles share this SSO session. After login, retry the identity check with the original profile. Keep the target fixed: do not fall back to Granted, another profile, or ambient credentials to bypass an authentication or permission failure.
