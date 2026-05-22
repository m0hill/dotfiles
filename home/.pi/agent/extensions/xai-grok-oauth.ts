import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

const CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828"
const AUTHORIZE_URL = "https://auth.x.ai/oauth2/authorize"
const TOKEN_URL = "https://auth.x.ai/oauth2/token"
const DEVICE_AUTHORIZATION_URL = "https://auth.x.ai/oauth2/device/code"
const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"
const SCOPE = "openid profile email offline_access grok-cli:access api:access"
const OAUTH_HOST = "127.0.0.1"
const OAUTH_PORT = 56121
const OAUTH_REDIRECT_PATH = "/callback"
const REDIRECT_URI = `http://${OAUTH_HOST}:${OAUTH_PORT}${OAUTH_REDIRECT_PATH}`
const REFRESH_SKEW_MS = 120_000
const CORS_ALLOWED_ORIGINS = new Set(["https://accounts.x.ai", "https://auth.x.ai"])

type PkceCodes = {
  verifier: string
  challenge: string
}

type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in?: number
}

type DeviceCodeResponse = {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in?: number
  interval?: number
}

type DeviceTokenError = {
  error?: string
  error_description?: string
}

const models = [
  {
    id: "grok-code-fast-1",
    name: "Grok Code Fast 1",
    reasoning: false,
    input: ["text", "image"] as const,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 256_000,
    maxTokens: 16_384,
  },
  {
    id: "grok-4-fast-reasoning",
    name: "Grok 4 Fast Reasoning",
    reasoning: true,
    input: ["text", "image"] as const,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 2_000_000,
    maxTokens: 32_768,
    compat: { supportsReasoningEffort: true },
  },
  {
    id: "grok-4-fast-non-reasoning",
    name: "Grok 4 Fast Non-Reasoning",
    reasoning: false,
    input: ["text", "image"] as const,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 2_000_000,
    maxTokens: 32_768,
  },
  {
    id: "grok-4",
    name: "Grok 4",
    reasoning: true,
    input: ["text", "image"] as const,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 256_000,
    maxTokens: 32_768,
    compat: { supportsReasoningEffort: true },
  },
  {
    id: "grok-3",
    name: "Grok 3",
    reasoning: false,
    input: ["text", "image"] as const,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131_072,
    maxTokens: 16_384,
  },
]

export default function (pi: ExtensionAPI) {
  pi.registerProvider("xai-grok", {
    name: "xAI Grok Subscription",
    baseUrl: "https://api.x.ai/v1",
    api: "openai-completions",
    authHeader: true,
    models: models.map((model) => ({
      ...model,
      compat: {
        supportsDeveloperRole: false,
        supportsUsageInStreaming: true,
        maxTokensField: "max_tokens" as const,
        ...model.compat,
      },
    })),
    oauth: {
      name: "xAI Grok OAuth (browser)",
      login: browserLogin,
      refreshToken,
      getApiKey: (credentials) => credentials.access,
    },
  })

  pi.registerProvider("xai-grok-device", {
    name: "xAI Grok Subscription (device code)",
    baseUrl: "https://api.x.ai/v1",
    api: "openai-completions",
    authHeader: true,
    models: models.map((model) => ({
      ...model,
      compat: {
        supportsDeveloperRole: false,
        supportsUsageInStreaming: true,
        maxTokensField: "max_tokens" as const,
        ...model.compat,
      },
    })),
    oauth: {
      name: "xAI Grok OAuth (headless/device code)",
      login: deviceLogin,
      refreshToken,
      getApiKey: (credentials) => credentials.access,
    },
  })
}

async function browserLogin(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const server = await startOAuthServer()
  try {
    const pkce = await generatePKCE()
    const state = generateState()
    const callback = waitForOAuthCallback(server, pkce, state)
    callbacks.onAuth({ url: buildAuthorizeUrl(pkce, state, generateState()) })
    return toCredentials(await callback)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

async function deviceLogin(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const device = await requestDeviceCode()
  callbacks.onDeviceCode({ userCode: device.user_code, verificationUri: device.verification_uri })
  return toCredentials(await pollDeviceCodeToken(device))
}

async function refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
  if (credentials.expires && credentials.expires - Date.now() > REFRESH_SKEW_MS) return credentials
  const tokens = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: credentials.refresh,
    client_id: CLIENT_ID,
  })
  return toCredentials(tokens, credentials.refresh)
}

async function requestDeviceCode() {
  const response = await fetch(DEVICE_AUTHORIZATION_URL, {
    method: "POST",
    headers: authHeaders(),
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE }).toString(),
  })
  if (!response.ok) throw new Error(`xAI device code request failed (${response.status}): ${await response.text()}`)
  return response.json() as Promise<DeviceCodeResponse>
}

async function pollDeviceCodeToken(device: DeviceCodeResponse): Promise<TokenResponse> {
  const deadline = Date.now() + (device.expires_in ?? 300) * 1000 - 3_000
  let interval = Math.max((device.interval ?? 5) * 1000, 1_000)
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, interval))
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: authHeaders(),
      body: new URLSearchParams({
        grant_type: DEVICE_CODE_GRANT_TYPE,
        device_code: device.device_code,
        client_id: CLIENT_ID,
      }).toString(),
    })
    if (response.ok) return response.json() as Promise<TokenResponse>
    const error = (await response.json().catch(() => ({}))) as DeviceTokenError
    if (error.error === "authorization_pending") continue
    if (error.error === "slow_down") {
      interval += 5_000
      continue
    }
    throw new Error(`xAI device auth failed: ${error.error_description ?? error.error ?? response.statusText}`)
  }
  throw new Error("xAI device auth expired")
}

async function tokenRequest(params: Record<string, string>) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: authHeaders(),
    body: new URLSearchParams(params).toString(),
  })
  if (!response.ok) throw new Error(`xAI token request failed (${response.status}): ${await response.text()}`)
  return response.json() as Promise<TokenResponse>
}

async function startOAuthServer() {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(OAUTH_PORT, OAUTH_HOST, () => {
      server.off("error", reject)
      resolve()
    })
  })
  return server
}

function waitForOAuthCallback(server: ReturnType<typeof createServer>, pkce: PkceCodes, state: string) {
  return new Promise<TokenResponse>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for xAI OAuth callback")), 5 * 60 * 1000)
    server.on("request", async (req: IncomingMessage, res: ServerResponse) => {
      try {
        applyCors(req, res)
        if (req.method === "OPTIONS") {
          res.writeHead(204)
          res.end()
          return
        }

        const url = new URL(req.url ?? "/", REDIRECT_URI)
        if (url.pathname !== OAUTH_REDIRECT_PATH) return sendHtml(res, 404, "Not found")
        const error = url.searchParams.get("error")
        if (error) throw new Error(url.searchParams.get("error_description") ?? error)
        if (url.searchParams.get("state") !== state) throw new Error("Invalid xAI OAuth state")
        const code = url.searchParams.get("code")
        if (!code) throw new Error("Missing xAI OAuth code")
        const tokens = await tokenRequest({
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT_URI,
          client_id: CLIENT_ID,
          code_verifier: pkce.verifier,
        })
        clearTimeout(timeout)
        sendHtml(res, 200, "xAI login complete. You can close this window and return to pi.")
        resolve(tokens)
      } catch (error) {
        clearTimeout(timeout)
        sendHtml(res, 500, error instanceof Error ? error.message : String(error))
        reject(error)
      }
    })
  })
}

function buildAuthorizeUrl(pkce: PkceCodes, state: string, nonce: string) {
  return `${AUTHORIZE_URL}?${new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    state,
    nonce,
    plan: "generic",
    referrer: "pi",
  }).toString()}`
}

async function generatePKCE(): Promise<PkceCodes> {
  const verifier = randomString(64)
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return { verifier, challenge: base64Url(hash) }
}

function generateState() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)).buffer)
}

function randomString(length: number) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  return Array.from(crypto.getRandomValues(new Uint8Array(length)))
    .map((byte) => chars[byte % chars.length])
    .join("")
}

function base64Url(buffer: ArrayBuffer) {
  return Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function authHeaders() {
  return {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
    "User-Agent": "pi-xai-grok-oauth",
  }
}

function toCredentials(tokens: TokenResponse, fallbackRefresh?: string): OAuthCredentials {
  if (!tokens.refresh_token && !fallbackRefresh) throw new Error("xAI did not return a refresh token")
  return {
    access: tokens.access_token,
    refresh: tokens.refresh_token ?? fallbackRefresh!,
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  }
}

function applyCors(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin
  if (typeof origin !== "string" || !CORS_ALLOWED_ORIGINS.has(origin)) return
  res.setHeader("Access-Control-Allow-Origin", origin)
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  res.setHeader("Access-Control-Allow-Private-Network", "true")
  res.setHeader("Vary", "Origin")
}

function sendHtml(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" })
  res.end(`<html><body><pre>${escapeHtml(message)}</pre></body></html>`)
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!)
}
