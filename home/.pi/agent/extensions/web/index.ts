import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type, type Static } from "typebox"

const EXA_MCP_URL = "https://mcp.exa.ai/mcp"
const DEFAULT_MAX_TOKENS = 5000
const MAX_TEXT_CHARS = 50_000
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const MAX_REDIRECTS = 5

type HttpUrl = string & { readonly __brand: "HttpUrl" }
type SearchMode = "code-context" | "web-search-fallback"

const recencyFilterSchema = Type.Union([
  Type.Literal("day"),
  Type.Literal("week"),
  Type.Literal("month"),
  Type.Literal("year"),
])

const webSearchSchema = Type.Object({
  query: Type.String({ description: "Search query" }),
  numResults: Type.Optional(Type.Number({ description: "Number of results, default 5, max 20" })),
  domainFilter: Type.Optional(
    Type.Array(Type.String(), { description: "Domains to include; prefix with - to exclude" })
  ),
  recencyFilter: Type.Optional(recencyFilterSchema),
  includeContent: Type.Optional(Type.Boolean({ description: "Ask Exa to include more page text" })),
})

const codeSearchSchema = Type.Object({
  query: Type.String({ description: "Programming question, API, library, or debugging topic" }),
  maxTokens: Type.Optional(Type.Number({ description: "Approximate max tokens, default 5000" })),
})

const fetchUrlSchema = Type.Object({
  url: Type.String({ description: "HTTP/HTTPS URL to fetch" }),
})

type WebSearchParams = Static<typeof webSearchSchema>
type CodeSearchParams = Static<typeof codeSearchSchema>
type FetchUrlParams = Static<typeof fetchUrlSchema>

interface ExaMcpRpcResponse {
  result?: {
    content?: Array<{ type?: string; text?: string }>
    isError?: boolean
  }
  error?: {
    code?: number
    message?: string
  }
}

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

async function readResponseText(
  response: Response,
  maxBytes = MAX_RESPONSE_BYTES
): Promise<string> {
  const contentLength = response.headers.get("content-length")
  if (contentLength) {
    const declaredBytes = Number.parseInt(contentLength, 10)
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error(`Response too large (exceeds ${maxBytes} bytes)`)
    }
  }

  if (!response.body) return ""

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new Error(`Response too large (exceeds ${maxBytes} bytes)`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

async function callExaMcp(
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<string> {
  const response = await fetch(EXA_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
    signal: withTimeout(signal, 60_000),
  })

  const body = await readResponseText(response)
  if (!response.ok) {
    throw new Error(`Exa MCP error ${response.status}: ${body.slice(0, 500)}`)
  }
  const parsed = parseMcpResponse(body)

  if (parsed.error) {
    const code = typeof parsed.error.code === "number" ? ` ${parsed.error.code}` : ""
    throw new Error(`Exa MCP error${code}: ${parsed.error.message || "Unknown error"}`)
  }

  if (parsed.result?.isError) {
    const message = parsed.result.content?.find((item) => item.type === "text")?.text?.trim()
    throw new Error(message || "Exa MCP returned an error")
  }

  const text = parsed.result?.content?.find(
    (item) => item.type === "text" && typeof item.text === "string" && item.text.trim().length > 0
  )?.text

  if (!text) throw new Error("Exa MCP returned empty content")
  return text
}

function parseMcpResponse(body: string): ExaMcpRpcResponse {
  const dataLines = body.split("\n").filter((line) => line.startsWith("data:"))
  for (const line of dataLines) {
    const payload = line.slice(5).trim()
    if (!payload) continue
    try {
      const candidate = JSON.parse(payload) as ExaMcpRpcResponse
      if (candidate.result || candidate.error) return candidate
    } catch {}
  }

  try {
    const candidate = JSON.parse(body) as ExaMcpRpcResponse
    if (candidate.result || candidate.error) return candidate
  } catch {}

  throw new Error("Exa MCP returned an unrecognized response")
}

function buildSearchQuery({
  query,
  domainFilter,
  recencyFilter,
}: Pick<WebSearchParams, "query" | "domainFilter" | "recencyFilter">): string {
  const parts = [query]
  for (const domain of domainFilter ?? []) {
    const trimmed = domain.trim()
    if (!trimmed) continue
    parts.push(trimmed.startsWith("-") ? `-site:${trimmed.slice(1)}` : `site:${trimmed}`)
  }

  if (recencyFilter) {
    const now = new Date()
    if (recencyFilter === "day") parts.push("past 24 hours")
    if (recencyFilter === "week") parts.push("past week")
    if (recencyFilter === "month") {
      parts.push(`${now.toLocaleString("en", { month: "long" })} ${now.getFullYear()}`)
    }
    if (recencyFilter === "year") parts.push(String(now.getFullYear()))
  }

  return parts.join(" ")
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function trimChars(text: string, maxChars = MAX_TEXT_CHARS): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars).trimEnd()}\n\n[Truncated to ${maxChars} characters.]`
}

function trimApproxTokens(text: string, maxTokens: number): string {
  return trimChars(text, Math.max(1000, maxTokens * 4))
}

function buildCodeFallbackQuery(query: string): string {
  const normalized = query.toLowerCase()
  const hasCodeTerms =
    /\b(api|code|docs?|documentation|example|github|implementation|library|source|stackoverflow|stack overflow)\b/.test(
      normalized
    )
  return hasCodeTerms
    ? query
    : `${query} code examples documentation GitHub Stack Overflow official docs`
}

function maxTokensToResultCount(maxTokens: number): number {
  return Math.min(20, Math.max(5, Math.ceil(maxTokens / 1000)))
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/")
}

function toToolResult(text: string, details?: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text }], details }
}

function parseHttpUrl(input: string): HttpUrl {
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    throw new Error("Invalid URL")
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http:// and https:// URLs are supported")
  }
  if (parsed.username || parsed.password) {
    throw new Error("URL credentials are not supported")
  }
  return parsed.toString() as HttpUrl
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.replace(/^\[/, "").replace(/\]$/, "")
}

function parseIpv6Hex16(segment: string | undefined): number | undefined {
  if (!segment || !/^[0-9a-f]{1,4}$/i.test(segment)) return undefined
  const value = Number.parseInt(segment, 16)
  return Number.isFinite(value) ? value : undefined
}

function parseEmbeddedIpv4(ip: string): string | undefined {
  const prefix = ip.startsWith("::ffff:") ? "::ffff:" : ip.startsWith("::") ? "::" : undefined
  if (!prefix) return undefined

  const suffix = ip.slice(prefix.length)
  if (isIP(suffix) === 4) return suffix

  const segments = suffix.split(":")
  if (segments.length !== 2) return undefined
  const high = parseIpv6Hex16(segments[0])
  const low = parseIpv6Hex16(segments[1])
  if (high === undefined || low === undefined) return undefined
  return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`
}

function isPrivateOrLocalIp(input: string): boolean {
  const ip = stripIpv6Brackets(input).toLowerCase()
  const embeddedIpv4 = parseEmbeddedIpv4(ip)
  if (embeddedIpv4) return isPrivateOrLocalIp(embeddedIpv4)

  const version = isIP(ip)
  if (version === 4) {
    const [first = -1, second = -1] = ip.split(".").map(Number)
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    )
  }
  if (version === 6) {
    return ip === "::" || ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || /^fe[89ab]/.test(ip)
  }
  return false
}

async function assertPublicUrl(url: URL): Promise<void> {
  const hostname = stripIpv6Brackets(url.hostname).toLowerCase()
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Blocked private or local host")
  }
  if (isPrivateOrLocalIp(hostname)) {
    throw new Error("Blocked private or local IP address")
  }
  if (isIP(hostname)) return

  let addresses: Array<{ address: string }>
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true })
  } catch (cause) {
    throw new Error(`Could not resolve host: ${hostname}`, { cause })
  }
  if (addresses.some(({ address }) => isPrivateOrLocalIp(address))) {
    throw new Error("Blocked private or local IP address")
  }
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

async function fetchPublicUrl(
  initialUrl: HttpUrl,
  signal?: AbortSignal
): Promise<{ response: Response; finalUrl: HttpUrl }> {
  let currentUrl = initialUrl
  const operationSignal = withTimeout(signal, 30_000)

  for (let redirects = 0; ; redirects += 1) {
    const parsed = new URL(currentUrl)
    await assertPublicUrl(parsed)

    const response = await fetch(currentUrl, {
      redirect: "manual",
      headers: { "User-Agent": "pi-web-extension/1.0" },
      signal: operationSignal,
    })
    if (!isRedirectStatus(response.status)) {
      return { response, finalUrl: currentUrl }
    }

    await response.body?.cancel().catch(() => undefined)
    const location = response.headers.get("location")
    if (!location) throw new Error("Redirect response was missing a Location header")
    if (redirects >= MAX_REDIRECTS) throw new Error(`Too many redirects (maximum ${MAX_REDIRECTS})`)
    currentUrl = parseHttpUrl(new URL(location, currentUrl).toString())
  }
}

function htmlToText(html: string): { title?: string; text: string } {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const text = decodeHtmlEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<\/(p|div|section|article|header|footer|main|li|h[1-6]|br|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  )
  return {
    title: title ? decodeHtmlEntities(title.replace(/<[^>]+>/g, "").trim()) : undefined,
    text,
  }
}

async function fetchUrl(url: HttpUrl, signal?: AbortSignal): Promise<string> {
  const { response, finalUrl } = await fetchPublicUrl(url, signal)
  const contentType = response.headers.get("content-type") ?? "unknown"
  const body = await readResponseText(response)

  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status} ${response.statusText}: ${body.slice(0, 500)}`)
  }

  const header = [
    `URL: ${finalUrl}`,
    `Status: ${response.status}`,
    `Content-Type: ${contentType}`,
  ]

  if (contentType.toLowerCase().includes("html")) {
    const { title, text } = htmlToText(body)
    if (title) header.push(`Title: ${title}`)
    return `${header.join("\n")}\n\n${trimChars(text)}`
  }

  return `${header.join("\n")}\n\n${trimChars(body)}`
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Minimal web search through Exa MCP. No API key, no curator, no provider fallback.",
    promptSnippet: "Search the web through Exa MCP for current information.",
    parameters: webSearchSchema,
    async execute(_toolCallId: string, params: WebSearchParams, signal?: AbortSignal) {
      const query = params.query.trim()
      if (!query) throw new Error("No query provided")

      try {
        const text = await callExaMcp(
          "web_search_exa",
          {
            query: buildSearchQuery({ ...params, query }),
            numResults: clampInt(params.numResults, 5, 1, 20),
            livecrawl: "fallback",
            type: "auto",
            contextMaxCharacters: params.includeContent ? 50_000 : 3000,
          },
          signal
        )
        return toToolResult(text, { query })
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        throw new Error(`Web search failed: ${message}`, { cause })
      }
    },
  })

  pi.registerTool({
    name: "code_search",
    label: "Code Search",
    description: "Search for code examples, docs, and API references through Exa MCP.",
    promptSnippet: "Search code/docs/API examples through Exa MCP.",
    parameters: codeSearchSchema,
    async execute(_toolCallId: string, params: CodeSearchParams, signal?: AbortSignal) {
      const query = params.query.trim()
      const maxTokens = clampInt(params.maxTokens, DEFAULT_MAX_TOKENS, 1000, 50_000)
      if (!query) throw new Error("No query provided")

      try {
        const text = await callExaMcp(
          "get_code_context_exa",
          { query, tokensNum: maxTokens },
          signal
        )
        const mode: SearchMode = "code-context"
        return toToolResult(trimApproxTokens(text, maxTokens), { query, maxTokens, mode })
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        const missingTool =
          message.toLowerCase().includes("tool") && message.toLowerCase().includes("not found")
        if (!missingTool) {
          throw new Error(`Code search failed: ${message}`, { cause })
        }

        try {
          const text = await callExaMcp(
            "web_search_exa",
            {
              query: buildCodeFallbackQuery(query),
              numResults: maxTokensToResultCount(maxTokens),
              livecrawl: "fallback",
              type: "auto",
              contextMaxCharacters: Math.min(50_000, Math.max(1000, maxTokens * 4)),
            },
            signal
          )
          const mode: SearchMode = "web-search-fallback"
          return toToolResult(trimApproxTokens(text, maxTokens), { query, maxTokens, mode })
        } catch (fallbackCause) {
          const fallbackMessage =
            fallbackCause instanceof Error ? fallbackCause.message : String(fallbackCause)
          throw new Error(`Code search fallback failed: ${fallbackMessage}`, {
            cause: fallbackCause,
          })
        }
      }
    },
  })

  pi.registerTool({
    name: "fetch_url",
    label: "Fetch URL",
    description:
      "Fetch a normal HTTP/HTTPS URL and return text. HTML is lightly cleaned without external dependencies.",
    promptSnippet: "Fetch a URL and return text or lightly cleaned HTML content.",
    parameters: fetchUrlSchema,
    async execute(_toolCallId: string, params: FetchUrlParams, signal?: AbortSignal) {
      try {
        const url = parseHttpUrl(params.url.trim())
        const text = await fetchUrl(url, signal)
        return toToolResult(text, { url })
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        throw new Error(`Fetch URL failed: ${message}`, { cause })
      }
    },
  })
}
