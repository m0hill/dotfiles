/** @jsxRuntime automatic */
/** @jsxImportSource datastar-kit */

import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer as createHttpsServer } from "node:https"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import type { AgentMessage } from "@earendil-works/pi-agent-core"
import type { TextContent } from "@earendil-works/pi-ai"
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent"
import {
  event,
  get,
  js,
  local,
  mod,
  post,
  read,
  reply,
  state,
  unsafeHtml,
  type SignalState,
} from "datastar-kit"
import { bodyLimit } from "hono/body-limit"
import { getCookie, setCookie } from "hono/cookie"
import type { Context, Next } from "hono"
import { Hono } from "hono/tiny"
import MarkdownIt from "markdown-it"
import { Type, type Static, type TSchema } from "typebox"
import { ParseError, Value } from "typebox/value"

const execFileAsync = promisify(execFile)
const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false })
markdown.renderer.rules.link_open = (tokens, index, options, environment, renderer) => {
  tokens[index]?.attrSet("target", "_blank")
  tokens[index]?.attrSet("rel", "noreferrer noopener")
  return renderer.renderToken(tokens, index, options)
}

const PORT = 43_117
const HOST = "0.0.0.0"
const TOKEN_TTL_MS = 30 * 60 * 1_000
const TAILSCALE_DOMAIN = "mohil.tail47ab7d.ts.net"
const TAILSCALE_DATA_DIR = `${process.env.HOME ?? ""}/Library/Containers/io.tailscale.ipn.macos/Data`
const TAILSCALE_CERT = `${TAILSCALE_DATA_DIR}/${TAILSCALE_DOMAIN}.crt`
const TAILSCALE_KEY = `${TAILSCALE_DATA_DIR}/${TAILSCALE_DOMAIN}.key`
const QRENCODE = "/opt/homebrew/bin/qrencode"
const FFMPEG = "/opt/homebrew/bin/ffmpeg"
const STT_HELPER = `${process.env.HOME ?? ""}/Library/Application Support/Hammerspoon/STT/bin/stt-helper`
const MAX_AUDIO_BYTES = 25 * 1_024 * 1_024
const HELPER_MARKER = "__STT_JSON_B64__"
const PHONE_MODE_EVENT = "phone:mode"
const AUTH_COOKIE = "pi_phone"
const DATASTAR_RUNTIME =
  "https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.2/bundles/datastar.js"
const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url))

const phoneSignals = state({
  prompt: "",
  status: "Connecting…",
})

const sendMessageSchema = Type.Object({ prompt: Type.String() })
const sttHelperResultSchema = Type.Object({
  ok: Type.Optional(Type.Boolean()),
  text: Type.Optional(Type.String()),
  error: Type.Optional(Type.String()),
})
const toolSummarySchema = Type.Object({
  command: Type.Optional(Type.String()),
  path: Type.Optional(Type.String()),
  pattern: Type.Optional(Type.String()),
})

type SendMessage = Static<typeof sendMessageSchema>
type SttHelperResult = Static<typeof sttHelperResultSchema>
type ToolSummary = Static<typeof toolSummarySchema>
type ToolActivityStatus = "running" | "success" | "error"
type FeedRole = "user" | "assistant" | "tool"

type FeedItem = {
  readonly id: string
  readonly role: FeedRole
  readonly text: string
  readonly status?: ToolActivityStatus
}

type LatestContext = {
  readonly sessionManager: { getBranch(): SessionEntry[] }
  isIdle(): boolean
}

type ParseResult<T> =
  | { readonly _tag: "ok"; readonly value: T }
  | { readonly _tag: "error"; readonly message: string }

class ClientEvents implements AsyncIterable<string>, AsyncIterator<string> {
  private readonly queued: string[] = []
  private readonly waiting: Array<(result: IteratorResult<string>) => void> = []
  private closed = false

  push(chunk: string): void {
    if (this.closed) return
    const resolve = this.waiting.shift()
    if (resolve === undefined) this.queued.push(chunk)
    else resolve({ done: false, value: chunk })
  }

  next(): Promise<IteratorResult<string>> {
    const chunk = this.queued.shift()
    if (chunk !== undefined) return Promise.resolve({ done: false, value: chunk })
    if (this.closed) return Promise.resolve({ done: true, value: undefined })
    return new Promise((resolve) => this.waiting.push(resolve))
  }

  return(): Promise<IteratorResult<string>> {
    this.close()
    return Promise.resolve({ done: true, value: undefined })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const resolve of this.waiting.splice(0)) resolve({ done: true, value: undefined })
  }

  [Symbol.asyncIterator](): AsyncIterator<string> {
    return this
  }
}

type ServerState = {
  readonly server: ReturnType<typeof serve>
  readonly port: number
  token: string
  tokenExpiresAt: number
  readonly clients: Map<string, ClientEvents>
}

let runningServer: ServerState | undefined
let startPromise: Promise<ServerState> | undefined
let latestCtx: LatestContext | undefined
let feedItems: FeedItem[] = []

function parseSignals<const Schema extends TSchema>(
  schema: Schema,
  input: SignalState
): ParseResult<Static<Schema>> {
  try {
    return { _tag: "ok", value: Value.Parse(schema, input) }
  } catch (error) {
    if (error instanceof ParseError) return { _tag: "error", message: "Invalid request." }
    throw error
  }
}

function parseSendMessage(input: SignalState): ParseResult<SendMessage> {
  const parsed = parseSignals(sendMessageSchema, input)
  if (parsed._tag === "error") return parsed
  const prompt = parsed.value.prompt.trim()
  return prompt ? { _tag: "ok", value: { prompt } } : { _tag: "error", message: "Enter a message." }
}

function newToken(): string {
  return randomBytes(18).toString("base64url")
}

function refreshToken(server: ServerState): void {
  server.token = newToken()
  server.tokenExpiresAt = Date.now() + TOKEN_TTL_MS
}

function authorizeToken(token: string | undefined): boolean {
  const server = runningServer
  if (server === undefined || token !== server.token || Date.now() >= server.tokenExpiresAt) {
    return false
  }
  server.tokenExpiresAt = Date.now() + TOKEN_TTL_MS
  return true
}

function statusText(idle: boolean): string {
  return idle ? "Idle" : "Working…"
}

type ChatContent = Extract<AgentMessage, { role: "user" | "assistant" }>["content"]
type ChatContentBlock = Exclude<ChatContent, string>[number]

function isTextContent(block: ChatContentBlock): block is TextContent {
  return block.type === "text"
}

function textFromContent(content: ChatContent): string {
  if (!Array.isArray(content)) return content
  return content
    .filter(isTextContent)
    .map((block) => block.text)
    .join("\n")
}

function messageView(id: string, message: AgentMessage): FeedItem | undefined {
  if (message.role !== "user" && message.role !== "assistant") return undefined
  const text = textFromContent(message.content).trim()
  return text ? { id, role: message.role, text } : undefined
}

function entryView(entry: SessionEntry): FeedItem | undefined {
  return entry.type === "message" ? messageView(entry.id, entry.message) : undefined
}

function isFeedItem(item: FeedItem | undefined): item is FeedItem {
  return item !== undefined
}

function truncate(text: string, max = 96): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function toolSummary(toolName: string, args: ToolSummary): string {
  if (toolName === "bash") return truncate(args.command?.split("\n")[0]?.trim() ?? "bash")
  if (toolName === "read" || toolName === "write" || toolName === "edit") {
    return truncate(args.path ?? toolName)
  }
  if (toolName === "grep") return truncate(args.pattern ?? "grep")
  return toolName
}

function toolText(status: ToolActivityStatus, toolName: string, args: ToolSummary): string {
  const icon = status === "running" ? "⚙︎" : status === "success" ? "✓" : "✗"
  return `${icon} ${toolName} ${toolSummary(toolName, args)}`
}

function MessageFeed(props: { readonly items: readonly FeedItem[] }) {
  return (
    <main id="messages" aria-live="polite">
      {props.items.map((item) => (
        <article class={`message ${item.role}${item.status ? ` ${item.status}` : ""}`}>
          <div class="role">{item.role}</div>
          <div class="markdown">{unsafeHtml(markdown.render(item.text))}</div>
        </article>
      ))}
    </main>
  )
}

function PhonePage(props: { readonly idle: boolean }) {
  const connect = get("/events", {
    retry: "always",
    retryInterval: 750,
    retryScaler: 2,
    retryMaxWait: 30_000,
  })
  const sending = local<boolean>("sending")
  const sendDisabled = js<boolean>`${phoneSignals.refs.prompt}.trim() === "" || ${sending}`
  const sendLabel = js<string>`${sending} ? "Sending…" : "Send"`
  const submitShortcut = js<void>`if (evt.key === "Enter" && (evt.metaKey || evt.ctrlKey)) { evt.preventDefault(); el.form.requestSubmit() }`

  return (
    <div
      id="phone-app"
      data-signals={mod(
        { ...phoneSignals.defaults, status: statusText(props.idle) },
        { ifMissing: true }
      )}
    >
      <div id="phone-stream" data-init={connect} />
      <header class="app-header">
        <div class="app-header-content">
          <div class="app-identity">
            <span class="app-mark" aria-hidden="true">
              π
            </span>
            <div>
              <div class="app-title">Phone handoff</div>
              <div class="app-status" data-text={phoneSignals.refs.status} />
            </div>
          </div>
          <button class="button button-secondary" type="button" data-on:click={get("/api/state")}>
            Refresh
          </button>
        </div>
      </header>

      <div id="shell">
        <MessageFeed items={feedItems} />
      </div>

      <form
        id="composer"
        class="composer"
        data-indicator={sending}
        data-on:submit={post("/api/send")}
      >
        <textarea
          id="prompt"
          class="composer-input"
          rows={1}
          placeholder="Message Pi…"
          data-bind={phoneSignals.refs.prompt}
          data-on:keydown={submitShortcut}
        />
        <canvas id="waveform" aria-hidden="true" />
        <button
          id="mic"
          class="button icon-button"
          type="button"
          aria-label="Record voice"
          title="Record voice"
          data-on:click={js<void>`window.phone.toggleRecording()`}
        >
          <svg class="mic-icon mic-icon-record" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 14.5a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 0 0-7 0v5a3.5 3.5 0 0 0 3.5 3.5Z" />
            <path d="M5.75 10.75v.35a6.25 6.25 0 0 0 12.5 0v-.35" />
            <path d="M12 17.35v3" />
            <path d="M8.75 20.35h6.5" />
          </svg>
          <svg class="mic-icon mic-icon-stop" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="8" y="8" width="8" height="8" rx="1.5" />
          </svg>
        </button>
        <button
          id="send"
          class="button button-primary"
          type="submit"
          data-class:busy={sending}
          data-attr:disabled={sendDisabled}
        >
          <span data-text={sendLabel}>Send</span>
        </button>
      </form>
    </div>
  )
}

function phonePage(): Response {
  return reply.page(<PhonePage idle={latestCtx?.isIdle() ?? true} />, {
    title: "Pi Phone",
    head: [
      <meta name="viewport" content="width=device-width, initial-scale=1" />,
      <meta name="referrer" content="no-referrer" />,
      <link rel="stylesheet" href="/assets/style.css" />,
      <script type="module" src="/assets/client.js" />,
      <script type="module" src={DATASTAR_RUNTIME} />,
    ],
  })
}

function renderSnapshot(): string {
  return [
    event.signals(phoneSignals.patch({ status: statusText(latestCtx?.isIdle() ?? true) })),
    event.patch(<MessageFeed items={feedItems} />),
    event.script(
      'requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" }))'
    ),
  ].join("")
}

function broadcastSnapshot(): void {
  const chunk = renderSnapshot()
  for (const client of runningServer?.clients.values() ?? []) client.push(chunk)
}

function broadcastStatus(idle: boolean): void {
  const chunk = event.signals(phoneSignals.patch({ status: statusText(idle) }))
  for (const client of runningServer?.clients.values() ?? []) client.push(chunk)
}

function tailscaleUrl(port: number, token: string): string {
  return `https://${TAILSCALE_DOMAIN}:${port}/?token=${encodeURIComponent(token)}`
}

async function qrText(url: string): Promise<string> {
  const { stdout } = await execFileAsync(QRENCODE, ["-t", "UTF8i", "-m", "1", url], {
    timeout: 3_000,
  })
  return stdout
    .trimEnd()
    .split("\n")
    .map((line) => `\x1b[97m${line}\x1b[0m`)
    .join("\n")
}

function parseSttHelperOutput(stdout: string, stderr: string): SttHelperResult {
  const match = `${stdout}\n${stderr}`.match(new RegExp(`${HELPER_MARKER}([A-Za-z0-9+/=]+)`))
  const encoded = match?.[1]
  if (encoded === undefined) throw new Error("Could not parse STT helper output")
  const decoded = Buffer.from(encoded, "base64").toString("utf8")
  return Value.Parse(sttHelperResultSchema, JSON.parse(decoded))
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
    if (result.ok !== true) throw new Error(result.error ?? "Transcription failed")
    const text = result.text?.trim()
    if (!text) throw new Error("No speech detected in audio")
    return text
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function requireAuthorization(context: Context, next: Next): Promise<Response | void> {
  if (!authorizeToken(getCookie(context, AUTH_COOKIE))) {
    return context.json({ error: "Unauthorized or expired token" }, 401)
  }
  await next()
}

function createPhoneApp(pi: ExtensionAPI) {
  const app = new Hono()

  app.get("/assets/style.css", serveStatic({ path: join(EXTENSION_DIR, "style.css") }))
  app.get("/assets/client.js", serveStatic({ path: join(EXTENSION_DIR, "client.js") }))

  app.get("/", (context) => {
    const token = context.req.query("token")
    if (token !== undefined) {
      if (!authorizeToken(token)) return context.text("Unauthorized or expired token", 401)
      setCookie(context, AUTH_COOKIE, token, {
        httpOnly: true,
        maxAge: TOKEN_TTL_MS / 1_000,
        path: "/",
        sameSite: "Strict",
        secure: true,
      })
      return context.redirect("/")
    }
    return authorizeToken(getCookie(context, AUTH_COOKIE))
      ? phonePage()
      : context.text("Unauthorized or expired token", 401)
  })

  app.use("/events", requireAuthorization)
  app.use("/api/*", requireAuthorization)
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: MAX_AUDIO_BYTES,
      onError: (context) => context.json({ error: "Request body too large" }, 413),
    })
  )

  app.get("/events", (context) => {
    const id = randomBytes(8).toString("hex")
    const client = new ClientEvents()
    runningServer?.clients.set(id, client)
    client.push(renderSnapshot())
    context.req.raw.signal.addEventListener(
      "abort",
      () => {
        client.close()
        runningServer?.clients.delete(id)
      },
      { once: true }
    )
    return reply.stream(client, { heartbeat: { intervalMs: 15_000 } })
  })

  app.get("/api/state", () => reply.stream(renderSnapshot()))

  app.post("/api/transcribe", async (context) => {
    try {
      const audio = Buffer.from(await context.req.arrayBuffer())
      const text = await transcribeAudio(audio)
      return context.json({ ok: true, text })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return context.json({ error: message }, 400)
    }
  })

  app.post("/api/send", async (context) => {
    const parsed = parseSendMessage(await read.signals(context.req.raw))
    if (parsed._tag === "error") {
      return reply.signals(phoneSignals.patch({ status: parsed.message }))
    }
    if (latestCtx?.isIdle() ?? true) pi.sendUserMessage(parsed.value.prompt)
    else pi.sendUserMessage(parsed.value.prompt, { deliverAs: "followUp" })
    broadcastStatus(false)
    return reply.signals(phoneSignals.patch({ prompt: "", status: "Sent" }))
  })

  app.notFound((context) => context.json({ error: "Not found" }, 404))
  app.onError((error, context) => {
    console.error("Phone request failed", error)
    return context.json({ error: "Internal Server Error" }, 500)
  })
  return app
}

function startServer(pi: ExtensionAPI): Promise<ServerState> {
  if (runningServer !== undefined) return Promise.resolve(runningServer)
  if (startPromise !== undefined) return startPromise

  const app = createPhoneApp(pi)
  startPromise = new Promise((resolve, reject) => {
    const server = serve(
      {
        fetch: app.fetch,
        hostname: HOST,
        port: PORT,
        createServer: createHttpsServer,
        serverOptions: {
          cert: readFileSync(TAILSCALE_CERT),
          key: readFileSync(TAILSCALE_KEY),
        },
      },
      () => {
        server.off("error", fail)
        runningServer = {
          server,
          port: PORT,
          token: newToken(),
          tokenExpiresAt: Date.now() + TOKEN_TTL_MS,
          clients: new Map(),
        }
        resolve(runningServer)
      }
    )
    const fail = (error: Error) => {
      startPromise = undefined
      reject(error)
    }
    server.once("error", fail)
  })
  return startPromise
}

function stopServer(): Promise<void> {
  const current = runningServer
  runningServer = undefined
  startPromise = undefined
  for (const client of current?.clients.values() ?? []) client.close()
  if (current === undefined) return Promise.resolve()
  return new Promise((resolve) => current.server.close(() => resolve()))
}

/** Registers the server-driven phone handoff commands and session event projections. */
export default function phone(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    latestCtx = ctx
    feedItems = ctx.sessionManager.getBranch().map(entryView).filter(isFeedItem)
  })

  pi.on("message_end", (event, ctx) => {
    latestCtx = ctx
    const item = messageView(`${event.message.role}-${Date.now()}`, event.message)
    if (item === undefined) return
    feedItems = [...feedItems, item].slice(-160)
    broadcastSnapshot()
  })

  pi.on("agent_start", (_event, ctx) => {
    latestCtx = ctx
    broadcastStatus(false)
  })

  pi.on("agent_end", (_event, ctx) => {
    latestCtx = ctx
    broadcastSnapshot()
  })

  pi.on("tool_execution_start", (toolEvent) => {
    let args: ToolSummary = {}
    try {
      args = Value.Parse(toolSummarySchema, toolEvent.args)
    } catch (error) {
      if (!(error instanceof ParseError)) throw error
    }
    const item: FeedItem = {
      id: toolEvent.toolCallId,
      role: "tool",
      status: "running",
      text: toolText("running", toolEvent.toolName, args),
    }
    feedItems = [...feedItems, item].slice(-160)
    broadcastSnapshot()
  })

  pi.on("tool_execution_end", (toolEvent) => {
    const status: ToolActivityStatus = toolEvent.isError ? "error" : "success"
    const icon = status === "success" ? "✓" : "✗"
    feedItems = feedItems.map((item) =>
      item.id === toolEvent.toolCallId && item.role === "tool"
        ? { ...item, status, text: item.text.replace(/^⚙︎/, icon) }
        : item
    )
    broadcastSnapshot()
  })

  pi.on("session_shutdown", async () => {
    latestCtx = undefined
    await stopServer()
    pi.events.emit(PHONE_MODE_EVENT, { active: false })
  })

  pi.registerCommand("phone-start", {
    description: "Start/show the phone handoff QR over Tailscale",
    handler: async (_args, ctx) => {
      latestCtx = ctx
      try {
        const server = await startServer(pi)
        pi.events.emit(PHONE_MODE_EVENT, { active: true })
        refreshToken(server)
        const url = tailscaleUrl(server.port, server.token)
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
        const message = error instanceof Error ? error.message : String(error)
        ctx.ui.notify(`Could not start phone handoff: ${message}`, "error")
      }
    },
  })

  pi.registerCommand("phone-stop", {
    description: "Stop the phone handoff server",
    handler: async (_args, ctx) => {
      await stopServer()
      pi.events.emit(PHONE_MODE_EVENT, { active: false })
      ctx.ui.notify("Phone handoff server stopped", "info")
    },
  })
}
