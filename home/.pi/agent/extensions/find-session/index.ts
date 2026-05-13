import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent"
import { getAgentDir } from "@earendil-works/pi-coding-agent"
import { readdir, readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { runTrackedAgent } from "../shared/subagent"

// Constants

const COMMAND_NAME = "find-session"
const MESSAGE_TYPE = "find-session-result"
const LEGACY_WIDGET_KEY = "find-session"
const LOOKBACK_MS = 10 * 24 * 60 * 60 * 1000
const USER_MESSAGE_CHAR_LIMIT = 400
const SESSION_CHAR_LIMIT = 2_000
const PROMPT_CHAR_LIMIT = 90_000
const MAX_RESULTS = 10
const SUBAGENT_TIMEOUT_MS = 90_000

const SYSTEM_PROMPT = [
  "Rank previous Pi coding sessions for a user's search query.",
  "You receive numbered sessions with user-authored snippets.",
  "For each matching session, include the relevant user message text/snippets that explain why it matched.",
  "Keep the text concise but include enough relevant user wording for the user to understand what the session was about.",
  `Return only JSON: {"matches":[{"session":number,"message":number,"text":string},...]} with at most ${MAX_RESULTS} matches, best first.`,
  "The message number must be the snippet number from that session that should be opened.",
  'If no session is likely relevant, return {"matches":[]}.',
].join("\n")

// Types

type SessionSnippet = {
  entryId: string
  text: string
}

type ParsedMessageEntry = {
  id: string
  parentId: string | null
  role: string
  text: string
}

type Candidate = {
  ordinal: number
  id: string
  path: string
  cwd: string
  modifiedMs: number
  snippets: SessionSnippet[]
  promptText: string
}

type Match = {
  candidate: Candidate
  snippet: SessionSnippet
  text: string
}

type SessionDraft = Omit<Candidate, "ordinal" | "promptText">

// Generic helpers

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""

  return content
    .map((part) => {
      if (!isRecord(part)) return ""
      return part.type === "text" && typeof part.text === "string" ? part.text : ""
    })
    .filter(Boolean)
    .join(" ")
}

function jsonStringField(line: string, field: string): string | undefined {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  const match = line.match(new RegExp(`"${escapedField}":"((?:\\\\.|[^"\\\\])*)"`, "u"))
  if (!match) return undefined

  try {
    return JSON.parse(`"${match[1] ?? ""}"`) as string
  } catch {
    return match[1]
  }
}

function normalizeSnippet(text: string): string {
  return text.replace(/\s+/gu, " ").trim()
}

function capMessage(text: string): string {
  const normalized = normalizeSnippet(text)
  if (normalized.length <= USER_MESSAGE_CHAR_LIMIT) return normalized

  const head = normalized.slice(0, 300).trimEnd()
  const tail = normalized.slice(-(USER_MESSAGE_CHAR_LIMIT - 303)).trimStart()
  return `${head} … ${tail}`
}

function capSessionSnippets(snippets: SessionSnippet[]): SessionSnippet[] {
  const capped: SessionSnippet[] = []
  let total = 0

  for (const snippet of snippets) {
    const nextTotal = total + snippet.text.length + (capped.length === 0 ? 0 : 4)
    if (nextTotal > SESSION_CHAR_LIMIT) break
    capped.push(snippet)
    total = nextTotal
  }

  return capped
}

function shortenHome(path: string): string {
  const home = homedir()
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path
}

function formatAge(ms: number): string {
  const diffMs = Math.max(0, Date.now() - ms)
  const hours = Math.floor(diffMs / (60 * 60 * 1000))
  if (hours < 1) return "now"
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function truncate(input: string, max: number): string {
  const normalized = normalizeSnippet(input)
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max - 1).trimEnd()}…`
}

function sessionRootDir(): string {
  return process.env.PI_CODING_AGENT_SESSION_DIR ?? join(getAgentDir(), "sessions")
}

// Session scanning

async function findSessionFiles(): Promise<string[]> {
  const root = sessionRootDir()
  const dirs = await readdir(root, { withFileTypes: true }).catch(() => [])
  const files: string[] = []

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue
    const absDir = join(root, dir.name)
    const entries = await readdir(absDir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(join(absDir, entry.name))
    }
  }

  return files
}

async function readSessionDraft(path: string, cutoffMs: number): Promise<SessionDraft | undefined> {
  const stats = await stat(path).catch(() => undefined)
  if (!stats || stats.mtimeMs < cutoffMs) return undefined

  const content = await readFile(path, "utf8").catch(() => undefined)
  if (!content) return undefined

  let id = ""
  let cwd = ""
  const entries: ParsedMessageEntry[] = []

  const firstLineEnd = content.indexOf("\n")
  const headerLine = firstLineEnd === -1 ? content : content.slice(0, firstLineEnd)
  if (!headerLine.includes('"type":"session"')) return undefined
  id = jsonStringField(headerLine, "id") ?? ""
  cwd = jsonStringField(headerLine, "cwd") ?? ""

  let searchFrom = firstLineEnd === -1 ? 0 : firstLineEnd + 1
  while (true) {
    const hit = content.indexOf('"role":"user"', searchFrom)
    if (hit === -1) break

    const lineStart = content.lastIndexOf("\n", hit) + 1
    const nextLineEnd = content.indexOf("\n", hit)
    const lineEnd = nextLineEnd === -1 ? content.length : nextLineEnd
    searchFrom = lineEnd + 1

    let parsed: unknown
    try {
      parsed = JSON.parse(content.slice(lineStart, lineEnd))
    } catch {
      continue
    }
    if (!isRecord(parsed)) continue
    if (parsed.type !== "message" || !isRecord(parsed.message)) continue

    const entryId = typeof parsed.id === "string" ? parsed.id : ""
    const parentId = typeof parsed.parentId === "string" ? parsed.parentId : null
    const role = typeof parsed.message.role === "string" ? parsed.message.role : ""
    const text = capMessage(textFromContent(parsed.message.content))
    if (entryId) entries.push({ id: entryId, parentId, role, text })
  }

  const snippets = entries
    .filter((entry) => entry.role === "user" && entry.text)
    .map((entry) => ({
      entryId: entry.id,
      text: entry.text,
    }))
  const cappedSnippets = capSessionSnippets(snippets)
  if (!id || cappedSnippets.length === 0) return undefined

  return {
    id,
    path,
    cwd,
    modifiedMs: stats.mtimeMs,
    snippets: cappedSnippets,
  }
}

async function collectCandidates(): Promise<{ candidates: Candidate[]; totalRecent: number }> {
  const cutoffMs = Date.now() - LOOKBACK_MS
  const files = await findSessionFiles()
  const drafts = (await Promise.all(files.map((file) => readSessionDraft(file, cutoffMs))))
    .filter((draft): draft is SessionDraft => draft !== undefined)
    .sort((left, right) => right.modifiedMs - left.modifiedMs)

  const candidates: Candidate[] = []
  let promptChars = 0

  for (const draft of drafts) {
    const ordinal = candidates.length + 1
    const promptText = `${ordinal}) ${draft.snippets
      .map((snippet, index) => `[${index + 1}] ${snippet.text}`)
      .join(" || ")}`
    const nextChars = promptChars + promptText.length + 1
    if (nextChars > PROMPT_CHAR_LIMIT) break

    candidates.push({ ...draft, ordinal, promptText })
    promptChars = nextChars
  }

  return { candidates, totalRecent: drafts.length }
}

// Model prompt / response

function buildPrompt(query: string, candidates: Candidate[]): string {
  return [
    `Query: ${query}`,
    "",
    "Sessions:",
    ...candidates.map((candidate) => candidate.promptText),
  ].join("\n")
}

function extractRankedMatches(
  response: string
): Array<{ session: number; message: number; text?: string }> {
  const matches: Array<{ session: number; message: number; text?: string }> = []
  const seen = new Set<number>()

  const add = (session: number, message = 1, text?: string) => {
    if (!Number.isInteger(session) || seen.has(session)) return
    seen.add(session)
    matches.push({
      session,
      message: Number.isInteger(message) && message > 0 ? message : 1,
      text,
    })
  }

  try {
    const parsed = JSON.parse(response.trim())
    if (isRecord(parsed) && Array.isArray(parsed.matches)) {
      for (const value of parsed.matches) {
        if (typeof value === "number") add(value)
        else if (isRecord(value) && typeof value.session === "number") {
          add(
            value.session,
            typeof value.message === "number" ? value.message : 1,
            typeof value.text === "string" ? value.text : undefined
          )
        }
      }
    }
  } catch {
    for (const match of response.matchAll(/\d+/gu)) add(Number(match[0]))
  }

  return matches.slice(0, MAX_RESULTS)
}

// Display

function resultMessage(
  query: string,
  matches: Match[],
  searched: number,
  totalRecent: number
): string {
  const lines = [
    `Find session: ${query}`,
    `Searched ${searched}/${totalRecent} sessions from the last 10 days.`,
  ]

  if (matches.length === 0) {
    lines.push("", "No likely matches.")
    return lines.join("\n")
  }

  for (const [index, match] of matches.entries()) {
    const candidate = match.candidate
    const id = candidate.id.slice(0, 8)
    const cwd = candidate.cwd ? shortenHome(candidate.cwd) : "unknown cwd"
    const text = match.text || match.snippet.text
    lines.push("", `${index + 1}. ${cwd} · ${formatAge(candidate.modifiedMs)}`)
    lines.push(`   pi --session ${id}`)
    lines.push(`   ${truncate(text, 240)}`)
  }

  return lines.join("\n")
}

async function runFindSession(
  query: string,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI
): Promise<void> {
  ctx.ui.setWidget(LEGACY_WIDGET_KEY, undefined)

  if (!ctx.model) {
    ctx.ui.notify("No active model selected for /find-session.", "error")
    return
  }

  const { candidates, totalRecent } = await collectCandidates()
  if (candidates.length === 0) {
    pi.sendMessage({
      customType: MESSAGE_TYPE,
      content: `Find session: ${query}\n\nNo sessions from the last 10 days.`,
      display: true,
      details: { query, matches: [], searched: 0, totalRecent: 0 },
    })
    return
  }

  ctx.ui.notify(`Searching ${candidates.length} recent sessions in an isolated subagent...`, "info")

  try {
    const result = await runTrackedAgent({
      ctx,
      label: "Find session",
      prompt: buildPrompt(query, candidates),
      systemPrompt: SYSTEM_PROMPT,
      thinkingLevel: pi.getThinkingLevel(),
      tools: [],
      timeoutMs: SUBAGENT_TIMEOUT_MS,
    })

    const byOrdinal = new Map(candidates.map((candidate) => [candidate.ordinal, candidate]))
    const matches = extractRankedMatches(result.text)
      .map((match) => {
        const candidate = byOrdinal.get(match.session)
        const snippet = candidate?.snippets[match.message - 1] ?? candidate?.snippets[0]
        return candidate && snippet ? { candidate, snippet, text: match.text ?? "" } : undefined
      })
      .filter((match): match is Match => match !== undefined)

    pi.sendMessage({
      customType: MESSAGE_TYPE,
      content: resultMessage(query, matches, candidates.length, totalRecent),
      display: true,
      details: {
        query,
        matches: matches.map((match) => ({
          id: match.candidate.id,
          path: match.candidate.path,
          entryId: match.snippet.entryId,
          text: match.text || match.snippet.text,
        })),
        searched: candidates.length,
        totalRecent,
      },
    })
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error")
  }
}

// Extension entrypoint

export default function findSessionExtension(pi: ExtensionAPI): void {
  pi.on("context", (event) => ({
    messages: event.messages.filter(
      (message) => message.role !== "custom" || message.customType !== MESSAGE_TYPE
    ),
  }))

  pi.registerCommand(COMMAND_NAME, {
    description:
      "Find a recent session by vague user intent without adding search context to this session.",
    handler: async (args, ctx) => {
      let query = args.trim()
      if (!query) {
        const input = await ctx.ui.input("Find session", "What was the session about?")
        query = input?.trim() ?? ""
      }
      if (!query) return

      await runFindSession(query, ctx, pi)
    },
  })
}
