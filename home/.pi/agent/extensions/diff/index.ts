import { spawn, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { join } from "node:path"
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent"

// Constants

const REQUEST_BODY_LIMIT_BYTES = 2_000_000
const GIT_MAX_BUFFER_BYTES = 50 * 1024 * 1024
const MAX_BRANCH_OPTIONS = 80

// Types

type WorktreeReviewSession = {
  id: string
  title: string
  mode: "worktree"
  patchPath: string
}

type CommitReviewSession = {
  id: string
  title: string
  mode: "commit"
  commit: string
  patchPath: string
}

type BaseReviewSession = {
  id: string
  title: string
  mode: "base"
  base: string
  patchPath: string
}

type ReviewSession = WorktreeReviewSession | CommitReviewSession | BaseReviewSession

type NewReviewSession =
  | { title: string; mode: "worktree"; patch: string }
  | { title: string; mode: "commit"; patch: string; commit: string }
  | { title: string; mode: "base"; patch: string; base: string }

type SelectionScope = "lines" | "file"

type ReviewAnnotation = {
  file: string
  scope: SelectionScope
  side?: string
  start?: number
  end?: number
  quote: string
  comment: string
}

type FeedbackPayload = {
  id: string
  annotations: ReviewAnnotation[]
  globalComment: string
}

type AskPayload = {
  id: string
  file: string
  scope: SelectionScope
  side?: string
  start?: number
  end?: number
  quote: string
  question: string
}

type StaticFile = {
  path: string
  contentType: string
}

declare const __dirname: string

// State

const sessions = new Map<string, ReviewSession>()
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

function optionalString(value: unknown): string | undefined {
  const text = stringValue(value).trim()
  return text || undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function parseJsonBody(body: string): unknown | null {
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

function notify(
  ctx: ExtensionCommandContext,
  message: string,
  level: "info" | "warning" | "error"
): void {
  if (ctx.hasUI) ctx.ui.notify(message, level)
  else if (level === "error") console.error(message)
  else console.log(message)
}

// Path/file helpers

function projectDir(ctx: ExtensionCommandContext): string {
  return join(ctx.cwd, ".pi-cache", "diff", "sessions")
}

function staticFile(root: string, pathname: string): StaticFile | null {
  if (pathname === "/" || pathname === "/index.html") {
    return { path: join(root, "index.html"), contentType: "text/html; charset=utf-8" }
  }
  if (pathname === "/dist/main.js") {
    return { path: join(root, "dist", "main.js"), contentType: "text/javascript; charset=utf-8" }
  }
  if (pathname === "/dist/main.css") {
    return { path: join(root, "dist", "main.css"), contentType: "text/css; charset=utf-8" }
  }
  return null
}

// Git helpers

function runGit(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: GIT_MAX_BUFFER_BYTES,
  })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error((result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim())
  return result.stdout
}

function parseLog(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

function branchOptions(ctx: ExtensionCommandContext): string[] {
  const branches = new Set<string>()
  function addBranches(args: string[]): void {
    try {
      for (const line of parseLog(runGit(ctx.cwd, args))) {
        branches.add(line.replace(/^refs\/remotes\//, ""))
      }
    } catch {
      // Ignore optional branch-discovery commands that fail outside normal git setups.
    }
  }

  addBranches(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
  addBranches([
    "for-each-ref",
    "--format=%(refname:short)",
    "--sort=-committerdate",
    "refs/remotes",
    "refs/heads",
  ])

  return [...branches].filter((branch) => !branch.endsWith("/HEAD")).slice(0, MAX_BRANCH_OPTIONS)
}

// Payload parsing

function parseScope(value: unknown): SelectionScope {
  return value === "file" ? "file" : "lines"
}

function parseAnnotation(value: unknown): ReviewAnnotation | undefined {
  if (!isRecord(value)) return undefined
  return {
    file: stringValue(value.file),
    scope: parseScope(value.scope),
    side: optionalString(value.side),
    start: optionalNumber(value.start),
    end: optionalNumber(value.end),
    quote: stringValue(value.quote),
    comment: stringValue(value.comment),
  }
}

function parseFeedbackPayload(body: string): FeedbackPayload | null {
  const value = parseJsonBody(body)
  if (!isRecord(value)) return null

  const id = stringValue(value.id).trim()
  if (!id) return null

  const annotations = Array.isArray(value.annotations)
    ? value.annotations
        .map(parseAnnotation)
        .filter((annotation): annotation is ReviewAnnotation => Boolean(annotation))
    : []

  return {
    id,
    annotations,
    globalComment: stringValue(value.globalComment),
  }
}

function parseAskPayload(body: string): AskPayload | null {
  const value = parseJsonBody(body)
  if (!isRecord(value)) return null

  const id = stringValue(value.id).trim()
  const question = stringValue(value.question).trim()
  if (!id || !question) return null

  return {
    id,
    file: stringValue(value.file),
    scope: parseScope(value.scope),
    side: optionalString(value.side),
    start: optionalNumber(value.start),
    end: optionalNumber(value.end),
    quote: stringValue(value.quote),
    question,
  }
}

// Session persistence

function writeSession(ctx: ExtensionCommandContext, opts: NewReviewSession): ReviewSession {
  const dir = projectDir(ctx)
  mkdirSync(dir, { recursive: true })
  const id = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const patchPath = join(dir, `${id}.patch`)
  writeFileSync(patchPath, opts.patch, "utf8")

  const session: ReviewSession =
    opts.mode === "commit"
      ? { id, title: opts.title, mode: "commit", commit: opts.commit, patchPath }
      : opts.mode === "base"
        ? { id, title: opts.title, mode: "base", base: opts.base, patchPath }
        : { id, title: opts.title, mode: "worktree", patchPath }

  sessions.set(id, session)
  return session
}

// Prompt construction

function locationText(
  selection: Pick<ReviewAnnotation, "file" | "scope" | "side" | "start" | "end">
): string {
  if (selection.scope === "file") return `${selection.file || "file"} entire file`
  return [
    selection.file,
    selection.side,
    selection.start
      ? `lines ${selection.start}${selection.end && selection.end !== selection.start ? `-${selection.end}` : ""}`
      : "",
  ]
    .filter(Boolean)
    .join(" ")
}

function feedbackText(session: ReviewSession, payload: FeedbackPayload): string {
  const annotations = payload.annotations
    .map((annotation) => ({
      ...annotation,
      quote: annotation.quote.trim(),
      comment: annotation.comment.trim(),
    }))
    .filter((annotation) => annotation.comment || annotation.quote)
  const lines = [`I reviewed the diff (${session.title}). Please address this feedback:`]

  annotations.forEach((annotation, index) => {
    lines.push("", `${index + 1}. ${locationText(annotation) || "Diff selection"}`)
    if (annotation.quote) lines.push("```diff", annotation.quote, "```")
    if (annotation.comment) lines.push("Comment:", annotation.comment)
  })

  const global = payload.globalComment.trim()
  if (global) lines.push("", "Global feedback:", global)
  return lines.join("\n").trim()
}

function askText(session: ReviewSession, payload: AskPayload): string {
  return [
    `Question about this diff selection (${session.title}):`,
    locationText(payload) ? `\nLocation: ${locationText(payload)}` : "",
    payload.quote.trim() ? `\n\`\`\`diff\n${payload.quote.trim()}\n\`\`\`` : "",
    `\nQuestion:\n${payload.question}`,
  ]
    .join("\n")
    .trim()
}

// HTTP helpers

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let body = ""
    req.setEncoding("utf8")
    req.on("data", (chunk) => {
      body += chunk
      if (body.length > REQUEST_BODY_LIMIT_BYTES) {
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
      if (req.method === "GET" && url.pathname === "/api/review") {
        const id = url.searchParams.get("id") ?? ""
        const session = sessions.get(id)
        if (!session) return sendJson(res, { error: "Unknown review" }, 404)
        return sendJson(res, { ...session, patch: readFileSync(session.patchPath, "utf8") })
      }

      if (req.method === "POST" && url.pathname === "/api/feedback") {
        const payload = parseFeedbackPayload(await readBody(req))
        if (!payload) return sendJson(res, { error: "Invalid feedback payload" }, 400)
        const session = sessions.get(payload.id)
        if (!session) return sendJson(res, { error: "Unknown review" }, 404)
        const message = feedbackText(session, payload)
        if (message) pi.sendUserMessage(message, { deliverAs: "followUp" })
        return sendJson(res, { ok: true })
      }

      if (req.method === "POST" && url.pathname === "/api/ask") {
        const payload = parseAskPayload(await readBody(req))
        if (!payload) return sendJson(res, { error: "Invalid ask payload" }, 400)
        const session = sessions.get(payload.id)
        if (!session) return sendJson(res, { error: "Unknown review" }, 404)
        pi.sendUserMessage(askText(session, payload), { deliverAs: "followUp" })
        return sendJson(res, {
          ok: true,
          message: "Question sent to Pi. Check the terminal for the answer.",
        })
      }

      if (req.method === "POST" && url.pathname === "/api/close") {
        return sendJson(res, { ok: true })
      }

      const file = staticFile(root, url.pathname)
      if (!file || !existsSync(file.path)) return sendJson(res, { error: "Not found" }, 404)
      return sendFile(res, file.path, file.contentType)
    } catch (err) {
      return sendJson(res, { error: errorMessage(err) }, 500)
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
        fail(new Error("Could not determine diff server port"))
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

// Browser/UI helpers

function openBrowser(url: string): void {
  spawn("open", [url], { detached: true, stdio: "ignore" }).unref()
}

async function openReview(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  session: ReviewSession
): Promise<void> {
  if (!existsSync(join(__dirname, "dist", "main.js"))) {
    notify(
      ctx,
      "diff UI is not built. Run pnpm install && pnpm build in ~/.pi/agent/extensions/diff.",
      "error"
    )
    return
  }

  const port = await startServer(pi)
  openBrowser(`http://127.0.0.1:${port}/?id=${encodeURIComponent(session.id)}`)
  notify(ctx, `Diff opened: ${session.title}`, "info")
}

async function chooseCommit(ctx: ExtensionCommandContext): Promise<string | undefined> {
  const items = parseLog(runGit(ctx.cwd, ["log", "--oneline", "-n", "40"]))
  const selected = await ctx.ui.select("Choose commit to review", items)
  return selected?.split(/\s+/)[0]
}

async function chooseBase(ctx: ExtensionCommandContext): Promise<string | undefined> {
  const items = branchOptions(ctx)
  if (!items.length) {
    notify(ctx, "No branches found to use as base.", "warning")
    return
  }
  return await ctx.ui.select("Choose base branch for PR-style review", items)
}

// Command handlers

async function openWorktreeReview(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const patch = runGit(ctx.cwd, ["diff", "HEAD", "--patch", "--find-renames", "--find-copies"])
  if (!patch.trim()) {
    notify(ctx, "No changes against HEAD.", "info")
    return
  }
  await openReview(
    pi,
    ctx,
    writeSession(ctx, { title: "Working tree vs HEAD", mode: "worktree", patch })
  )
}

async function openCommitReview(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const commit = await chooseCommit(ctx)
  if (!commit) return

  const patch = runGit(ctx.cwd, [
    "show",
    "--format=",
    "--patch",
    "--find-renames",
    "--find-copies",
    commit,
  ])
  if (!patch.trim()) {
    notify(ctx, "Commit has no patch.", "info")
    return
  }
  await openReview(
    pi,
    ctx,
    writeSession(ctx, { title: `Commit ${commit}`, mode: "commit", patch, commit })
  )
}

async function openBaseReview(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const base = await chooseBase(ctx)
  if (!base) return

  const patch = runGit(ctx.cwd, [
    "diff",
    `${base}...HEAD`,
    "--patch",
    "--find-renames",
    "--find-copies",
  ])
  if (!patch.trim()) {
    notify(ctx, `No changes against ${base}.`, "info")
    return
  }
  await openReview(
    pi,
    ctx,
    writeSession(ctx, { title: `HEAD vs ${base}`, mode: "base", patch, base })
  )
}

async function runCommand(
  ctx: ExtensionCommandContext,
  action: () => Promise<void>
): Promise<void> {
  try {
    await action()
  } catch (err) {
    notify(ctx, errorMessage(err), "error")
  }
}

// Extension entrypoint

export default function diff(pi: ExtensionAPI): void {
  pi.on("session_shutdown", async () => {
    await stopServer()
  })

  pi.registerCommand("diff", {
    description: "Review staged + unstaged changes",
    handler: async (_args, ctx) => {
      await runCommand(ctx, () => openWorktreeReview(pi, ctx))
    },
  })

  pi.registerCommand("diff-commit", {
    description: "Choose and review one commit",
    handler: async (_args, ctx) => {
      await runCommand(ctx, () => openCommitReview(pi, ctx))
    },
  })

  pi.registerCommand("diff-base", {
    description: "Choose a base branch and review branch diff",
    handler: async (_args, ctx) => {
      await runCommand(ctx, () => openBaseReview(pi, ctx))
    },
  })
}
