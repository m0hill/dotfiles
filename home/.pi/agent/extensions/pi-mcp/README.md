# Local Pi MCP extension

Local, source-controlled MCP support for Pi, based on `dmmulroy/pi-mcp`.

## Config

The extension reads Pi MCP config from, in order:

1. `PI_MCP_CONFIG` as a JSON string or path to a JSON/JSONC file
2. `.pi/mcp.json` or `.pi/mcp.jsonc`
3. `~/.pi/agent/mcp.json` or `~/.pi/agent/mcp.jsonc`

Minimal project config:

```jsonc
{
  "mcp": {
    "toolMode": "proxy",
    "startup": "lazy",
    "servers": {
      "playwright": {
        "type": "local",
        "command": ["npx", "-y", "@playwright/mcp"]
      }
    }
  }
}
```

Proxy mode is the default. Use `toolMode: "direct"` only when you intentionally want MCP server tools registered as first-class Pi tools.

## Commands

- `/mcp-list` shows configured servers and connection status.
- `/mcp-reload` reloads config and reconnects servers.
- `/mcp-connect <name>` connects or reconnects a configured server.
- `/mcp-disconnect <name>` disables a server for the current runtime.
- `/mcp-auth [name]` starts OAuth for a remote server.
- `/mcp-logout <name>` removes stored OAuth credentials.
- `/mcp-prompts` lists MCP prompts from connected servers.
- `/mcp-prompt <server> <prompt> [json args]` fetches an MCP prompt and sends it as a user message.

## Gateway examples

```js
mcp({})
mcp({ server: "playwright" })
mcp({ search: "screenshot" })
mcp({ describe: "playwright_take_screenshot" })
mcp({ tool: "playwright_take_screenshot", args: '{"fullPage":true}' })
mcp({ action: "resources", server: "docs" })
mcp({ action: "read-resource", server: "docs", uri: "file://..." })
```
