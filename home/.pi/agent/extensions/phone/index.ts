import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import { createServer as createHttpsServer } from "node:https"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import type { AgentMessage } from "@earendil-works/pi-agent-core"
import type { TextContent } from "@earendil-works/pi-ai"
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent"
import { Type, type Static } from "typebox"
import { Decode } from "typebox/value"

const execFileAsync = promisify(execFile)

const PORT = 43117
const HOST = "0.0.0.0"
const TOKEN_TTL_MS = 30 * 60 * 1000
const TAILSCALE_DOMAIN = "mohil.tail47ab7d.ts.net"
const TAILSCALE_CERT = `${process.env.HOME ?? ""}/Library/Containers/io.tailscale.ipn.macos/Data/${TAILSCALE_DOMAIN}.crt`
const TAILSCALE_KEY = `${process.env.HOME ?? ""}/Library/Containers/io.tailscale.ipn.macos/Data/${TAILSCALE_DOMAIN}.key`
const QRENCODE = "/opt/homebrew/bin/qrencode"
const FFMPEG = "/opt/homebrew/bin/ffmpeg"
const STT_HELPER = `${process.env.HOME ?? ""}/Library/Application Support/Hammerspoon/STT/bin/stt-helper`
const MAX_AUDIO_BYTES = 25 * 1024 * 1024
const HELPER_MARKER = "__STT_JSON_B64__"

const sendPayloadSchema = Type.Object({
  message: Type.String({ pattern: "\\S" }),
})

declare const __dirname: string

type SendPayload = Static<typeof sendPayloadSchema>

type ToolActivityStatus = "running" | "success" | "error"

type FeedItem = {
  id: string
  role: string
  text: string
  status?: ToolActivityStatus
}

type Client = {
  id: string
  res: ServerResponse
  heartbeat: NodeJS.Timeout
}

type PhoneServer = ReturnType<typeof createHttpServer> | ReturnType<typeof createHttpsServer>

type ServerState = {
  server: PhoneServer
  port: number
  token: string
  tokenExpiresAt: number
  clients: Map<string, Client>
}

type LatestContext = {
  sessionManager: { getBranch(): SessionEntry[] }
  isIdle(): boolean
}

let state: ServerState | null = null
let startPromise: Promise<ServerState> | null = null
let latestCtx: LatestContext | null = null
let feedItems: FeedItem[] = []

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function newToken(): string {
  return randomBytes(18).toString("base64url")
}

function refreshToken(running: ServerState): void {
  running.token = newToken()
  running.tokenExpiresAt = Date.now() + TOKEN_TTL_MS
}

function isAuthorized(url: URL): boolean {
  if (state === null) return false
  if (url.searchParams.get("token") !== state.token) return false
  if (Date.now() >= state.tokenExpiresAt) return false
  state.tokenExpiresAt = Date.now() + TOKEN_TTL_MS
  return true
}

function staticFile(pathname: string): { path: string; contentType: string } | null {
  if (pathname === "/" || pathname === "/index.html") {
    return { path: join(__dirname, "index.html"), contentType: "text/html; charset=utf-8" }
  }
  if (pathname === "/main.js") {
    return { path: join(__dirname, "main.js"), contentType: "text/javascript; charset=utf-8" }
  }
  if (pathname === "/style.css") {
    return { path: join(__dirname, "style.css"), contentType: "text/css; charset=utf-8" }
  }
  return null
}

function sendJson(res: ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(value))
}

function sendEvent(client: Client, event: string, data: unknown): void {
  client.res.write(`event: ${event}\n`)
  client.res.write(`data: ${JSON.stringify(data)}\n\n`)
}

function sendHeartbeat(client: Client): void {
  client.res.write(`: heartbeat ${Date.now()}\n\n`)
}

function broadcast(event: string, data: unknown): void {
  for (const client of state?.clients.values() ?? []) sendEvent(client, event, data)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ""
    let failed = false
    req.setEncoding("utf8")
    req.on("data", (chunk) => {
      if (failed) return
      body += chunk
      if (body.length > 200_000) {
        failed = true
        reject(new Error("Request body too large"))
      }
    })
    req.on("end", () => {
      if (!failed) resolve(body)
    })
    req.on("error", reject)
  })
}

function readBinaryBody(req: IncomingMessage, maxBytes = MAX_AUDIO_BYTES): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let failed = false
    req.on("data", (chunk: Buffer) => {
      if (failed) return
      size += chunk.length
      if (size > maxBytes) {
        failed = true
        reject(new Error("Audio upload too large"))
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => {
      if (!failed) resolve(Buffer.concat(chunks))
    })
    req.on("error", reject)
  })
}

function parseSendPayload(body: string): SendPayload {
  const payload = Decode(sendPayloadSchema, JSON.parse(body))
  return { message: payload.message.trim() }
}

type ChatContent = Extract<AgentMessage, { role: "user" | "assistant" }>["content"]
type ChatContentBlock = Exclude<ChatContent, string>[number]

function isTextContent(block: ChatContentBlock): block is TextContent {
  return block.type === "text"
}

function textFromContent(content: ChatContent): string {
  if (typeof content === "string") return content
  return content
    .filter(isTextContent)
    .map((block) => block.text)
    .join("\n")
}

function messageView(id: string, message: AgentMessage): FeedItem | null {
  if (message.role !== "user" && message.role !== "assistant") return null
  const text = textFromContent(message.content).trim()
  if (!text) return null
  return { id, role: message.role, text }
}

function entryView(entry: SessionEntry): FeedItem | null {
  return entry.type === "message" ? messageView(entry.id, entry.message) : null
}

function truncate(text: string, max = 96): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function argString(args: unknown, key: string): string | undefined {
  if (typeof args !== "object" || args === null) return undefined
  const value = Object.getOwnPropertyDescriptor(args, key)?.value
  return typeof value === "string" ? value : undefined
}

function toolSummary(toolName: string, args: unknown): string {
  if (toolName === "bash")
    return truncate(argString(args, "command")?.split("\n")[0]?.trim() ?? "bash")
  if (toolName === "read" || toolName === "write" || toolName === "edit") {
    return truncate(argString(args, "path") ?? toolName)
  }
  if (toolName === "grep") return truncate(argString(args, "pattern") ?? "grep")
  return toolName
}

function toolText(status: ToolActivityStatus, toolName: string, args: unknown): string {
  const icon = status === "running" ? "⚙︎" : status === "success" ? "✓" : "✗"
  return `${icon} ${toolName} ${toolSummary(toolName, args)}`
}

function isFeedItem(item: FeedItem | null): item is FeedItem {
  return item !== null
}

function snapshot(): {
  messages: FeedItem[]
  idle: boolean
} {
  return { messages: feedItems, idle: latestCtx?.isIdle() ?? true }
}

function tailscaleUrl(port: number, token: string): string {
  return `https://${TAILSCALE_DOMAIN}:${port}/?token=${encodeURIComponent(token)}`
}

async function qrText(url: string): Promise<string> {
  const { stdout } = await execFileAsync(QRENCODE, ["-t", "UTF8i", "-m", "1", url], {
    timeout: 3000,
  })
  return stdout
    .trimEnd()
    .split("\n")
    .map((line) => `\x1b[97m${line}\x1b[0m`)
    .join("\n")
}

function parseSttHelperOutput(
  stdout: string,
  stderr: string
): { ok?: boolean; text?: string; error?: string } {
  const match = `${stdout}\n${stderr}`.match(new RegExp(`${HELPER_MARKER}([A-Za-z0-9+/=]+)`))
  if (!match) throw new Error("Could not parse STT helper output")
  const decoded = Buffer.from(match[1], "base64").toString("utf8")
  return JSON.parse(decoded)
}

async function transcribeAudio(audio: Buffer): Promise<string> {
  if (audio.length === 0) throw new Error("Empty audio upload")

  const dir = await mkdtemp(join(tmpdir(), "pi-phone-stt-"))
  const inputPath = join(dir, "input.webm")
  const wavPath = join(dir, "input.wav")

  try {
    await writeFile(inputPath, audio)
    await execFileAsync(
      FFMPEG,
      ["-y", "-i", inputPath, "-ac", "1", "-ar", "16000", "-c:a", "pcm_f32le", wavPath],
      { timeout: 60_000 }
    )

    const { stdout, stderr } = await execFileAsync(STT_HELPER, ["transcribe", "--input", wavPath], {
      timeout: 180_000,
    })
    const result = parseSttHelperOutput(stdout, stderr)
    if (result.ok !== true) throw new Error(result.error || "Transcription failed")
    const text = (result.text || "").trim()
    if (!text) throw new Error("No speech detected in audio")
    return text
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function requireAuthorized(url: URL, res: ServerResponse): boolean {
  if (isAuthorized(url)) return true
  sendJson(res, { error: "Unauthorized or expired token" }, 401)
  return false
}

function createPhoneServer(pi: ExtensionAPI): PhoneServer {
  return createHttpsServer(
    {
      cert: readFileSync(TAILSCALE_CERT),
      key: readFileSync(TAILSCALE_KEY),
    },
    async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://phone.pi")

        if (req.method === "GET" && url.pathname === "/events") {
          if (!requireAuthorized(url, res)) return
          const id = randomBytes(8).toString("hex")
          res.writeHead(200, {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
          })
          const client = {
            id,
            res,
            heartbeat: setInterval(() => sendHeartbeat(client), 15_000),
          }
          state?.clients.set(id, client)
          sendEvent(client, "snapshot", snapshot())
          sendHeartbeat(client)
          req.on("close", () => {
            clearInterval(client.heartbeat)
            state?.clients.delete(id)
          })
          return
        }

        if (req.method === "GET" && url.pathname === "/api/state") {
          if (!requireAuthorized(url, res)) return
          return sendJson(res, snapshot())
        }

        if (req.method === "POST" && url.pathname === "/api/transcribe") {
          if (!requireAuthorized(url, res)) return
          try {
            const text = await transcribeAudio(await readBinaryBody(req))
            return sendJson(res, { ok: true, text })
          } catch (error) {
            return sendJson(res, { error: errorMessage(error) }, 400)
          }
        }

        if (req.method === "POST" && url.pathname === "/api/send") {
          if (!requireAuthorized(url, res)) return
          let payload: SendPayload
          try {
            payload = parseSendPayload(await readBody(req))
          } catch {
            return sendJson(res, { error: "Invalid send payload" }, 400)
          }
          if (latestCtx?.isIdle()) pi.sendUserMessage(payload.message)
          else pi.sendUserMessage(payload.message, { deliverAs: "followUp" })
          broadcast("status", { idle: false })
          return sendJson(res, { ok: true })
        }

        const file = staticFile(url.pathname)
        if (!file) return sendJson(res, { error: "Not found" }, 404)
        res.writeHead(200, { "content-type": file.contentType })
        res.end(readFileSync(file.path))
      } catch (error) {
        sendJson(res, { error: errorMessage(error) }, 500)
      }
    }
  )
}

function startServer(pi: ExtensionAPI): Promise<ServerState> {
  if (state) return Promise.resolve(state)
  if (startPromise) return startPromise

  const server = createPhoneServer(pi)
  startPromise = new Promise((resolve, reject) => {
    const fail = (error: Error) => {
      startPromise = null
      reject(error)
    }
    server.once("error", fail)
    server.listen(PORT, HOST, () => {
      server.off("error", fail)
      state = {
        server,
        port: PORT,
        token: newToken(),
        tokenExpiresAt: Date.now() + TOKEN_TTL_MS,
        clients: new Map(),
      }
      resolve(state)
    })
  })
  return startPromise
}

function stopServer(): Promise<void> {
  const current = state
  state = null
  startPromise = null
  return new Promise((resolve) => {
    if (!current) return resolve()
    for (const client of current.clients.values()) {
      clearInterval(client.heartbeat)
      client.res.end()
    }
    current.server.close(() => resolve())
  })
}

export default function phone(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    latestCtx = ctx
    feedItems = ctx.sessionManager.getBranch().map(entryView).filter(isFeedItem)
  })

  pi.on("message_end", (event, ctx) => {
    latestCtx = ctx
    const item = messageView(`${event.message.role}-${Date.now()}`, event.message)
    if (!item) return
    feedItems = [...feedItems, item].slice(-160)
    broadcast("snapshot", snapshot())
  })

  pi.on("agent_start", (_event, ctx) => {
    latestCtx = ctx
    broadcast("status", { idle: false })
  })

  pi.on("agent_end", (_event, ctx) => {
    latestCtx = ctx
    broadcast("snapshot", snapshot())
  })

  pi.on("tool_execution_start", (event) => {
    const item: FeedItem = {
      id: event.toolCallId,
      role: "tool",
      status: "running",
      text: toolText("running", event.toolName, event.args),
    }
    feedItems = [...feedItems, item].slice(-160)
    broadcast("snapshot", snapshot())
  })

  pi.on("tool_execution_end", (event) => {
    const status: ToolActivityStatus = event.isError ? "error" : "success"
    const icon = status === "success" ? "✓" : "✗"
    feedItems = feedItems.map((item) =>
      item.id === event.toolCallId && item.role === "tool"
        ? { ...item, status, text: item.text.replace(/^⚙︎/, icon) }
        : item
    )
    broadcast("snapshot", snapshot())
  })

  pi.on("session_shutdown", async () => {
    latestCtx = null
    await stopServer()
  })

  pi.registerCommand("phone-start", {
    description: "Start/show the phone handoff QR over Tailscale",
    handler: async (_args, ctx) => {
      latestCtx = ctx
      try {
        const running = await startServer(pi)
        refreshToken(running)
        const url = tailscaleUrl(running.port, running.token)
        const qr = await qrText(url)
        ctx.ui.notify(
          [
            "Pi phone handoff is ready over Tailscale.",
            `URL: ${url}`,
            `Token expires in ${Math.round(TOKEN_TTL_MS / 60_000)} minutes.`,
            "Use /phone-stop to shut it down.",
            "",
            qr,
          ].join("\n"),
          "info"
        )
      } catch (error) {
        ctx.ui.notify(`Could not start phone handoff: ${errorMessage(error)}`, "error")
      }
    },
  })

  pi.registerCommand("phone-stop", {
    description: "Stop the phone handoff server",
    handler: async (_args, ctx) => {
      await stopServer()
      ctx.ui.notify("Phone handoff server stopped", "info")
    },
  })
}
