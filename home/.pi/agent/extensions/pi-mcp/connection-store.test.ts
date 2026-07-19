import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { ConnectionStore } from "./connection-store.ts"
import type { McpConfig } from "./types.ts"

function remoteConfig(source: string, url = "https://example.com/mcp"): McpConfig {
  return {
    source,
    servers: {
      docs: { type: "remote", url },
      other: { type: "remote", url: "https://other.example.com/mcp" },
    },
  }
}

test("remembers explicitly connected servers across store instances", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-mcp-connections-"))
  const filepath = path.join(directory, "connections.json")
  const config = remoteConfig("/project/.pi/mcp.json")

  try {
    await new ConnectionStore(filepath).remember(config, "docs")

    assert.deepEqual(await new ConnectionStore(filepath).connectedServerNames(config), ["docs"])
    assert.equal((await readFile(filepath, "utf8")).includes("https://example.com/mcp"), false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("does not reuse a preference for a different config source or server target", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-mcp-connections-"))
  const filepath = path.join(directory, "connections.json")
  const store = new ConnectionStore(filepath)

  try {
    await store.remember(remoteConfig("/first/.pi/mcp.json"), "docs")

    assert.deepEqual(await store.connectedServerNames(remoteConfig("/second/.pi/mcp.json")), [])
    assert.deepEqual(
      await store.connectedServerNames(
        remoteConfig("/first/.pi/mcp.json", "https://replacement.example.com/mcp")
      ),
      []
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("forgets a saved explicit connection preference", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-mcp-connections-"))
  const filepath = path.join(directory, "connections.json")
  const store = new ConnectionStore(filepath)
  const config = remoteConfig("/project/.pi/mcp.json")

  try {
    await store.remember(config, "docs")
    await store.forget(config, "docs")

    assert.deepEqual(await new ConnectionStore(filepath).connectedServerNames(config), [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
