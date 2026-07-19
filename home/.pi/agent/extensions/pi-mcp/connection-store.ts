import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import type { McpConfig, McpServerConfig } from "./types.js"

interface ConnectionData {
  readonly version: 1
  readonly connected: readonly string[]
}

const EMPTY_CONNECTION_DATA: ConnectionData = { version: 1, connected: [] }

/** Persists the configured MCP server identities that the user explicitly connected. */
export class ConnectionStore {
  private readonly filepath: string
  private queue = Promise.resolve()

  /** Creates a connection store backed by the default Pi MCP state file or a test-supplied path. */
  constructor(filepath = path.join(homedir(), ".pi", "agent", "mcp-connections.json")) {
    this.filepath = filepath
  }

  /** Returns configured server names whose explicit connection preference was previously saved. */
  connectedServerNames(config: McpConfig): Promise<string[]> {
    return this.withLock(async () => {
      const connected = new Set((await this.read()).connected)
      return Object.entries(config.servers)
        .filter(([name, server]) => connected.has(serverIdentity(config, name, server)))
        .map(([name]) => name)
    })
  }

  /** Remembers that the user explicitly connected one configured server. */
  remember(config: McpConfig, name: string): Promise<void> {
    return this.mutate(config, name, (connected, identity) => connected.add(identity))
  }

  /** Forgets the saved connection preference for one configured server. */
  forget(config: McpConfig, name: string): Promise<void> {
    return this.mutate(config, name, (connected, identity) => connected.delete(identity))
  }

  private mutate(
    config: McpConfig,
    name: string,
    update: (connected: Set<string>, identity: string) => unknown
  ): Promise<void> {
    const server = config.servers[name]
    if (!server) return Promise.resolve()

    return this.withLock(async () => {
      const data = await this.read()
      const connected = new Set(data.connected)
      update(connected, serverIdentity(config, name, server))
      await this.write({ version: 1, connected: [...connected].sort() })
    })
  }

  private withLock<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation)
    this.queue = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  private async read(): Promise<ConnectionData> {
    try {
      if (!existsSync(this.filepath)) return EMPTY_CONNECTION_DATA
      return parseConnectionData(JSON.parse(await readFile(this.filepath, "utf8")))
    } catch (error) {
      console.warn(
        `[mcp-connections] ignored unreadable connection store: ${safeStoreError(error)}`
      )
      return EMPTY_CONNECTION_DATA
    }
  }

  private async write(data: ConnectionData): Promise<void> {
    await mkdir(path.dirname(this.filepath), { recursive: true })
    const temporaryFile = `${this.filepath}.${process.pid}.tmp`
    await writeFile(temporaryFile, JSON.stringify(data, null, 2), { mode: 0o600 })
    await rename(temporaryFile, this.filepath)
  }
}

function serverIdentity(config: McpConfig, name: string, server: McpServerConfig) {
  const scope = config.source ?? "unsourced"
  const target =
    server.type === "remote"
      ? { type: server.type, url: server.url }
      : { type: server.type, command: server.command, cwd: server.cwd ?? "" }
  return createHash("sha256").update(JSON.stringify({ scope, name, target })).digest("hex")
}

function parseConnectionData(value: unknown): ConnectionData {
  if (!isPlainRecord(value) || value.version !== 1 || !Array.isArray(value.connected)) {
    throw new Error("invalid connection store format")
  }
  if (!value.connected.every((identity) => typeof identity === "string")) {
    throw new Error("invalid connected server identity")
  }
  return { version: 1, connected: [...new Set(value.connected)] }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function safeStoreError(error: unknown) {
  return error instanceof Error ? `${error.name}: ${error.message}` : `thrown ${typeof error}`
}
