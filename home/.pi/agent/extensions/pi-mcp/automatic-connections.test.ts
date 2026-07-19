import assert from "node:assert/strict"
import test from "node:test"
import { automaticConnectionServerNames } from "./automatic-connections.ts"
import type { McpConfig } from "./types.ts"

const servers: McpConfig["servers"] = {
  paper: { type: "remote", url: "http://127.0.0.1:29979/mcp" },
  figma: { type: "remote", url: "https://mcp.figma.com/mcp" },
  notion: { type: "remote", url: "https://mcp.notion.com/mcp" },
  cloudflare: { type: "remote", url: "https://mcp.cloudflare.com/mcp" },
}

test("lazy automatic discovery connects only remembered servers", () => {
  const config: McpConfig = { startup: "lazy", servers }

  assert.deepEqual(automaticConnectionServerNames(config, new Set(["paper"])), ["paper"])
})

test("eager startup connects every configured server", () => {
  const config: McpConfig = { startup: "eager", servers }

  assert.deepEqual(automaticConnectionServerNames(config, new Set(["paper"])), [
    "paper",
    "figma",
    "notion",
    "cloudflare",
  ])
})
