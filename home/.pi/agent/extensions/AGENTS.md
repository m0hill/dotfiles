# Pi Extensions

These are personal macOS extensions. Do not add Windows or Linux compatibility unless explicitly requested.

## Local servers

For extensions that serve local HTTP endpoints:

- Bind to `127.0.0.1`.
- Serve only explicitly known files; never expose an extension directory wholesale.
- Keep startup and shutdown ownership explicit.
- Clean up servers and other resources during `session_shutdown`.

## Verification

From the repository root, format changed extension files and run the checks with:

```bash
pnpm -C home/.pi exec oxfmt agent/extensions/<extension>/<file>
pnpm -C home/.pi check
```
