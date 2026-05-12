# AGENTS.md - Pi Extensions

Guidelines for AI assistants working on Pi extensions in this directory.

## Read the Pi docs first

Before changing an extension, read the relevant Pi documentation from the installed package:

- Main docs: `/Users/mohil/.local/share/mise/installs/node/24.12.0/lib/node_modules/@earendil-works/pi-coding-agent/README.md`
- Extension docs: `/Users/mohil/.local/share/mise/installs/node/24.12.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- TUI docs, if using custom UI/components: `/Users/mohil/.local/share/mise/installs/node/24.12.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/tui.md`
- Session docs, if reading/writing session state: `/Users/mohil/.local/share/mise/installs/node/24.12.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/session.md`
- Examples: `/Users/mohil/.local/share/mise/installs/node/24.12.0/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/`

Follow cross-references in the docs before implementing unfamiliar APIs.

## Use the quality-code skill

For TypeScript changes, read and apply:

`/Users/mohil/dotfiles/home/.agents/skills/quality-code/SKILL.md`

Important principles here:

- Import and derive types instead of manually restating library types.
- Make impossible states unrepresentable with discriminated unions.
- Validate or normalize external boundaries minimally and explicitly.
- Avoid unnecessary type assertions.
- Prefer small, clear helpers over clever abstractions.

## Browser UI style

When creating or changing a browser-based extension UI, read and follow:

`/Users/mohil/dotfiles/home/.pi/agent/extensions/UI_STYLE.md`

This style guide captures the design language used by the `feedback`, `diff`, and `phone` extensions: dark terminal-native surfaces, quiet graphite cards, mono labels, restrained motion, and polished markdown/code rendering.

## Extension style

Keep each extension easy to scan. For single-file extensions, organize `index.ts` in this order when applicable:

```ts
// Imports
// Constants
// Types
// State
// Generic helpers
// Path/file helpers
// Payload parsing / validation
// Session/message helpers
// Domain formatting / prompt construction
// HTTP helpers
// Server lifecycle
// Browser/UI helpers
// Extension entrypoint
```

The bottom of the file should contain the Pi entrypoint and read like the public behavior of the extension:

```ts
export default function myExtension(pi: ExtensionAPI): void {
  pi.on(...)
  pi.registerCommand(...)
}
```

## Type guidelines

- Import Pi types from `@earendil-works/pi-coding-agent` when available.
- Import AI message/content/model types from `@earendil-works/pi-ai` when needed.
- Do not recreate Pi/session/message types manually.
- Avoid `as` unless it is a deliberate boundary, such as a branded type after validation.
- Avoid non-null assertions (`!`) by using local variables and guards.
- Use discriminated unions for extension state, e.g. different session kinds.

Examples of preferred imports:

```ts
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  SessionEntry,
  SessionMessageEntry,
} from "@earendil-works/pi-coding-agent"
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai"
```

## Runtime/input boundaries

For HTTP handlers, browser payloads, files, and JSON:

- Do not blindly cast `JSON.parse(...) as SomeType`.
- If adding a schema library would be overkill, use small local guards like `isRecord()` and `stringValue()`.
- Return `400` for malformed request payloads when applicable.
- Keep validation minimal but enough to avoid runtime crashes.

## Pi API behavior to remember

- Extensions are loaded with Jiti and can import Pi packages at runtime.
- Auto-discovered extensions live under `~/.pi/agent/extensions/*/index.ts` or `*.ts`.
- Use `ctx.sessionManager.getBranch()` when you need the active session path.
- Use `ctx.sessionManager.getEntries()` only when you intentionally need all entries, including abandoned branches.
- `pi.sendUserMessage()` should use `{ deliverAs: "followUp" }` or `{ deliverAs: "steer" }` when it may run while the agent is busy.
- Check `ctx.hasUI` before relying on UI behavior in commands that may run outside interactive mode.

## macOS-only preference

These personal extensions are for macOS only. Avoid unnecessary Windows/Linux fallbacks unless explicitly requested.

For opening browser windows, prefer:

```ts
spawn("open", [url], { detached: true, stdio: "ignore" }).unref()
```

## Static file servers

If an extension serves a local web UI:

- Bind to `127.0.0.1`.
- Serve only the known files needed by the UI.
- Do not expose the whole extension directory.
- Keep server start/stop lifecycle explicit.
- Clean up in `session_shutdown`.

## Checks

After edits, run:

```bash
pnpm -C /Users/mohil/dotfiles/home/.pi exec oxfmt agent/extensions/<extension>/index.ts
pnpm -C /Users/mohil/dotfiles/home/.pi lint
```

Pi packages are installed globally and resolved by Pi at runtime, so normal local `tsc` may not resolve them without a temporary path-mapped config. Do not add local dependencies just to satisfy type-checking unless asked.
