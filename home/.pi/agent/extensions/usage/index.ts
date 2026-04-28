import type {
  ExtensionAPI,
  ExtensionCommandContext,
  OAuthCredential,
} from "@mariozechner/pi-coding-agent"
import type { Api, Model } from "@mariozechner/pi-ai"
import { matchesKey, Text } from "@mariozechner/pi-tui"

// Constants

const CODEX_PROVIDER = "openai-codex"
const CODEX_MODEL_IDS = ["gpt-5.3-codex-spark", "gpt-5.5"] as const
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"
const REQUEST_TIMEOUT_MS = 15_000

// Types

type Brand<T, Name extends string> = T & { readonly __brand: Name }
type OAuthToken = Brand<string, "OAuthToken">
type ChatGptAccountId = Brand<string, "ChatGptAccountId">

type CodexAuth = {
  token: OAuthToken
  accountId?: ChatGptAccountId
}

type UsageFetchRequest = {
  auth: CodexAuth
  fetchImpl?: typeof fetch
}

type RateLimitWindow = {
  used_percent?: number
  limit_window_seconds?: number
  reset_after_seconds?: number
  reset_at?: number
}

type RateLimitDetails = {
  allowed?: boolean
  limit_reached?: boolean
  primary_window?: RateLimitWindow | null
  secondary_window?: RateLimitWindow | null
}

type CreditsDetails = {
  has_credits?: boolean
  unlimited?: boolean
  balance?: string | null
}

type AdditionalRateLimit = {
  limit_name?: string
  metered_feature?: string
  rate_limit?: RateLimitDetails | null
}

type UsagePayload = {
  plan_type?: string
  rate_limit?: RateLimitDetails | null
  credits?: CreditsDetails | null
  additional_rate_limits?: AdditionalRateLimit[] | null
  rate_limit_reached_type?: { type?: string } | null
}

type LimitGroup = {
  name: string
  rateLimit?: RateLimitDetails | null
}

// Generic helpers

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch (error) {
    throw new Error(`Codex usage response was invalid JSON: ${errorMessage(error)}`)
  }
}

// Auth helpers

function parseOAuthToken(value: string | undefined): OAuthToken {
  if (!value?.trim()) {
    throw new Error(
      "No ChatGPT/Codex OAuth token found. Run /login and choose OpenAI ChatGPT (Codex)."
    )
  }
  return value as OAuthToken
}

function parseAccountId(value: unknown): ChatGptAccountId | undefined {
  const accountId = optionalString(value)?.trim()
  return accountId ? (accountId as ChatGptAccountId) : undefined
}

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
  return Buffer.from(padded, "base64").toString("utf8")
}

function extractAccountId(token: OAuthToken): ChatGptAccountId | undefined {
  try {
    const [, payload] = token.split(".")
    if (!payload) return undefined

    const decoded: unknown = JSON.parse(decodeBase64Url(payload))
    if (!isRecord(decoded)) return undefined

    const auth = decoded["https://api.openai.com/auth"]
    if (!isRecord(auth)) return undefined

    return parseAccountId(auth.chatgpt_account_id)
  } catch {
    return undefined
  }
}

function findCodexModel(ctx: ExtensionCommandContext): Model<Api> | undefined {
  for (const modelId of CODEX_MODEL_IDS) {
    const model = ctx.modelRegistry.find(CODEX_PROVIDER, modelId)
    if (model) return model
  }
  return ctx.modelRegistry.getAll().find((candidate) => candidate.provider === CODEX_PROVIDER)
}

function getStoredCodexOAuth(ctx: ExtensionCommandContext): OAuthCredential | undefined {
  const credential = ctx.modelRegistry.authStorage.get(CODEX_PROVIDER)
  return credential?.type === "oauth" ? credential : undefined
}

async function getCodexAuth(ctx: ExtensionCommandContext): Promise<CodexAuth> {
  const model = findCodexModel(ctx)
  if (!model) throw new Error("No openai-codex model is registered in pi.")

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model)
  if (!auth.ok) throw new Error(auth.error)
  const token = parseOAuthToken(auth.apiKey)

  const stored = getStoredCodexOAuth(ctx)
  return { token, accountId: parseAccountId(stored?.accountId) ?? extractAccountId(token) }
}

// Usage payload parsing

function parseRateLimitWindow(value: unknown): RateLimitWindow | null | undefined {
  if (value === null) return null
  if (!isRecord(value)) return undefined
  return {
    used_percent: optionalNumber(value.used_percent),
    limit_window_seconds: optionalNumber(value.limit_window_seconds),
    reset_after_seconds: optionalNumber(value.reset_after_seconds),
    reset_at: optionalNumber(value.reset_at),
  }
}

function parseRateLimitDetails(value: unknown): RateLimitDetails | null | undefined {
  if (value === null) return null
  if (!isRecord(value)) return undefined
  return {
    allowed: optionalBoolean(value.allowed),
    limit_reached: optionalBoolean(value.limit_reached),
    primary_window: parseRateLimitWindow(value.primary_window),
    secondary_window: parseRateLimitWindow(value.secondary_window),
  }
}

function parseCreditsDetails(value: unknown): CreditsDetails | null | undefined {
  if (value === null) return null
  if (!isRecord(value)) return undefined
  return {
    has_credits: optionalBoolean(value.has_credits),
    unlimited: optionalBoolean(value.unlimited),
    balance: value.balance === null ? null : optionalString(value.balance),
  }
}

function parseAdditionalRateLimit(value: unknown): AdditionalRateLimit | undefined {
  if (!isRecord(value)) return undefined
  return {
    limit_name: optionalString(value.limit_name),
    metered_feature: optionalString(value.metered_feature),
    rate_limit: parseRateLimitDetails(value.rate_limit),
  }
}

function parseUsagePayload(value: unknown): UsagePayload {
  if (!isRecord(value)) throw new Error("Codex usage response was not a JSON object.")

  const reachedTypeValue = value.rate_limit_reached_type
  const reachedType = isRecord(reachedTypeValue) ? reachedTypeValue : undefined
  const additional = Array.isArray(value.additional_rate_limits)
    ? value.additional_rate_limits
        .map(parseAdditionalRateLimit)
        .filter((item): item is AdditionalRateLimit => Boolean(item))
    : undefined

  return {
    plan_type: optionalString(value.plan_type),
    rate_limit: parseRateLimitDetails(value.rate_limit),
    credits: parseCreditsDetails(value.credits),
    additional_rate_limits: additional,
    rate_limit_reached_type: reachedType
      ? { type: optionalString(reachedType.type) }
      : reachedTypeValue === null
        ? null
        : undefined,
  }
}

// Usage formatting

function planName(planType?: string): string {
  if (!planType) return "unknown"
  return planType
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function durationLabel(seconds?: number): string {
  if (!seconds || seconds <= 0) return "limit"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = minutes / 60
  if (Number.isInteger(hours) && hours < 24) return `${hours}h`
  const days = hours / 24
  if (Math.abs(days - 7) < 0.01) return "Weekly"
  if (Math.abs(days - 30) < 1) return "Monthly"
  if (Number.isInteger(days)) return `${days}d`
  return `${Math.round(hours)}h`
}

function resetLabel(window: RateLimitWindow): string | undefined {
  const resetAt = window.reset_at
  if (typeof resetAt === "number" && Number.isFinite(resetAt) && resetAt > 0) {
    const date = new Date(resetAt * 1000)
    const time = new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date)
    if (date.toDateString() === new Date().toDateString()) return time
    const day = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(date)
    return `${day} ${time}`
  }

  const resetAfter = window.reset_after_seconds
  if (typeof resetAfter !== "number" || !Number.isFinite(resetAfter) || resetAfter < 0)
    return undefined
  const minutes = Math.round(resetAfter / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

function formatWindow(window: RateLimitWindow): string {
  const used = typeof window.used_percent === "number" ? window.used_percent : 0
  const remaining = Math.max(0, Math.min(100, 100 - used))
  const reset = resetLabel(window)
  return `${remaining.toFixed(0)}% left${reset ? ` · reset ${reset}` : ""}`
}

function compactLimitName(name: string): string {
  return name
    .replace(/^GPT-[\d.]+-Codex-/i, "")
    .replace(/^Codex[- ]/i, "")
    .replace(/-/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatLimitGroup(group: LimitGroup): string[] {
  const primary = group.rateLimit?.primary_window ?? undefined
  const secondary = group.rateLimit?.secondary_window ?? undefined
  const name = group.name === "Codex" ? "Codex" : compactLimitName(group.name)
  const windows = [
    primary ? { label: durationLabel(primary.limit_window_seconds), window: primary } : undefined,
    secondary
      ? { label: durationLabel(secondary.limit_window_seconds), window: secondary }
      : undefined,
  ].filter((item): item is { label: string; window: RateLimitWindow } => Boolean(item))
  const labelWidth = Math.max(0, ...windows.map((item) => item.label.length))
  return [
    `${name}:`,
    ...(windows.length
      ? windows.map((item) => `${item.label.padEnd(labelWidth)}  ${formatWindow(item.window)}`)
      : ["No limit data"]),
  ]
}

function formatCredits(credits?: CreditsDetails | null): string[] {
  if (!credits?.has_credits) return []
  if (credits.unlimited) return ["Credits: Unlimited"]
  const rawBalance = credits.balance?.trim()
  if (!rawBalance) return []
  const parsed = Number(rawBalance)
  return [`Credits: ${Number.isFinite(parsed) ? Math.round(parsed).toString() : rawBalance}`]
}

function formatUsage(payload: UsagePayload): string {
  const lines = [`Codex · ${planName(payload.plan_type)}`]
  lines.push(...formatCredits(payload.credits))
  if (payload.rate_limit_reached_type?.type)
    lines.push(`State: ${payload.rate_limit_reached_type.type}`)

  const groups: LimitGroup[] = [{ name: "Codex", rateLimit: payload.rate_limit }]
  for (const additional of payload.additional_rate_limits ?? []) {
    groups.push({
      name: additional.limit_name || additional.metered_feature || "Additional",
      rateLimit: additional.rate_limit,
    })
  }

  for (const group of groups) lines.push("", ...formatLimitGroup(group))
  return lines.join("\n")
}

// Usage fetching

async function fetchUsage({ auth, fetchImpl = fetch }: UsageFetchRequest): Promise<UsagePayload> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${auth.token}`,
      originator: "pi",
      "User-Agent": "pi usage",
      accept: "application/json",
    }
    if (auth.accountId) headers["chatgpt-account-id"] = auth.accountId

    const response = await fetchImpl(CODEX_USAGE_URL, {
      method: "GET",
      headers,
      signal: controller.signal,
    })
    const body = await response.text()
    if (!response.ok)
      throw new Error(
        `GET ${CODEX_USAGE_URL} failed: ${response.status} ${response.statusText}\n${body}`
      )

    return parseUsagePayload(parseJson(body))
  } finally {
    clearTimeout(timeout)
  }
}

// UI rendering

async function showUsage(content: string, ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.hasUI) {
    console.log(content)
    return
  }

  await ctx.ui.custom((_tui, theme, _keybindings, done) => {
    const [title, ...rest] = content.split("\n")
    const body = `${theme.fg("accent", theme.bold(title))}\n${rest.join("\n")}`
    const text = new Text(body, 0, 0)

    return {
      render: (width: number) => text.render(width),
      invalidate: () => text.invalidate(),
      handleInput: (data: string) => {
        if (matchesKey(data, "enter") || matchesKey(data, "escape")) done(undefined)
      },
    }
  })
}

function reportUsageError(ctx: ExtensionCommandContext, error: unknown): void {
  const message = `Codex usage fetch failed: ${errorMessage(error)}`
  if (ctx.hasUI) ctx.ui.notify(message, "error")
  else console.error(message)
}

// Extension entrypoint

export default function usage(pi: ExtensionAPI): void {
  pi.registerCommand("usage", {
    description: "Fetch ChatGPT Codex usage limits from the Codex backend",
    handler: async (_args, ctx) => {
      try {
        const auth = await getCodexAuth(ctx)
        const payload = await fetchUsage({ auth })
        await showUsage(formatUsage(payload), ctx)
      } catch (error) {
        reportUsageError(ctx, error)
      }
    },
  })
}
