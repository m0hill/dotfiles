import { open, stat } from "node:fs/promises"
import path from "node:path"
import type { ElicitRequest, ElicitResult } from "@modelcontextprotocol/client"
import { z } from "zod"
import { McpManager } from "./manager.js"
import type { McpConfig } from "./types.js"

interface SessionBinding {
  refresh: () => void
  elicit: (server: string, request: ElicitRequest) => ElicitResult | Promise<ElicitResult>
}

/** Connections outlive a conversation, but never retain a detached session's UI or tools. */
export class SessionConnections {
  readonly manager: McpManager
  private binding: SessionBinding | undefined

  constructor(cwd: string) {
    this.manager = new McpManager({
      cwd,
      onToolsChanged: () => this.binding?.refresh(),
      onStatusChanged: () => this.binding?.refresh(),
      // Persistent transports can inherit the async context that opened them. Route UI
      // requests through the current binding instead, never through that old context.
      onElicitation: (server, request) =>
        this.binding?.elicit(server, request) ?? { action: "cancel" },
    })
  }

  attach(binding: SessionBinding): () => void {
    this.binding = binding
    return () => {
      if (this.binding === binding) this.binding = undefined
    }
  }

  async close(): Promise<void> {
    this.binding = undefined
    await this.manager.close()
  }
}

interface PreservedConnections {
  readonly connections: SessionConnections
  readonly config: McpConfig
  readonly rememberedServerNames: Set<string>
}

const SessionHeaderSchema = z.object({
  type: z.literal("session"),
  cwd: z.string().refine(path.isAbsolute),
})

/** Read only the header, not a potentially large transcript. Uncertainty means reconnect. */
export async function canReuseConnectionsForResume(
  cwd: string,
  sessionFile: string | undefined
): Promise<boolean> {
  if (!sessionFile) return false
  try {
    const file = await open(sessionFile, "r")
    try {
      const { buffer, bytesRead } = await file.read({
        buffer: Buffer.alloc(64 * 1024),
        position: 0,
      })
      const headerEnd = buffer.subarray(0, bytesRead).indexOf(10)
      if (headerEnd < 0) return false
      const header = SessionHeaderSchema.safeParse(
        JSON.parse(buffer.subarray(0, headerEnd).toString("utf8"))
      )
      if (!header.success || path.resolve(header.data.cwd) !== path.resolve(cwd)) return false
      // If the saved cwd disappeared, Pi may resume with a user-selected cwd override.
      return (await stat(cwd)).isDirectory()
    } finally {
      await file.close()
    }
  } catch {
    console.warn("[mcp] Could not verify the resumed session directory; reconnecting")
    return false
  }
}

// Pi caches extension modules across same-cwd switches but recreates their factories. This handoff is
// deliberately outside the factory, scoped to the destination session and cwd. In-memory
// CLI sessions have no filename; Pi serializes their replacement within the same cwd.
// /reload and quit close the active owner instead of placing it in this handoff.
const pendingSessionSwitches = new Map<string, PreservedConnections>()

export function preserveForSessionSwitch(
  cwd: string,
  sessionFile: string | undefined,
  preserved: PreservedConnections
): void {
  const key = JSON.stringify([cwd, sessionFile])
  if (pendingSessionSwitches.has(key)) throw new Error("MCP session handoff already has an owner")
  pendingSessionSwitches.set(key, preserved)
}

export function takePreservedConnections(
  cwd: string,
  sessionFile: string | undefined
): PreservedConnections | undefined {
  const key = JSON.stringify([cwd, sessionFile])
  const preserved = pendingSessionSwitches.get(key)
  pendingSessionSwitches.delete(key)
  return preserved
}
