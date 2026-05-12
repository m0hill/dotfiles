import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type, type Static } from "typebox"

const EXA_MCP_URL = "https://mcp.exa.ai/mcp"
const DEFAULT_MAX_TOKENS = 5000
const MAX_TEXT_CHARS = 50_000

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

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Exa MCP error ${response.status}: ${text.slice(0, 500)}`)
  }

  const body = await response.text()
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
  return parsed.toString() as HttpUrl
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
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "pi-web-extension/1.0" },
    signal: withTimeout(signal, 30_000),
  })
  const contentType = response.headers.get("content-type") ?? "unknown"
  const body = await response.text()

  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status} ${response.statusText}: ${body.slice(0, 500)}`)
  }

  const header = [
    `URL: ${response.url}`,
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
      if (!query) return toToolResult("Error: No query provided.")

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
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return toToolResult(`Error: ${message}`, { query, error: message })
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
      if (!query) return toToolResult("Error: No query provided.")

      try {
        const text = await callExaMcp(
          "get_code_context_exa",
          { query, tokensNum: maxTokens },
          signal
        )
        const mode: SearchMode = "code-context"
        return toToolResult(trimApproxTokens(text, maxTokens), { query, maxTokens, mode })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const missingTool =
          message.toLowerCase().includes("tool") && message.toLowerCase().includes("not found")
        if (!missingTool) {
          return toToolResult(`Error: ${message}`, { query, maxTokens, error: message })
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
        } catch (fallbackErr) {
          const fallbackMessage =
            fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
          return toToolResult(`Error: ${fallbackMessage}`, {
            query,
            maxTokens,
            error: fallbackMessage,
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
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return toToolResult(`Error: ${message}`, { url: params.url, error: message })
      }
    },
  })
}
