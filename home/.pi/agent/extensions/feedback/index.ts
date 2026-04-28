import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { basename, join, resolve } from "node:path"
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  SessionEntry,
  SessionMessageEntry,
} from "@mariozechner/pi-coding-agent"
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai"

// Types

type LastFeedbackSession = {
  id: string
  title: string
  kind: "last"
  markdownPath: string
}

type FileFeedbackSession = {
  id: string
  title: string
  kind: "file"
  sourcePath: string
  markdownPath: string
}

type FeedbackSession = LastFeedbackSession | FileFeedbackSession

type NewFeedbackSession =
  | { title: string; kind: "last"; markdown: string }
  | { title: string; kind: "file"; markdown: string; sourcePath: string }

type SubmittedAnnotation = {
  quote: string
  comment: string
}

type SubmitPayload = {
  id: string
  annotations: SubmittedAnnotation[]
  globalComment: string
}

type StaticFile = {
  path: string
  contentType: string
}

declare const __dirname: string

// State

const sessions = new Map<string, FeedbackSession>()
let server: ReturnType<typeof createServer> | null = null
let serverPort: number | null = null
let serverStart: Promise<number> | null = null

// Generic helpers

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

// Path helpers

function projectDir(ctx: ExtensionCommandContext): string {
  return join(ctx.cwd, ".pi-cache", "feedback", "sessions")
}

function safeName(input: string): string {
  return (
    input
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "doc"
  )
}

function resolveUserPath(ctx: ExtensionCommandContext, input: string): string {
  const cleaned = input.trim().replace(/^@/, "")
  return resolve(ctx.cwd, cleaned)
}

function staticFile(root: string, pathname: string): StaticFile | null {
  if (pathname === "/" || pathname === "/index.html") {
    return { path: join(root, "index.html"), contentType: "text/html; charset=utf-8" }
  }
  if (pathname === "/main.js") {
    return { path: join(root, "main.js"), contentType: "text/javascript; charset=utf-8" }
  }
  if (pathname === "/style.css") {
    return { path: join(root, "style.css"), contentType: "text/css; charset=utf-8" }
  }
  return null
}

// Payload parsing

function parseSubmitPayload(body: string): SubmitPayload | null {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return null
  }

  if (!isRecord(value)) return null

  const id = stringValue(value.id).trim()
  if (!id) return null

  const annotations = Array.isArray(value.annotations)
    ? value.annotations.filter(isRecord).map((annotation) => ({
        quote: stringValue(annotation.quote),
        comment: stringValue(annotation.comment),
      }))
    : []

  return {
    id,
    annotations,
    globalComment: stringValue(value.globalComment),
  }
}

// Session extraction

function isAssistantMessageEntry(
  entry: SessionEntry
): entry is SessionMessageEntry & { message: AssistantMessage } {
  return entry.type === "message" && entry.message.role === "assistant"
}

function isTextContent(block: AssistantMessage["content"][number]): block is TextContent {
  return block.type === "text"
}

function textFromAssistant(message: AssistantMessage): string {
  return message.content
    .filter(isTextContent)
    .map((block) => block.text)
    .join("\n\n")
    .trim()
}

function lastAssistantText(ctx: ExtensionCommandContext): string | null {
  const branch = ctx.sessionManager.getBranch()
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i]
    if (!isAssistantMessageEntry(entry)) continue
    const text = textFromAssistant(entry.message)
    if (text) return text
  }
  return null
}

// Session persistence

function writeSession(ctx: ExtensionCommandContext, opts: NewFeedbackSession): FeedbackSession {
  const dir = projectDir(ctx)
  mkdirSync(dir, { recursive: true })
  const id = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const markdownPath = join(dir, `${safeName(opts.title)}-${id}.md`)
  writeFileSync(markdownPath, opts.markdown, "utf8")

  const session: FeedbackSession =
    opts.kind === "file"
      ? {
          id,
          title: opts.title,
          kind: "file",
          sourcePath: opts.sourcePath,
          markdownPath,
        }
      : {
          id,
          title: opts.title,
          kind: "last",
          markdownPath,
        }

  sessions.set(id, session)
  return session
}

// Feedback formatting

function buildFeedback(session: FeedbackSession, payload: SubmitPayload): string {
  const annotations = payload.annotations
    .map((annotation) => ({ quote: annotation.quote.trim(), comment: annotation.comment.trim() }))
    .filter((annotation) => annotation.quote || annotation.comment)
  const globalComment = payload.globalComment.trim()
  const source = session.kind === "file" ? `file ${session.sourcePath}` : "your previous response"
  const lines = [`I annotated ${source}. Please address this feedback:`]

  annotations.forEach((annotation, index) => {
    lines.push("", `${index + 1}. Regarding:`)
    if (annotation.quote) {
      lines.push(...annotation.quote.split("\n").map((line) => `> ${line}`))
    } else {
      lines.push("> [no exact quote captured]")
    }
    if (annotation.comment) lines.push("", "Comment:", annotation.comment)
  })

  if (globalComment) lines.push("", "Global feedback:", globalComment)
  return lines.join("\n").trim()
}

// HTTP helpers

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let body = ""
    req.setEncoding("utf8")
    req.on("data", (chunk) => {
      body += chunk
      if (body.length > 2_000_000) {
        req.destroy()
        reject(new Error("Request body too large"))
      }
    })
    req.on("end", () => resolveBody(body))
    req.on("error", reject)
  })
}

function sendJson(res: ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(value))
}

function sendFile(res: ServerResponse, path: string, contentType: string): void {
  res.writeHead(200, { "content-type": contentType })
  res.end(readFileSync(path))
}

// Server lifecycle

function startServer(pi: ExtensionAPI): Promise<number> {
  if (serverPort !== null) return Promise.resolve(serverPort)
  if (serverStart) return serverStart

  const root = __dirname
  const httpServer = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1")
      if (req.method === "GET" && url.pathname === "/api/doc") {
        const id = url.searchParams.get("id") ?? ""
        const session = sessions.get(id)
        if (!session) return sendJson(res, { error: "Unknown session" }, 404)
        sendJson(res, {
          id: session.id,
          title: session.title,
          kind: session.kind,
          sourcePath: session.kind === "file" ? session.sourcePath : undefined,
          markdown: readFileSync(session.markdownPath, "utf8"),
        })
        return
      }
      if (req.method === "POST" && url.pathname === "/api/submit") {
        const payload = parseSubmitPayload(await readBody(req))
        if (!payload) return sendJson(res, { error: "Invalid feedback payload" }, 400)
        const session = sessions.get(payload.id)
        if (!session) return sendJson(res, { error: "Unknown session" }, 404)
        const feedback = buildFeedback(session, payload)
        if (feedback) pi.sendUserMessage(feedback, { deliverAs: "followUp" })
        sendJson(res, { ok: true })
        return
      }
      if (req.method === "POST" && url.pathname === "/api/close") {
        sendJson(res, { ok: true })
        return
      }

      const file = staticFile(root, url.pathname)
      if (!file || !existsSync(file.path)) {
        sendJson(res, { error: "Not found" }, 404)
        return
      }
      sendFile(res, file.path, file.contentType)
    } catch (err) {
      sendJson(res, { error: errorMessage(err) }, 500)
    }
  })

  server = httpServer
  serverStart = new Promise((resolvePort, reject) => {
    const fail = (error: Error) => {
      if (server === httpServer) {
        server = null
        serverPort = null
        serverStart = null
      }
      reject(error)
    }

    httpServer.once("error", fail)
    httpServer.listen(0, "127.0.0.1", () => {
      httpServer.off("error", fail)
      const address = httpServer.address()
      if (!address || typeof address !== "object") {
        fail(new Error("Could not determine feedback server port"))
        return
      }
      serverPort = address.port
      resolvePort(address.port)
    })
  })

  return serverStart
}

function stopServer(): Promise<void> {
  const current = server
  server = null
  serverPort = null
  serverStart = null

  return new Promise((resolveStop) => {
    if (!current) {
      sessions.clear()
      resolveStop()
      return
    }

    current.close(() => {
      sessions.clear()
      resolveStop()
    })
  })
}

// Browser helpers

function openBrowser(url: string): void {
  spawn("open", [url], { detached: true, stdio: "ignore" }).unref()
}

async function openSession(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  session: FeedbackSession
): Promise<void> {
  const port = await startServer(pi)
  openBrowser(`http://127.0.0.1:${port}/?id=${encodeURIComponent(session.id)}`)
  ctx.ui.notify(`Feedback opened: ${session.title}`, "info")
}

// Extension entrypoint

export default function feedback(pi: ExtensionAPI): void {
  pi.on("session_shutdown", async () => {
    await stopServer()
  })

  pi.registerCommand("feedback-last", {
    description: "Open the last assistant message in a browser feedback tool",
    handler: async (_args, ctx) => {
      try {
        const markdown = lastAssistantText(ctx)
        if (!markdown) {
          ctx.ui.notify("No assistant text message found.", "warning")
          return
        }
        const session = writeSession(ctx, { title: "last-response", kind: "last", markdown })
        await openSession(pi, ctx, session)
      } catch (err) {
        ctx.ui.notify(`Could not open feedback: ${errorMessage(err)}`, "error")
      }
    },
  })

  pi.registerCommand("feedback-file", {
    description: "Open a markdown/text file in a browser feedback tool",
    handler: async (args, ctx) => {
      const inputPath = args.trim()
      if (!inputPath) {
        ctx.ui.setEditorText("/feedback-file ")
        ctx.ui.notify("Pick a file after /feedback-file, then submit again.", "info")
        return
      }

      try {
        const filePath = resolveUserPath(ctx, inputPath)
        const markdown = readFileSync(filePath, "utf8")
        const session = writeSession(ctx, {
          title: basename(filePath),
          kind: "file",
          markdown,
          sourcePath: filePath,
        })
        await openSession(pi, ctx, session)
      } catch (err) {
        ctx.ui.notify(`Could not open feedback: ${errorMessage(err)}`, "error")
      }
    },
  })
}
