import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { AuthStore } from "./auth-store.js"

const discoveryState = {
  authorizationServerUrl: "https://auth.example.com",
  authorizationServerMetadata: {
    issuer: "https://auth.example.com",
    authorization_endpoint: "https://auth.example.com/authorize",
    token_endpoint: "https://auth.example.com/token",
    response_types_supported: ["code"],
  },
  resourceMetadata: {
    resource: "https://mcp.example.com",
    authorization_servers: ["https://auth.example.com"],
  },
  resourceMetadataUrl: "https://mcp.example.com/.well-known/oauth-protected-resource",
}

test("ignores malformed auth entries while retaining entries parsed by the persistence schema", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-mcp-auth-"))
  const filepath = path.join(directory, "auth.json")
  try {
    await writeFile(
      filepath,
      JSON.stringify({
        valid: { tokens: { accessToken: "secret" }, serverUrl: "https://mcp.example.com" },
        invalid: { tokens: { accessToken: 42 } },
      })
    )

    const entries = await new AuthStore(filepath).all()
    assert.deepEqual(entries, {
      valid: { tokens: { accessToken: "secret" }, serverUrl: "https://mcp.example.com" },
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("round-trips OAuth issuer binding and discovery state", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-mcp-auth-"))
  const filepath = path.join(directory, "auth.json")

  try {
    const store = new AuthStore(filepath)
    await store.updateDiscoveryState("docs", discoveryState, "https://mcp.example.com")
    await store.updateTokens(
      "docs",
      { accessToken: "secret", issuer: "https://auth.example.com" },
      "https://mcp.example.com"
    )

    const reloaded = await new AuthStore(filepath).getForUrl("docs", "https://mcp.example.com")
    assert.deepEqual(reloaded?.discoveryState, discoveryState)
    assert.equal(reloaded?.tokens?.issuer, "https://auth.example.com")
    assert.equal((await readFile(filepath, "utf8")).includes("https://auth.example.com"), true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
