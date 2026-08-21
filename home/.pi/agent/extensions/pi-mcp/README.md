# Local Pi MCP extension

Local, source-controlled MCP support for Pi, based on `dmmulroy/pi-mcp`.

The client uses the stable MCP TypeScript SDK v2 and negotiates the current `2026-07-28`
protocol automatically. The SDK falls back to the legacy initialization protocol for
servers implementing `2025-11-25` or earlier. Remote servers that only support the
deprecated HTTP+SSE transport remain available through the extension's explicit SDK SSE fallback.

Node.js 20 or newer is required.

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
        "command": ["npx", "-y", "@playwright/mcp"],
      },
    },
  },
}
```

Proxy mode is the default. Use `toolMode: "direct"` only when you intentionally want MCP server tools registered as first-class Pi tools.

Servers connected explicitly through `/mcp` or `mcp({ connect: "name" })` are remembered in `~/.pi/agent/mcp-connections.json` and reconnect automatically in future sessions. In lazy mode, unscoped tool search and resource discovery stay limited to these remembered servers instead of connecting every configured server. Disconnecting a server through `/mcp` removes that saved preference. This works independently of `startup`: `"eager"`, which still connects every enabled server.

## Command

`/mcp` opens an interactive server manager in the TUI. Use `↑`/`↓` to select a server; `enter` or `c` to connect; `d` to disconnect; `a` to authenticate; `l` to log out; `p` to choose a prompt; and `r` to reload. In non-interactive modes it prints server statuses.

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
