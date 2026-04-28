import { spawn, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { join } from "node:path"
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent"
import { Type, type Static, type TUnsafe } from "typebox"
import { Compile } from "typebox/compile"
import { parsePatchFiles, type AnnotationSide, type FileDiffMetadata } from "@pierre/diffs"

// Constants

const REQUEST_BODY_LIMIT_BYTES = 2_000_000
const GIT_MAX_BUFFER_BYTES = 50 * 1024 * 1024
const MAX_BRANCH_OPTIONS = 80

const ANCHOR_KINDS = ["line", "range", "file", "global"] as const
const REVIEW_CATEGORIES = [
  "bug",
  "risk",
  "question",
  "unnecessary",
  "style",
  "test",
  "positive",
  "context",
] as const
const REVIEW_SEVERITIES = ["info", "minor", "major", "critical"] as const
const REVIEW_CONFIDENCE = ["low", "medium", "high"] as const
const REVIEW_SIDES = ["additions", "deletions"] as const

// Types

type AiReviewStatus = "idle" | "running" | "done" | "error"

type ReviewCategory = (typeof REVIEW_CATEGORIES)[number]
type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number]
type ReviewConfidence = (typeof REVIEW_CONFIDENCE)[number]
type ReviewSide = (typeof REVIEW_SIDES)[number]

type GlobalReviewAnchor = { kind: "global" }
type FileReviewAnchor = { kind: "file"; file: string }
type LineReviewAnchor = { kind: "line"; file: string; side: ReviewSide; line: number }
type RangeReviewAnchor = {
  kind: "range"
  file: string
  side: ReviewSide
  start: number
  end: number
}

type ReviewAnchor = GlobalReviewAnchor | FileReviewAnchor | LineReviewAnchor | RangeReviewAnchor

type AiReviewComment = {
  id: string
  createdAt: number
  anchor: ReviewAnchor
  category: ReviewCategory
  severity: ReviewSeverity
  title: string
  body: string
  recommendation?: string
  confidence: ReviewConfidence
}

type AiReviewState = {
  status: AiReviewStatus
  comments: AiReviewComment[]
  summary?: string
  error?: string
}

type ReviewSessionBase = {
  id: string
  title: string
  patchPath: string
  command: string
  aiReview: AiReviewState
}

type WorktreeReviewSession = ReviewSessionBase & {
  mode: "worktree"
}

type CommitReviewSession = ReviewSessionBase & {
  mode: "commit"
  commit: string
}

type BaseReviewSession = ReviewSessionBase & {
  mode: "base"
  base: string
}

type ReviewSession = WorktreeReviewSession | CommitReviewSession | BaseReviewSession

type NewReviewSession =
  | { title: string; mode: "worktree"; patch: string; command: string }
  | { title: string; mode: "commit"; patch: string; commit: string; command: string }
  | { title: string; mode: "base"; patch: string; base: string; command: string }

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

function stringEnum<T extends readonly string[]>(
  values: T,
  options?: { description?: string }
): TUnsafe<T[number]> {
  return Type.Unsafe<T[number]>({ type: "string", enum: [...values], ...options })
}

const reviewCommentSchema = Type.Object({
  reviewId: Type.String({
    minLength: 1,
    pattern: ".*\\S.*",
    description: "Diff review id shown in the kickoff prompt.",
  }),
  anchorKind: stringEnum(ANCHOR_KINDS, {
    description:
      "Use global when the finding is caused by the diff but not tied to one changed line.",
  }),
  file: Type.Optional(
    Type.String({ description: "Diff file path for file, line, or range anchors." })
  ),
  side: Type.Optional(stringEnum(REVIEW_SIDES)),
  line: Type.Optional(
    Type.Integer({ minimum: 1, description: "Changed line number for line anchors." })
  ),
  start: Type.Optional(
    Type.Integer({ minimum: 1, description: "Start changed line number for range anchors." })
  ),
  end: Type.Optional(
    Type.Integer({ minimum: 1, description: "End changed line number for range anchors." })
  ),
  category: stringEnum(REVIEW_CATEGORIES),
  severity: stringEnum(REVIEW_SEVERITIES),
  title: Type.String({
    minLength: 1,
    pattern: ".*\\S.*",
    description: "Short review-comment title.",
  }),
  body: Type.String({
    minLength: 1,
    pattern: ".*\\S.*",
    description: "Concise explanation of the finding.",
  }),
  recommendation: Type.Optional(
    Type.String({ description: "Concrete suggested next step, if any." })
  ),
  confidence: stringEnum(REVIEW_CONFIDENCE),
})

type ReviewCommentInput = Static<typeof reviewCommentSchema>

const reviewDoneSchema = Type.Object({
  reviewId: Type.String({
    minLength: 1,
    pattern: ".*\\S.*",
    description: "Diff review id shown in the kickoff prompt.",
  }),
  summary: Type.String({
    minLength: 1,
    pattern: ".*\\S.*",
    description: "Final concise summary of the AI review.",
  }),
})

type ReviewDoneInput = Static<typeof reviewDoneSchema>

type AnchorValidationResult = { ok: true; anchor: ReviewAnchor } | { ok: false; reason: string }

const reviewAnnotationSchema = Type.Object({
  file: Type.String({ default: "" }),
  scope: Type.Optional(stringEnum(["lines", "file"] as const)),
  side: Type.Optional(Type.String()),
  start: Type.Optional(Type.Number()),
  end: Type.Optional(Type.Number()),
  quote: Type.String({ default: "" }),
  comment: Type.String({ default: "" }),
})

const feedbackPayloadSchema = Type.Object({
  id: Type.String({ minLength: 1, pattern: ".*\\S.*" }),
  annotations: Type.Array(reviewAnnotationSchema),
  globalComment: Type.String({ default: "" }),
})

type FeedbackPayloadInput = Static<typeof feedbackPayloadSchema>

const askPayloadSchema = Type.Object({
  id: Type.String({ minLength: 1, pattern: ".*\\S.*" }),
  file: Type.String({ default: "" }),
  scope: Type.Optional(stringEnum(["lines", "file"] as const)),
  side: Type.Optional(Type.String()),
  start: Type.Optional(Type.Number()),
  end: Type.Optional(Type.Number()),
  quote: Type.String({ default: "" }),
  question: Type.String({ minLength: 1, pattern: ".*\\S.*" }),
})

const feedbackPayloadValidator = Compile(feedbackPayloadSchema)
const askPayloadValidator = Compile(askPayloadSchema)

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

function optionalString(value: string | undefined): string | undefined {
  const text = value?.trim()
  return text || undefined
}

function optionalNumber(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) ? value : undefined
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

function normalizeAnnotation(
  annotation: FeedbackPayloadInput["annotations"][number]
): ReviewAnnotation {
  return {
    file: annotation.file,
    scope: annotation.scope ?? "lines",
    side: optionalString(annotation.side),
    start: optionalNumber(annotation.start),
    end: optionalNumber(annotation.end),
    quote: annotation.quote,
    comment: annotation.comment,
  }
}

function parseFeedbackPayload(body: string): FeedbackPayload | null {
  const value = parseJsonBody(body)
  if (!feedbackPayloadValidator.Check(value)) return null

  return {
    id: value.id.trim(),
    annotations: value.annotations.map(normalizeAnnotation),
    globalComment: value.globalComment,
  }
}

function parseAskPayload(body: string): AskPayload | null {
  const value = parseJsonBody(body)
  if (!askPayloadValidator.Check(value)) return null

  return {
    id: value.id.trim(),
    file: value.file,
    scope: value.scope ?? "lines",
    side: optionalString(value.side),
    start: optionalNumber(value.start),
    end: optionalNumber(value.end),
    quote: value.quote,
    question: value.question.trim(),
  }
}

// Session persistence

function writeSession(ctx: ExtensionCommandContext, opts: NewReviewSession): ReviewSession {
  const dir = projectDir(ctx)
  mkdirSync(dir, { recursive: true })
  const id = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const patchPath = join(dir, `${id}.patch`)
  writeFileSync(patchPath, opts.patch, "utf8")

  const aiReview: AiReviewState = { status: "idle", comments: [] }
  const session: ReviewSession =
    opts.mode === "commit"
      ? {
          id,
          title: opts.title,
          mode: "commit",
          commit: opts.commit,
          patchPath,
          command: opts.command,
          aiReview,
        }
      : opts.mode === "base"
        ? {
            id,
            title: opts.title,
            mode: "base",
            base: opts.base,
            patchPath,
            command: opts.command,
            aiReview,
          }
        : { id, title: opts.title, mode: "worktree", patchPath, command: opts.command, aiReview }

  sessions.set(id, session)
  return session
}

// AI review helpers

function integerValue(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isInteger(value) || value < 1) return undefined
  return value
}

function fileDisplayName(file: FileDiffMetadata): string {
  return file.name || file.prevName || "file"
}

function findDiffFile(session: ReviewSession, name: string): FileDiffMetadata | undefined {
  const files = parsePatchFiles(readFileSync(session.patchPath, "utf8"), session.id, false).flatMap(
    (patch) => patch.files
  )
  return files.find((file) => file.name === name || file.prevName === name)
}

function changedLineRanges(file: FileDiffMetadata, side: AnnotationSide): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  for (const hunk of file.hunks) {
    let additionLine = hunk.additionStart
    let deletionLine = hunk.deletionStart

    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        additionLine += content.lines
        deletionLine += content.lines
        continue
      }

      if (side === "additions" && content.additions > 0) {
        ranges.push([additionLine, additionLine + content.additions - 1])
      }
      if (side === "deletions" && content.deletions > 0) {
        ranges.push([deletionLine, deletionLine + content.deletions - 1])
      }
      additionLine += content.additions
      deletionLine += content.deletions
    }
  }
  return ranges
}

function rangeContains(ranges: Array<[number, number]>, start: number, end: number): boolean {
  return ranges.some(([rangeStart, rangeEnd]) => start >= rangeStart && end <= rangeEnd)
}

function rangeListText(ranges: Array<[number, number]>): string {
  if (!ranges.length) return "none"
  return ranges
    .map(([start, end]) => (start === end ? String(start) : `${start}-${end}`))
    .join(", ")
}

function validateReviewAnchor(
  session: ReviewSession,
  input: Pick<ReviewCommentInput, "anchorKind" | "file" | "side" | "line" | "start" | "end">
): AnchorValidationResult {
  if (input.anchorKind === "global") return { ok: true, anchor: { kind: "global" } }

  const requestedFile = (input.file ?? "").trim()
  if (!requestedFile) return { ok: false, reason: "file is required for this anchor kind." }

  const file = findDiffFile(session, requestedFile)
  if (!file) return { ok: false, reason: `${requestedFile} is not in this diff.` }

  const fileName = fileDisplayName(file)
  if (input.anchorKind === "file") return { ok: true, anchor: { kind: "file", file: fileName } }

  if (input.side !== "additions" && input.side !== "deletions") {
    return { ok: false, reason: "side must be additions or deletions for line/range anchors." }
  }

  const start = integerValue(input.anchorKind === "line" ? input.line : input.start)
  const end = integerValue(input.anchorKind === "line" ? input.line : input.end)
  if (start === undefined || end === undefined) {
    return { ok: false, reason: "valid positive integer line/start/end values are required." }
  }
  if (end < start) return { ok: false, reason: "range end must be greater than or equal to start." }

  const ranges = changedLineRanges(file, input.side)
  if (!rangeContains(ranges, start, end)) {
    return {
      ok: false,
      reason: `${fileName} ${input.side} ${start === end ? start : `${start}-${end}`} is not a changed line range in this diff. Valid changed ranges: ${rangeListText(ranges)}. Use a file/global anchor for contextual findings that are not tied to changed lines.`,
    }
  }

  return input.anchorKind === "line"
    ? { ok: true, anchor: { kind: "line", file: fileName, side: input.side, line: start } }
    : { ok: true, anchor: { kind: "range", file: fileName, side: input.side, start, end } }
}

function compactSessionMode(session: ReviewSession): string {
  if (session.mode === "commit") return `commit ${session.commit}`
  if (session.mode === "base") return `base ${session.base}`
  return "working tree vs HEAD"
}

function aiReviewPrompt(session: ReviewSession): string {
  return [
    `Review this diff session and leave PR-style comments in the diff UI.`,
    "",
    `Review id: ${session.id}`,
    `Mode: ${compactSessionMode(session)}`,
    `Title: ${session.title}`,
    `Exact patch snapshot shown in the browser: ${session.patchPath}`,
    `Patch command: ${session.command}`,
    "",
    "You may inspect the repository normally with the available tools to understand global context.",
    "Use diff_review_comment for each useful finding. Use diff_review_done when finished, even if there are no findings.",
    "Anchor comments to line/range/file only when the finding is directly tied to the diff. Use a global anchor for findings caused by the diff but not located on a changed line.",
    "For line/range anchors, use line numbers from the additions or deletions side of the patch.",
    "Keep comments concise, actionable, non-duplicative, and honest about uncertainty.",
    "This is a review task; focus on inspecting and commenting rather than changing files.",
  ].join("\n")
}

async function maybeStartAiReview(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  session: ReviewSession
): Promise<void> {
  if (!ctx.hasUI) return
  const wantsReview = await ctx.ui.confirm(
    "AI Review",
    "Run AI review agent for this diff? Comments will stream into the diff UI."
  )
  if (!wantsReview) return

  session.aiReview = { status: "running", comments: [] }
  const prompt = aiReviewPrompt(session)
  if (ctx.isIdle()) pi.sendUserMessage(prompt)
  else pi.sendUserMessage(prompt, { deliverAs: "followUp" })
  notify(ctx, "AI review started. Watch the diff UI for comments.", "info")
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

      if (req.method === "GET" && url.pathname === "/api/ai-review") {
        const id = url.searchParams.get("id") ?? ""
        const session = sessions.get(id)
        if (!session) return sendJson(res, { error: "Unknown review" }, 404)
        return sendJson(res, session.aiReview)
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
  const command = "git diff HEAD --patch --find-renames --find-copies"
  const patch = runGit(ctx.cwd, ["diff", "HEAD", "--patch", "--find-renames", "--find-copies"])
  if (!patch.trim()) {
    notify(ctx, "No changes against HEAD.", "info")
    return
  }
  const session = writeSession(ctx, {
    title: "Working tree vs HEAD",
    mode: "worktree",
    patch,
    command,
  })
  await openReview(pi, ctx, session)
  await maybeStartAiReview(pi, ctx, session)
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
  const session = writeSession(ctx, {
    title: `Commit ${commit}`,
    mode: "commit",
    patch,
    commit,
    command: `git show --format= --patch --find-renames --find-copies ${commit}`,
  })
  await openReview(pi, ctx, session)
  await maybeStartAiReview(pi, ctx, session)
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
  const session = writeSession(ctx, {
    title: `HEAD vs ${base}`,
    mode: "base",
    patch,
    base,
    command: `git diff ${base}...HEAD --patch --find-renames --find-copies`,
  })
  await openReview(pi, ctx, session)
  await maybeStartAiReview(pi, ctx, session)
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

  pi.on("agent_end", async () => {
    for (const session of sessions.values()) {
      if (session.aiReview.status === "running") {
        session.aiReview.status = "done"
        session.aiReview.summary ||= "AI review finished without a final summary."
      }
    }
  })

  pi.registerTool({
    name: "diff_review_comment",
    label: "Diff Review Comment",
    description: "Leave a PR-style comment on an open diff review session.",
    promptSnippet: "Leave PR-style comments on the active diff review UI.",
    promptGuidelines: [
      "Use diff_review_comment to leave concise, actionable comments during a diff review task.",
      "Use a global diff_review_comment anchor for findings caused by the diff but not tied to a changed line.",
    ],
    parameters: reviewCommentSchema,
    async execute(_toolCallId, params: ReviewCommentInput) {
      const reviewId = params.reviewId.trim()
      const session = sessions.get(reviewId)
      if (!session) throw new Error(`Unknown diff review id: ${reviewId}`)

      const validation = validateReviewAnchor(session, params)
      if (!validation.ok) throw new Error(validation.reason)

      const title = params.title.trim()
      const body = params.body.trim()
      if (!title) throw new Error("title is required")
      if (!body) throw new Error("body is required")

      if (session.aiReview.status === "idle") session.aiReview.status = "running"
      session.aiReview.comments.push({
        id: randomUUID(),
        createdAt: Date.now(),
        anchor: validation.anchor,
        category: params.category,
        severity: params.severity,
        title,
        body,
        recommendation: optionalString(params.recommendation),
        confidence: params.confidence,
      })

      return {
        content: [{ type: "text", text: `Added diff review comment: ${title}` }],
        details: { reviewId, commentCount: session.aiReview.comments.length },
      }
    },
  })

  pi.registerTool({
    name: "diff_review_done",
    label: "Diff Review Done",
    description: "Mark an open AI diff review as complete with a final summary.",
    promptSnippet: "Finish an AI diff review after leaving comments.",
    promptGuidelines: [
      "Use diff_review_done when a diff review task is finished, even with no findings.",
    ],
    parameters: reviewDoneSchema,
    async execute(_toolCallId, params: ReviewDoneInput) {
      const reviewId = params.reviewId.trim()
      const session = sessions.get(reviewId)
      if (!session) throw new Error(`Unknown diff review id: ${reviewId}`)

      session.aiReview.status = "done"
      session.aiReview.summary = params.summary.trim() || "AI review complete."
      session.aiReview.error = undefined

      return {
        content: [{ type: "text", text: `Marked diff review ${reviewId} as done.` }],
        details: { reviewId, commentCount: session.aiReview.comments.length },
        terminate: true,
      }
    },
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
