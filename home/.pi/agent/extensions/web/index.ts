import { lookup } from "node:dns/promises"
import { mkdtemp, writeFile } from "node:fs/promises"
import { isIP } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { StringEnum } from "@earendil-works/pi-ai"
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent"
import { convert as convertHtmlToText } from "html-to-text"
import { parseHTML } from "linkedom"
import TurndownService from "turndown"
import { gfm } from "turndown-plugin-gfm"
import { Type, type Static } from "typebox"

const EXA_MCP_URL = "https://mcp.exa.ai/mcp"
const DEFAULT_MAX_TOKENS = 5000
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const MAX_REDIRECTS = 5

type HttpUrl = string & { readonly __brand: "HttpUrl" }
type SearchMode = "code-context" | "web-search-fallback"
type WebOperation = "web-search" | "code-search" | "fetch-url"
type FetchFormat = "markdown" | "text" | "html"

interface StructuredSearchResult {
  title: string
  url: string
  snippet?: string
  publishedAt?: string
  source?: string
}

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
  format: Type.Optional(
    StringEnum(["markdown", "text", "html"] as const, {
      description: "Output format for HTML pages. Defaults to markdown.",
    })
  ),
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

function parseStructuredSearchResults(text: string): StructuredSearchResult[] {
  const sections = text.replace(/\r\n/g, "\n").split(/\n(?=Title: )/)
  const results: StructuredSearchResult[] = []

  for (const section of sections) {
    const lines = section.split("\n")
    let title = ""
    let url: HttpUrl | undefined
    let publishedAt: string | undefined
    let source: string | undefined
    const snippetLines: string[] = []
    let readingSnippet = false

    for (const line of lines) {
      if (!readingSnippet && line.startsWith("Title: ")) {
        title = line.slice("Title: ".length).trim()
      } else if (!readingSnippet && line.startsWith("URL: ")) {
        try {
          url = parseHttpUrl(line.slice("URL: ".length).trim())
        } catch {}
      } else if (!readingSnippet && line.startsWith("Published Date: ")) {
        publishedAt = line.slice("Published Date: ".length).trim() || undefined
      } else if (!readingSnippet && line.startsWith("Published: ")) {
        publishedAt = line.slice("Published: ".length).trim() || undefined
      } else if (!readingSnippet && line.startsWith("Source: ")) {
        source = line.slice("Source: ".length).trim() || undefined
      } else if (!readingSnippet && line.startsWith("Author: ")) {
        source ??= line.slice("Author: ".length).trim() || undefined
      } else if (
        !readingSnippet &&
        (line.startsWith("Text:") || line.startsWith("Highlights:"))
      ) {
        readingSnippet = true
        snippetLines.push(line.slice(line.indexOf(":") + 1).trim())
      } else if (readingSnippet && !/^\s*---+\s*$/.test(line)) {
        snippetLines.push(line)
      }
    }

    if (!url) continue
    const fullSnippet = snippetLines.join("\n").replace(/\n{3,}/g, "\n\n").trim()
    const snippet =
      fullSnippet.length > 1000 ? `${fullSnippet.slice(0, 997).trimEnd()}...` : fullSnippet
    results.push({
      title: title || url,
      url,
      ...(snippet ? { snippet } : {}),
      ...(publishedAt ? { publishedAt } : {}),
      ...(source ? { source } : {}),
    })
  }

  return results
}

async function toToolResult(
  text: string,
  operation: WebOperation,
  details?: Record<string, unknown>
) {
  const truncation = truncateHead(text, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  })
  if (!truncation.truncated) {
    return {
      content: [{ type: "text" as const, text: truncation.content }],
      details: { ...details, truncated: false },
    }
  }

  const outputDirectory = await mkdtemp(join(tmpdir(), "pi-web-"))
  const outputPath = join(outputDirectory, `${operation}.txt`)
  await writeFile(outputPath, text, "utf8")

  const notice = [
    `Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines`,
    `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`,
    `Full output saved to: ${outputPath}`,
  ].join(" ")

  return {
    content: [{ type: "text" as const, text: `${truncation.content}\n\n[${notice}]` }],
    details: { ...details, truncated: true, fullOutputPath: outputPath },
  }
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

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
})
turndown.use(gfm)

function resolveHtmlUrl(value: string, baseUrl: HttpUrl, allowMailto: boolean): string | undefined {
  try {
    const resolved = new URL(value, baseUrl)
    if (resolved.protocol === "http:" || resolved.protocol === "https:") return resolved.toString()
    if (allowMailto && resolved.protocol === "mailto:") return resolved.toString()
  } catch {}
  return undefined
}

function extractReadableHtml(html: string, baseUrl: HttpUrl): { title?: string; html: string } {
  const { document } = parseHTML(html)
  const title = document.querySelector("title")?.textContent?.trim() || undefined
  const root =
    document.querySelector("article") ??
    document.querySelector("main") ??
    document.querySelector("[role='main']") ??
    document.body ??
    document.documentElement

  for (const element of root.querySelectorAll(
    "script, style, noscript, template, nav, header, footer, aside, form, iframe, canvas, svg"
  )) {
    element.remove()
  }
  for (const element of root.querySelectorAll("[href]")) {
    const href = element.getAttribute("href")
    if (!href) continue
    const resolved = resolveHtmlUrl(href, baseUrl, true)
    if (resolved) element.setAttribute("href", resolved)
    else element.removeAttribute("href")
  }
  for (const element of root.querySelectorAll("[src]")) {
    const src = element.getAttribute("src")
    if (!src) continue
    const resolved = resolveHtmlUrl(src, baseUrl, false)
    if (resolved) element.setAttribute("src", resolved)
    else element.removeAttribute("src")
  }

  return { ...(title ? { title } : {}), html: root.innerHTML }
}

function renderHtml(html: string, baseUrl: HttpUrl, format: FetchFormat) {
  const readable = extractReadableHtml(html, baseUrl)
  if (format === "html") return { title: readable.title, content: html }
  if (format === "text") {
    return {
      title: readable.title,
      content: convertHtmlToText(readable.html, {
        wordwrap: false,
        selectors: [
          { selector: "h1", options: { uppercase: false } },
          { selector: "h2", options: { uppercase: false } },
          { selector: "h3", options: { uppercase: false } },
          { selector: "h4", options: { uppercase: false } },
          { selector: "h5", options: { uppercase: false } },
          { selector: "h6", options: { uppercase: false } },
        ],
      }).trim(),
    }
  }
  return { title: readable.title, content: turndown.turndown(readable.html).trim() }
}

async function fetchUrl(
  url: HttpUrl,
  format: FetchFormat,
  signal?: AbortSignal
): Promise<{ output: string; details: Record<string, unknown> }> {
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
  let content = body
  let title: string | undefined
  if (contentType.toLowerCase().includes("html")) {
    const rendered = renderHtml(body, finalUrl, format)
    content = rendered.content
    title = rendered.title
    if (title) header.push(`Title: ${title}`)
  }

  return {
    output: `${header.join("\n")}\n\n${content}`,
    details: {
      url,
      finalUrl,
      status: response.status,
      contentType,
      format,
      ...(title ? { title } : {}),
    },
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Minimal web search through Exa MCP. No API key or provider fallback. Output is limited to 50KB or 2000 lines; complete truncated output is saved to a temporary file.",
    promptSnippet: "Search the web through Exa MCP for current information.",
    promptGuidelines: [
      "Use web_search when current public-web information is needed or the right URL is not yet known.",
      "After web_search identifies a relevant page, use fetch_url to inspect its full content.",
    ],
    parameters: webSearchSchema,
    async execute(
      _toolCallId: string,
      params: WebSearchParams,
      signal?: AbortSignal,
      onUpdate?
    ) {
      const query = params.query.trim()
      if (!query) throw new Error("No query provided")
      onUpdate?.({
        content: [{ type: "text", text: `Searching the web for: ${query}` }],
        details: undefined,
      })

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
        const results = parseStructuredSearchResults(text)
        return toToolResult(text, "web-search", {
          query,
          resultCount: results.length,
          results,
        })
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        throw new Error(`Web search failed: ${message}`, { cause })
      }
    },
  })

  pi.registerTool({
    name: "code_search",
    label: "Code Search",
    description:
      "Search for code examples, docs, and API references through Exa MCP. Output is limited to 50KB or 2000 lines; complete truncated output is saved to a temporary file.",
    promptSnippet: "Search code/docs/API examples through Exa MCP.",
    promptGuidelines: [
      "Use code_search for programming APIs, library documentation, source examples, and debugging references.",
      "Use web_search instead of code_search for general current information unrelated to software development.",
    ],
    parameters: codeSearchSchema,
    async execute(
      _toolCallId: string,
      params: CodeSearchParams,
      signal?: AbortSignal,
      onUpdate?
    ) {
      const query = params.query.trim()
      const maxTokens = clampInt(params.maxTokens, DEFAULT_MAX_TOKENS, 1000, 50_000)
      if (!query) throw new Error("No query provided")
      onUpdate?.({
        content: [{ type: "text", text: `Searching code context for: ${query}` }],
        details: undefined,
      })

      try {
        const text = await callExaMcp(
          "get_code_context_exa",
          { query, tokensNum: maxTokens },
          signal
        )
        const mode: SearchMode = "code-context"
        return toToolResult(text, "code-search", { query, maxTokens, mode })
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        const missingTool =
          message.toLowerCase().includes("tool") && message.toLowerCase().includes("not found")
        if (!missingTool) {
          throw new Error(`Code search failed: ${message}`, { cause })
        }

        onUpdate?.({
          content: [{ type: "text", text: "Code context unavailable; searching the web instead" }],
          details: undefined,
        })
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
          const results = parseStructuredSearchResults(text)
          return toToolResult(text, "code-search", {
            query,
            maxTokens,
            mode,
            resultCount: results.length,
            results,
          })
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
      "Fetch a normal HTTP/HTTPS URL as readable markdown, plain text, or raw HTML. Output is limited to 50KB or 2000 lines; complete truncated output is saved to a temporary file.",
    promptSnippet: "Fetch a URL as readable markdown, plain text, or raw HTML.",
    promptGuidelines: [
      "Use fetch_url when the user provides a known URL or after web_search identifies a page to inspect.",
      "Use web_search before fetch_url when the right URL is not yet known.",
      "Prefer fetch_url format=markdown unless the user explicitly needs plain text or raw HTML.",
    ],
    parameters: fetchUrlSchema,
    async execute(
      _toolCallId: string,
      params: FetchUrlParams,
      signal?: AbortSignal,
      onUpdate?
    ) {
      try {
        const url = parseHttpUrl(params.url.trim())
        const format = params.format ?? "markdown"
        onUpdate?.({
          content: [{ type: "text", text: `Fetching ${format}: ${url}` }],
          details: undefined,
        })
        const result = await fetchUrl(url, format, signal)
        return toToolResult(result.output, "fetch-url", result.details)
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        throw new Error(`Fetch URL failed: ${message}`, { cause })
      }
    },
  })
}
