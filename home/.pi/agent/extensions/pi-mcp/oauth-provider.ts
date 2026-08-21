import type {
  OAuthClientInformationContext,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from "@modelcontextprotocol/client"
import type { AuthClientInfo, AuthTokens, OAuthConfig } from "./types.js"
import { AuthStore } from "./auth-store.js"
import { randomHex } from "./random.js"

type OAuthClientInformationWithAuthMethod = StoredOAuthClientInformation & {
  token_endpoint_auth_method?: string
}

interface OAuthCallbackTarget {
  readonly port: number
  readonly path: string
}

/** Default local port used by the OAuth browser callback listener. */
export const OAUTH_CALLBACK_PORT = 19876
/** Default local path used by the OAuth browser callback listener. */
export const OAUTH_CALLBACK_PATH = "/mcp/oauth/callback"

/** Callback hooks used by the MCP SDK OAuth provider integration. */
export interface OAuthCallbacks {
  onRedirect: (url: URL) => void | Promise<void>
}

/** Implements the MCP SDK OAuth persistence and redirect contract using Pi's auth store. */
export class McpOAuthProvider implements OAuthClientProvider {
  /** Creates an OAuth provider for one remote MCP server and its persisted auth state. */
  constructor(
    private mcpName: string,
    private serverUrl: string,
    private config: OAuthConfig | undefined,
    private callbacks: OAuthCallbacks,
    private auth: AuthStore
  ) {}

  /** Redirect URI registered with the OAuth authorization server. */
  get redirectUrl(): string {
    if (this.config?.redirectUri) return this.config.redirectUri
    const port = this.config?.callbackPort ?? OAUTH_CALLBACK_PORT
    return `http://127.0.0.1:${port}${OAUTH_CALLBACK_PATH}`
  }

  /** OAuth client metadata advertised during dynamic client registration. */
  get clientMetadata(): OAuthClientMetadata {
    const metadata: OAuthClientMetadata = {
      redirect_uris: [this.redirectUrl],
      client_name: this.config?.clientName ?? "Pi MCP",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: this.config?.clientSecret ? "client_secret_post" : "none",
    }
    if (this.config?.clientUri) metadata.client_uri = this.config.clientUri
    if (this.config?.scope) metadata.scope = this.config.scope
    return metadata
  }

  /** Returns saved static or dynamically registered OAuth client information. */
  async clientInformation(
    ctx?: OAuthClientInformationContext
  ): Promise<StoredOAuthClientInformation | undefined> {
    if (this.config?.clientId) {
      const info: StoredOAuthClientInformation = { client_id: this.config.clientId }
      if (ctx) info.issuer = ctx.issuer
      if (this.config.clientSecret !== undefined) info.client_secret = this.config.clientSecret
      return info
    }

    const entry = await this.auth.getForUrl(this.mcpName, this.serverUrl)
    if (!entry?.clientInfo) return undefined
    if (
      entry.clientInfo.clientSecretExpiresAt &&
      entry.clientInfo.clientSecretExpiresAt < Date.now() / 1000
    ) {
      return undefined
    }

    const info: OAuthClientInformationWithAuthMethod = {
      client_id: entry.clientInfo.clientId,
    }
    if (entry.clientInfo.issuer) info.issuer = entry.clientInfo.issuer
    if (entry.clientInfo.clientSecret !== undefined)
      info.client_secret = entry.clientInfo.clientSecret
    if (entry.clientInfo.tokenEndpointAuthMethod !== undefined)
      info.token_endpoint_auth_method = entry.clientInfo.tokenEndpointAuthMethod
    return info
  }

  /** Persists dynamically registered OAuth client information. */
  async saveClientInformation(info: StoredOAuthClientInformation): Promise<void> {
    let clientInfo: AuthClientInfo = { clientId: info.client_id }
    if (nonEmptyString(info.client_secret)) {
      clientInfo = { ...clientInfo, clientSecret: info.client_secret }
    }
    if (info.client_id_issued_at !== undefined) {
      clientInfo = { ...clientInfo, clientIdIssuedAt: info.client_id_issued_at }
    }
    if (info.client_secret_expires_at !== undefined) {
      clientInfo = { ...clientInfo, clientSecretExpiresAt: info.client_secret_expires_at }
    }
    if (nonEmptyString(info.issuer)) clientInfo = { ...clientInfo, issuer: info.issuer }
    await this.auth.updateClientInfo(this.mcpName, clientInfo, this.serverUrl)
  }

  /** Returns saved OAuth tokens in the shape expected by the MCP SDK. */
  async tokens(): Promise<StoredOAuthTokens | undefined> {
    const entry = await this.auth.getForUrl(this.mcpName, this.serverUrl)
    if (!entry?.tokens) return undefined

    const tokens: StoredOAuthTokens = {
      access_token: entry.tokens.accessToken,
      token_type: "Bearer",
    }
    if (entry.tokens.refreshToken !== undefined) tokens.refresh_token = entry.tokens.refreshToken
    if (entry.tokens.expiresAt !== undefined)
      tokens.expires_in = Math.max(0, Math.floor(entry.tokens.expiresAt - Date.now() / 1000))
    if (entry.tokens.scope !== undefined) tokens.scope = entry.tokens.scope
    if (entry.tokens.issuer !== undefined) tokens.issuer = entry.tokens.issuer
    return tokens
  }

  /** Persists OAuth tokens returned by the MCP SDK after grant or refresh flows. */
  async saveTokens(tokens: StoredOAuthTokens): Promise<void> {
    let authTokens: AuthTokens = { accessToken: tokens.access_token }
    if (nonEmptyString(tokens.refresh_token)) {
      authTokens = { ...authTokens, refreshToken: tokens.refresh_token }
    }
    if (tokens.expires_in !== undefined) {
      authTokens = { ...authTokens, expiresAt: Date.now() / 1000 + tokens.expires_in }
    }
    if (nonEmptyString(tokens.scope)) authTokens = { ...authTokens, scope: tokens.scope }
    if (nonEmptyString(tokens.issuer)) authTokens = { ...authTokens, issuer: tokens.issuer }
    await this.auth.updateTokens(this.mcpName, authTokens, this.serverUrl)
  }

  /** Captures or opens the authorization URL supplied by the MCP SDK. */
  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await this.callbacks.onRedirect(authorizationUrl)
  }

  /** Persists the PKCE code verifier supplied by the MCP SDK. */
  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.auth.updateCodeVerifier(this.mcpName, codeVerifier)
  }

  /** Returns the PKCE code verifier for the current OAuth flow. */
  async codeVerifier(): Promise<string> {
    const entry = await this.auth.get(this.mcpName)
    if (!entry?.codeVerifier)
      throw new Error(`No code verifier saved for MCP server: ${this.mcpName}`)
    return entry.codeVerifier
  }

  /** Persists the OAuth state supplied by the MCP SDK. */
  async saveState(state: string): Promise<void> {
    await this.auth.updateOAuthState(this.mcpName, state)
  }

  /** Persists authorization-server discovery across the browser redirect. */
  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    await this.auth.updateDiscoveryState(this.mcpName, state, this.serverUrl)
  }

  /** Returns authorization-server discovery saved for this MCP endpoint. */
  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return (await this.auth.getForUrl(this.mcpName, this.serverUrl))?.discoveryState
  }

  /** Returns an existing OAuth state or creates one for the current OAuth flow. */
  async state(): Promise<string> {
    const entry = await this.auth.get(this.mcpName)
    if (entry?.oauthState) return entry.oauthState
    const state = randomHex()
    await this.auth.updateOAuthState(this.mcpName, state)
    return state
  }

  /** Removes persisted client or token credentials after the SDK invalidates them. */
  async invalidateCredentials(
    type: "all" | "client" | "tokens" | "verifier" | "discovery"
  ): Promise<void> {
    const entry = await this.auth.get(this.mcpName)
    if (!entry) return

    if (type === "all") {
      await this.auth.remove(this.mcpName)
      return
    }

    const { clientInfo: _clientInfo, ...withoutClient } = entry
    const { tokens: _tokens, ...withoutTokens } = entry
    const { codeVerifier: _codeVerifier, ...withoutVerifier } = entry
    const { discoveryState: _discoveryState, ...withoutDiscovery } = entry
    const next =
      type === "client"
        ? withoutClient
        : type === "tokens"
          ? withoutTokens
          : type === "verifier"
            ? withoutVerifier
            : withoutDiscovery
    await this.auth.set(this.mcpName, next, this.serverUrl)
  }
}

function nonEmptyString(value: string | undefined): value is string {
  return value !== undefined && value.length > 0
}

/** Parses a configured redirect URI into the callback listener port and path. */
export function parseRedirectUri(redirectUri?: string): OAuthCallbackTarget {
  if (!redirectUri) return { port: OAUTH_CALLBACK_PORT, path: OAUTH_CALLBACK_PATH }

  try {
    const url = new URL(redirectUri)
    return {
      port: url.port ? Number.parseInt(url.port, 10) : url.protocol === "https:" ? 443 : 80,
      path: url.pathname || OAUTH_CALLBACK_PATH,
    }
  } catch {
    return { port: OAUTH_CALLBACK_PORT, path: OAUTH_CALLBACK_PATH }
  }
}
