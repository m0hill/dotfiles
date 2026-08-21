import assert from "node:assert/strict"
import test from "node:test"
import { loadMcpConfig } from "./config.js"

test("parses nested local and remote server configuration into canonical types", async () => {
  const previousConfig = process.env.PI_MCP_CONFIG
  const previousToken = process.env.PI_MCP_TEST_TOKEN
  process.env.PI_MCP_TEST_TOKEN = "expanded-token"
  process.env.PI_MCP_CONFIG = JSON.stringify({
    mcp: {
      timeout: 2500,
      toolMode: "direct",
      startup: "lazy",
      servers: {
        local: {
          type: "local",
          command: ["runner", "${PI_MCP_TEST_TOKEN}"],
          environment: { TOKEN: "${PI_MCP_TEST_TOKEN}" },
        },
        remote: {
          type: "remote",
          url: "https://mcp.example.com/mcp",
          oauth: { client_id: "client", callback_port: 19876 },
        },
      },
    },
  })

  try {
    const config = await loadMcpConfig({ cwd: "/unused" })
    assert.deepEqual(config, {
      source: "PI_MCP_CONFIG",
      timeout: 2500,
      toolMode: "direct",
      startup: "lazy",
      servers: {
        local: {
          type: "local",
          command: ["runner", "expanded-token"],
          environment: { TOKEN: "expanded-token" },
          timeout: 2500,
        },
        remote: {
          type: "remote",
          url: "https://mcp.example.com/mcp",
          oauth: { clientId: "client", callbackPort: 19876 },
          timeout: 2500,
        },
      },
    })
  } finally {
    if (previousConfig === undefined) delete process.env.PI_MCP_CONFIG
    else process.env.PI_MCP_CONFIG = previousConfig
    if (previousToken === undefined) delete process.env.PI_MCP_TEST_TOKEN
    else process.env.PI_MCP_TEST_TOKEN = previousToken
  }
})
