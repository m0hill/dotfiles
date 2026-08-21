import { existsSync } from "node:fs"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import type { OAuthDiscoveryState } from "@modelcontextprotocol/client"
import {
  JSONValueSchema,
  OAuthMetadataSchema,
  OAuthProtectedResourceMetadataSchema,
} from "@modelcontextprotocol/core"
import { z } from "zod"
import type { AuthClientInfo, AuthEntry, AuthStatus, AuthTokens } from "./types.js"

type AuthData = Record<string, AuthEntry>

const AuthTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.number().finite().optional(),
  scope: z.string().optional(),
  issuer: z.string().optional(),
})
const AuthClientInfoSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string().optional(),
  clientIdIssuedAt: z.number().finite().optional(),
  clientSecretExpiresAt: z.number().finite().optional(),
  tokenEndpointAuthMethod: z.string().optional(),
  issuer: z.string().optional(),
})
const OAuthDiscoveryStateSchema = z.object({
  authorizationServerUrl: z.string(),
  authorizationServerMetadata: OAuthMetadataSchema.optional(),
  resourceMetadata: OAuthProtectedResourceMetadataSchema.optional(),
  resourceMetadataUrl: z.string().optional(),
})
const AuthEntrySchema = z.object({
  tokens: AuthTokensSchema.optional(),
  clientInfo: AuthClientInfoSchema.optional(),
  codeVerifier: z.string().optional(),
  oauthState: z.string().optional(),
  discoveryState: OAuthDiscoveryStateSchema.optional(),
  serverUrl: z.string().optional(),
})
const PersistedAuthDataSchema = z.record(z.string(), JSONValueSchema)

/** Persists OAuth client metadata, tokens, and in-flight PKCE state for MCP servers. */
export class AuthStore {
  private filepath: string
  private queue = Promise.resolve()

  /** Creates an auth store backed by the default Pi MCP auth file or a test-supplied path. */
  constructor(filepath = path.join(homedir(), ".pi", "agent", "mcp-auth.json")) {
    this.filepath = filepath
  }

  /** Reads every valid persisted auth entry keyed by configured MCP server name. */
  all(): Promise<AuthData> {
    return this.withLock(() => this.read())
  }

  /** Reads one valid persisted auth entry, if present. */
  async get(mcpName: string): Promise<AuthEntry | undefined> {
    const data = await this.all()
    return data[mcpName]
  }

  /** Reads an auth entry only when it was saved for the same remote server URL. */
  async getForUrl(mcpName: string, serverUrl: string) {
    const entry = await this.get(mcpName)
    if (!entry?.serverUrl || entry.serverUrl !== serverUrl) return undefined
    return entry
  }

  /** Replaces the auth entry for one MCP server. */
  set(mcpName: string, entry: AuthEntry, serverUrl?: string) {
    return this.mutate((data) => ({
      ...data,
      [mcpName]: serverUrl ? { ...entry, serverUrl } : entry,
    }))
  }

  /** Removes all stored auth state for one MCP server. */
  remove(mcpName: string) {
    return this.mutate((data) => {
      const next = { ...data }
      delete next[mcpName]
      return next
    })
  }

  /** Stores OAuth tokens for one MCP server. */
  updateTokens(mcpName: string, tokens: AuthTokens, serverUrl?: string) {
    return this.updateEntry(mcpName, (entry) =>
      serverUrl ? { ...entry, tokens, serverUrl } : { ...entry, tokens }
    )
  }

  /** Stores OAuth client registration metadata for one MCP server. */
  updateClientInfo(mcpName: string, clientInfo: AuthClientInfo, serverUrl?: string) {
    return this.updateEntry(mcpName, (entry) =>
      serverUrl ? { ...entry, clientInfo, serverUrl } : { ...entry, clientInfo }
    )
  }

  /** Stores a PKCE code verifier for an in-flight OAuth flow. */
  updateCodeVerifier(mcpName: string, codeVerifier: string) {
    return this.updateEntry(mcpName, (entry) => ({ ...entry, codeVerifier }))
  }

  /** Removes the PKCE code verifier after OAuth completion or cancellation. */
  clearCodeVerifier(mcpName: string) {
    return this.clearField(mcpName, "codeVerifier")
  }

  /** Stores the OAuth state value for an in-flight OAuth flow. */
  updateOAuthState(mcpName: string, oauthState: string) {
    return this.updateEntry(mcpName, (entry) => ({ ...entry, oauthState }))
  }

  /** Reads the OAuth state value for an in-flight OAuth flow, if present. */
  async getOAuthState(mcpName: string) {
    return (await this.get(mcpName))?.oauthState
  }

  /** Removes the OAuth state value after OAuth completion or cancellation. */
  clearOAuthState(mcpName: string) {
    return this.clearField(mcpName, "oauthState")
  }

  /** Stores authorization-server discovery state across the OAuth redirect round trip. */
  updateDiscoveryState(mcpName: string, discoveryState: OAuthDiscoveryState, serverUrl?: string) {
    return this.updateEntry(mcpName, (entry) =>
      serverUrl ? { ...entry, discoveryState, serverUrl } : { ...entry, discoveryState }
    )
  }

  /** Classifies the stored token state for one MCP server. */
  async authStatus(mcpName: string): Promise<AuthStatus> {
    const entry = await this.get(mcpName)
    if (!entry?.tokens) return "not_authenticated"
    if (!entry.tokens.expiresAt) return "authenticated"
    return entry.tokens.expiresAt < Date.now() / 1000 ? "expired" : "authenticated"
  }

  private async updateEntry(mcpName: string, update: (entry: AuthEntry) => AuthEntry) {
    await this.mutate((data) => ({ ...data, [mcpName]: update(data[mcpName] ?? {}) }))
  }

  private async clearField(mcpName: string, field: keyof AuthEntry) {
    await this.mutate((data) => {
      const entry = data[mcpName]
      if (!entry) return data
      return { ...data, [mcpName]: clearAuthEntryField(entry, field) }
    })
  }

  private mutate(update: (data: AuthData) => AuthData) {
    return this.withLock(async () => {
      await this.write(update(await this.read()))
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

  private async read(): Promise<AuthData> {
    try {
      if (!existsSync(this.filepath)) return {}
      const decoded = PersistedAuthDataSchema.safeParse(
        JSON.parse(await readFile(this.filepath, "utf8"))
      )
      const result = decoded.success ? parseAuthData(decoded.data) : { data: {}, rejected: 1 }
      if (result.rejected > 0) {
        warnAuthStore(
          `ignored ${result.rejected} malformed persisted auth ${result.rejected === 1 ? "entry" : "entries"}`
        )
      }
      return result.data
    } catch (error) {
      const summary = error instanceof Error ? `${error.name}: ${error.message}` : "non-Error value"
      warnAuthStore(`ignored unreadable persisted auth store: ${summary}`)
      return {}
    }
  }

  private async write(data: AuthData) {
    await mkdir(path.dirname(this.filepath), { recursive: true })
    const tmp = `${this.filepath}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
    await rename(tmp, this.filepath)
  }
}

function parseAuthData(value: z.infer<typeof PersistedAuthDataSchema>) {
  const data: AuthData = {}
  let rejected = 0
  for (const [name, entry] of Object.entries(value)) {
    const parsed = AuthEntrySchema.safeParse(entry)
    if (parsed.success) data[name] = parsed.data
    else rejected++
  }
  return { data, rejected }
}

function clearAuthEntryField(entry: AuthEntry, field: keyof AuthEntry): AuthEntry {
  switch (field) {
    case "tokens": {
      const { tokens: _tokens, ...next } = entry
      return next
    }
    case "clientInfo": {
      const { clientInfo: _clientInfo, ...next } = entry
      return next
    }
    case "codeVerifier": {
      const { codeVerifier: _codeVerifier, ...next } = entry
      return next
    }
    case "oauthState": {
      const { oauthState: _oauthState, ...next } = entry
      return next
    }
    case "discoveryState": {
      const { discoveryState: _discoveryState, ...next } = entry
      return next
    }
    case "serverUrl": {
      const { serverUrl: _serverUrl, ...next } = entry
      return next
    }
  }
}

function warnAuthStore(message: string) {
  console.warn(`[mcp-auth] ${message}`)
}
