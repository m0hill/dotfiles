import { spawn, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { join } from "node:path"
import { type ExtensionAPI, type ExtensionCommandContext } from "@mariozechner/pi-coding-agent"
import { Type, type Static, type TUnsafe } from "typebox"
import { Compile } from "typebox/compile"
import { parsePatchFiles, type AnnotationSide, type FileDiffMetadata } from "@pierre/diffs"

// Constants

const REQUEST_BODY_LIMIT_BYTES = 2_000_000
const GIT_MAX_BUFFER_BYTES = 50 * 1024 * 1024
const MAX_BRANCH_OPTIONS = 80
const TOP_BASE_BRANCH_OPTIONS = 10

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

type AnalysisProgress = {
  startedAt?: number
  finishedAt?: number
  lastActivityAt?: number
  currentTool?: string
  toolCount: number
  recentTools: Array<{ tool: string; args?: string; at: number }>
  recentOutput: string[]
  usage: {
    turns: number
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    cost: number
  }
}

type AiReviewState = AnalysisProgress & {
  status: AiReviewStatus
  comments: AiReviewComment[]
  summary?: string
  error?: string
}

type SummaryBlock = {
  id: string
  createdAt: number
  file: string
  side: ReviewSide
  start: number
  end: number
  title: string
  summary: string
}

type SummaryFile = {
  id: string
  createdAt: number
  file: string
  summary: string
}

type SummaryState = AnalysisProgress & {
  status: AiReviewStatus
  tldr?: string
  developerIntent?: string
  implementationFlow: string[]
  suggestedReviewFlow: string[]
  files: SummaryFile[]
  blocks: SummaryBlock[]
  error?: string
}

type ReviewSessionBase = {
  id: string
  title: string
  patchPath: string
  command: string
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

const summaryTldrSchema = Type.Object({
  reviewId: Type.String({ minLength: 1, pattern: ".*\\S.*" }),
  tldr: Type.String({ minLength: 1, pattern: ".*\\S.*" }),
  developerIntent: Type.String({ minLength: 1, pattern: ".*\\S.*" }),
  implementationFlow: Type.Optional(Type.Array(Type.String({ minLength: 1, pattern: ".*\\S.*" }))),
  suggestedReviewFlow: Type.Optional(Type.Array(Type.String({ minLength: 1, pattern: ".*\\S.*" }))),
})

type SummaryTldrInput = Static<typeof summaryTldrSchema>

const summaryFileSchema = Type.Object({
  reviewId: Type.String({ minLength: 1, pattern: ".*\\S.*" }),
  file: Type.String({ minLength: 1, pattern: ".*\\S.*" }),
  summary: Type.String({ minLength: 1, pattern: ".*\\S.*" }),
})

type SummaryFileInput = Static<typeof summaryFileSchema>

const summaryBlockSchema = Type.Object({
  reviewId: Type.String({ minLength: 1, pattern: ".*\\S.*" }),
  file: Type.String({ minLength: 1, pattern: ".*\\S.*" }),
  side: stringEnum(REVIEW_SIDES),
  start: Type.Integer({ minimum: 1 }),
  end: Type.Integer({ minimum: 1 }),
  title: Type.String({ minLength: 1, pattern: ".*\\S.*" }),
  summary: Type.String({ minLength: 1, pattern: ".*\\S.*" }),
})

type SummaryBlockInput = Static<typeof summaryBlockSchema>

const summaryDoneSchema = Type.Object({
  reviewId: Type.String({ minLength: 1, pattern: ".*\\S.*" }),
})

type SummaryDoneInput = Static<typeof summaryDoneSchema>

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
  return projectDirForCwd(ctx.cwd)
}

function projectDirForCwd(cwd: string): string {
  return join(cwd, ".pi-cache", "diff", "sessions")
}

function patchPathFor(cwd: string, id: string): string {
  return join(projectDirForCwd(cwd), `${id}.patch`)
}

function sessionPathFor(cwd: string, id: string): string {
  return join(projectDirForCwd(cwd), `${id}.json`)
}

function summaryPathFor(cwd: string, id: string): string {
  return join(projectDirForCwd(cwd), `${id}.summary.json`)
}

function reviewPathFor(cwd: string, id: string): string {
  return join(projectDirForCwd(cwd), `${id}.review.json`)
}

function summaryPathForSession(session: ReviewSession): string {
  return session.patchPath.replace(/\.patch$/, ".summary.json")
}

function reviewPathForSession(session: ReviewSession): string {
  return session.patchPath.replace(/\.patch$/, ".review.json")
}

function artifactPathFor(
  cwd: string,
  id: string,
  kind: "summary" | "review",
  suffix: string
): string {
  return join(projectDirForCwd(cwd), `${id}.${kind}.${suffix}`)
}

function emptyProgress(startedAt?: number): AnalysisProgress {
  return {
    startedAt,
    lastActivityAt: startedAt,
    toolCount: 0,
    recentTools: [],
    recentOutput: [],
    usage: { turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
  }
}

function emptyReviewState(status: AiReviewStatus = "idle"): AiReviewState {
  return { status, comments: [], ...emptyProgress(status === "running" ? Date.now() : undefined) }
}

function emptySummaryState(status: AiReviewStatus = "idle"): SummaryState {
  return {
    status,
    implementationFlow: [],
    suggestedReviewFlow: [],
    files: [],
    blocks: [],
    ...emptyProgress(status === "running" ? Date.now() : undefined),
  }
}

function atomicWriteJson(path: string, value: unknown): void {
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8")
  renameSync(tempPath, path)
}

function readJsonFile<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T
  } catch {
    return fallback
  }
}

function readSessionFromDisk(cwd: string, id: string): ReviewSession | undefined {
  const session = readJsonFile<ReviewSession | null>(sessionPathFor(cwd, id), null)
  return session ?? undefined
}

function readSummaryState(cwd: string, id: string): SummaryState {
  return readJsonFile(summaryPathFor(cwd, id), emptySummaryState())
}

function writeSummaryState(cwd: string, id: string, state: SummaryState): void {
  atomicWriteJson(summaryPathFor(cwd, id), state)
}

function readReviewState(cwd: string, id: string): AiReviewState {
  return readJsonFile(reviewPathFor(cwd, id), emptyReviewState())
}

function writeReviewState(cwd: string, id: string, state: AiReviewState): void {
  atomicWriteJson(reviewPathFor(cwd, id), state)
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

function gitOutputOrUndefined(cwd: string, args: string[]): string | undefined {
  try {
    return runGit(cwd, args).trim()
  } catch {
    return undefined
  }
}

function currentBranch(ctx: ExtensionCommandContext): string | undefined {
  const branch = gitOutputOrUndefined(ctx.cwd, ["rev-parse", "--abbrev-ref", "HEAD"])
  return branch && branch !== "HEAD" ? branch : undefined
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

  addBranches([
    "for-each-ref",
    "--format=%(refname:short)",
    "--sort=-committerdate",
    "refs/remotes",
    "refs/heads",
  ])

  const branch = currentBranch(ctx)
  const upstream = gitOutputOrUndefined(ctx.cwd, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{u}",
  ])

  const priority = [
    "origin/main",
    "main",
    "origin/master",
    "master",
    ...(branch ? [`origin/${branch}`, branch] : []),
    upstream,
  ].filter((branch): branch is string => Boolean(branch) && branches.has(branch))

  const dedupedPriority = [...new Set(priority)]
  const rest = [...branches].filter(
    (branch) => !branch.endsWith("/HEAD") && !dedupedPriority.includes(branch)
  )

  return [...dedupedPriority, ...rest].slice(0, MAX_BRANCH_OPTIONS)
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
  const patchPath = patchPathFor(ctx.cwd, id)
  writeFileSync(patchPath, opts.patch, "utf8")

  const session: ReviewSession =
    opts.mode === "commit"
      ? {
          id,
          title: opts.title,
          mode: "commit",
          commit: opts.commit,
          patchPath,
          command: opts.command,
        }
      : opts.mode === "base"
        ? {
            id,
            title: opts.title,
            mode: "base",
            base: opts.base,
            patchPath,
            command: opts.command,
          }
        : { id, title: opts.title, mode: "worktree", patchPath, command: opts.command }

  sessions.set(id, session)
  atomicWriteJson(sessionPathFor(ctx.cwd, id), session)
  writeSummaryState(ctx.cwd, id, emptySummaryState())
  writeReviewState(ctx.cwd, id, emptyReviewState())
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

function sharedAnalysisContext(session: ReviewSession): string[] {
  return [
    `Review id: ${session.id}`,
    `Mode: ${compactSessionMode(session)}`,
    `Title: ${session.title}`,
    `Exact patch snapshot shown in the browser: ${session.patchPath}`,
    `Patch command: ${session.command}`,
  ]
}

function summaryPrompt(session: ReviewSession): string {
  return [
    "You are the summary subagent for a diff UI.",
    "Your job is to help the human reviewer understand what was implemented, the likely developer intent, the flow of the change, and a suggested order for reviewing it.",
    "Post useful results as soon as you have them; do not wait until the end.",
    "",
    ...sharedAnalysisContext(session),
    "",
    "Use diff_summary_tldr first with: a concise TLDR, the likely developer intent, implementation flow, and suggested review flow.",
    "Use diff_summary_file for changed files that deserve their own explanation.",
    "Use diff_summary_block for meaningful changed blocks and anchor them to additions/deletions line ranges from the patch.",
    "It is okay to mention obvious risks or correctness concerns when they help explain the change.",
    "Avoid noisy summaries for trivial one-line changes. Group related adjacent changes.",
    "Call diff_summary_done when finished.",
  ].join("\n")
}

function reviewPrompt(session: ReviewSession): string {
  return [
    "You are the review subagent for a diff UI.",
    "Review this diff and leave concise PR-style comments.",
    "",
    ...sharedAnalysisContext(session),
    "",
    "You may inspect the repository normally with available tools to understand global context.",
    "Use diff_review_comment for each useful finding and diff_review_done when finished, even if there are no findings.",
    "Anchor comments to line/range/file only when the finding is directly tied to the diff.",
    "Use a global anchor for findings caused by the diff but not located on a changed line.",
    "For line/range anchors, use line numbers from the additions or deletions side of the patch.",
    "Keep comments actionable, non-duplicative, and honest about uncertainty.",
  ].join("\n")
}

function extractTextFromMessage(message: unknown): string[] {
  if (!message || typeof message !== "object" || !("content" in message)) return []
  const content = (message as { content?: unknown }).content
  if (typeof content === "string") return [content]
  if (!Array.isArray(content)) return []
  return content.flatMap((part) => {
    if (!part || typeof part !== "object" || !("type" in part)) return []
    return (part as { type?: unknown; text?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string"
      ? [(part as { text: string }).text]
      : []
  })
}

function toolArgsPreview(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined
  const json = JSON.stringify(args)
  return json.length > 120 ? `${json.slice(0, 120)}…` : json
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1]
  if (currentScript && existsSync(currentScript))
    return { command: process.execPath, args: [currentScript, ...args] }
  return { command: "pi", args }
}

function markAnalysisRunning(cwd: string, id: string, kind: "summary" | "review"): void {
  const startedAt = Date.now()
  if (kind === "summary") writeSummaryState(cwd, id, emptySummaryState("running"))
  else writeReviewState(cwd, id, emptyReviewState("running"))
  const state = kind === "summary" ? readSummaryState(cwd, id) : readReviewState(cwd, id)
  state.startedAt = startedAt
  state.lastActivityAt = startedAt
  if (kind === "summary") writeSummaryState(cwd, id, state as SummaryState)
  else writeReviewState(cwd, id, state as AiReviewState)
}

function updateAnalysisProgress(
  cwd: string,
  id: string,
  kind: "summary" | "review",
  update: (state: SummaryState | AiReviewState) => void
): void {
  const state = kind === "summary" ? readSummaryState(cwd, id) : readReviewState(cwd, id)
  update(state)
  state.lastActivityAt = Date.now()
  if (kind === "summary") writeSummaryState(cwd, id, state as SummaryState)
  else writeReviewState(cwd, id, state as AiReviewState)
}

function sessionContextForParent(session: ReviewSession): string {
  return [
    `Review id: ${session.id}`,
    `Title: ${session.title}`,
    `Mode: ${compactSessionMode(session)}`,
    `Patch command: ${session.command}`,
    `Patch snapshot path: ${session.patchPath}`,
  ].join("\n")
}

function diffSnapshotForParent(session: ReviewSession): string {
  const patch = readFileSync(session.patchPath, "utf8").trim()
  return patch ? `<diff>\n${patch}\n</diff>` : "<diff>\n(empty diff)\n</diff>"
}

function analysisContextMessage(session: ReviewSession, choice: string): string {
  return [
    "AI diff analysis started.",
    "",
    "Initial request:",
    `Generate ${choice.toLowerCase()} for the selected diff so the parent agent can continue discussing the changes, summaries, and review findings later.`,
    "",
    sessionContextForParent(session),
    "",
    "Exact diff snapshot reviewed by child agents:",
    diffSnapshotForParent(session),
  ].join("\n")
}

function formatSummaryBlock(block: SummaryBlock): string {
  return [
    `- ${block.file} ${block.side} lines ${block.start}-${block.end}: ${block.title}`,
    `  ${block.summary}`,
  ].join("\n")
}

function formatSummaryStateForParent(summary: SummaryState): string {
  const sections = [
    summary.tldr ? `TLDR:\n${summary.tldr}` : undefined,
    summary.developerIntent ? `Developer intent:\n${summary.developerIntent}` : undefined,
    summary.implementationFlow.length
      ? `Implementation flow:\n${summary.implementationFlow.map((line) => `- ${line}`).join("\n")}`
      : undefined,
    summary.suggestedReviewFlow.length
      ? `Suggested review flow:\n${summary.suggestedReviewFlow.map((line) => `- ${line}`).join("\n")}`
      : undefined,
    summary.files.length
      ? `File summaries:\n${summary.files.map((file) => `- ${file.file}: ${file.summary}`).join("\n")}`
      : undefined,
    summary.blocks.length
      ? `Block summaries:\n${summary.blocks.map(formatSummaryBlock).join("\n")}`
      : undefined,
    summary.error ? `Summary error:\n${summary.error}` : undefined,
  ].filter((section): section is string => Boolean(section))

  return sections.join("\n\n") || "No summary content was posted."
}

function reviewAnchorText(anchor: ReviewAnchor): string {
  switch (anchor.kind) {
    case "global":
      return "global"
    case "file":
      return anchor.file
    case "line":
      return `${anchor.file} ${anchor.side} line ${anchor.line}`
    case "range":
      return `${anchor.file} ${anchor.side} lines ${anchor.start}-${anchor.end}`
  }
}

function formatReviewComment(comment: AiReviewComment, index: number): string {
  return [
    `${index + 1}. [${comment.severity}/${comment.category}/${comment.confidence}] ${comment.title}`,
    `   Anchor: ${reviewAnchorText(comment.anchor)}`,
    `   Finding: ${comment.body}`,
    comment.recommendation ? `   Recommendation: ${comment.recommendation}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n")
}

function formatReviewStateForParent(review: AiReviewState): string {
  const severityCounts = REVIEW_SEVERITIES.map(
    (severity) =>
      `${severity}: ${review.comments.filter((comment) => comment.severity === severity).length}`
  ).join(", ")
  return [
    `Findings: ${review.comments.length} (${severityCounts})`,
    review.summary ? `Review summary:\n${review.summary}` : undefined,
    review.comments.length
      ? `Review comments:\n${review.comments.map(formatReviewComment).join("\n\n")}`
      : "Review comments:\n(none)",
    review.error ? `Review error:\n${review.error}` : undefined,
  ]
    .filter((section): section is string => Boolean(section))
    .join("\n\n")
}

function finishAnalysis(
  pi: ExtensionAPI,
  cwd: string,
  session: ReviewSession,
  kind: "summary" | "review",
  error?: string
): void {
  updateAnalysisProgress(cwd, session.id, kind, (state) => {
    state.status = error ? "error" : "done"
    state.finishedAt = Date.now()
    if (error) state.error = error
  })

  if (kind === "summary") {
    const summary = readSummaryState(cwd, session.id)
    pi.sendMessage({
      customType: "diff-summary-complete",
      display: true,
      content: [
        "AI diff summary completed.",
        "",
        sessionContextForParent(session),
        "",
        formatSummaryStateForParent(summary),
      ].join("\n"),
    })
    return
  }

  const review = readReviewState(cwd, session.id)
  pi.sendMessage({
    customType: "diff-review-complete",
    display: true,
    content: [
      "AI diff review completed.",
      "",
      sessionContextForParent(session),
      "",
      formatReviewStateForParent(review),
    ].join("\n"),
  })
}

function startAnalysisSubagent(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  session: ReviewSession,
  kind: "summary" | "review"
): void {
  const cwd = ctx.cwd
  markAnalysisRunning(cwd, session.id, kind)
  const prompt = kind === "summary" ? summaryPrompt(session) : reviewPrompt(session)
  const taskPath = artifactPathFor(cwd, session.id, kind, "task.md")
  const jsonlPath = artifactPathFor(cwd, session.id, kind, "jsonl")
  const outputPath = artifactPathFor(cwd, session.id, kind, "output.md")
  writeFileSync(taskPath, prompt, { encoding: "utf8", mode: 0o600 })
  writeFileSync(jsonlPath, "", "utf8")
  writeFileSync(outputPath, "", "utf8")

  const args = [
    "--mode",
    "json",
    "-p",
    "--no-session",
    "--no-extensions",
    "--extension",
    join(__dirname, "index.ts"),
  ]
  const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined
  if (model) args.push("--model", model)
  args.push(`@${taskPath}`)

  const invocation = getPiInvocation(args)
  const proc = spawn(invocation.command, invocation.args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  })
  let stdoutBuffer = ""
  let stderr = ""

  const processLine = (line: string): void => {
    if (!line.trim()) return
    appendFileSync(jsonlPath, `${line}\n`, "utf8")
    let event: { type?: string; toolName?: string; args?: unknown; message?: unknown }
    try {
      event = JSON.parse(line) as {
        type?: string
        toolName?: string
        args?: unknown
        message?: unknown
      }
    } catch {
      return
    }

    if (event.type === "tool_execution_start" && event.toolName) {
      updateAnalysisProgress(cwd, session.id, kind, (state) => {
        state.currentTool = event.toolName
        state.toolCount++
      })
    }

    if (event.type === "tool_execution_end" && event.toolName) {
      updateAnalysisProgress(cwd, session.id, kind, (state) => {
        state.recentTools.push({
          tool: event.toolName || "tool",
          args: toolArgsPreview(event.args),
          at: Date.now(),
        })
        state.recentTools = state.recentTools.slice(-10)
        state.currentTool = undefined
      })
    }

    if (event.type === "message_end" && event.message) {
      const text = extractTextFromMessage(event.message).join("\n").trim()
      if (text) {
        appendFileSync(outputPath, `${text}\n\n`, "utf8")
        updateAnalysisProgress(cwd, session.id, kind, (state) => {
          state.recentOutput.push(...text.split("\n").filter(Boolean).slice(-5))
          state.recentOutput = state.recentOutput.slice(-20)
        })
      }
      const usage = (event.message as { role?: string; usage?: Record<string, unknown> }).usage
      if ((event.message as { role?: string }).role === "assistant") {
        updateAnalysisProgress(cwd, session.id, kind, (state) => {
          state.usage.turns++
          state.usage.input += typeof usage?.input === "number" ? usage.input : 0
          state.usage.output += typeof usage?.output === "number" ? usage.output : 0
          state.usage.cacheRead += typeof usage?.cacheRead === "number" ? usage.cacheRead : 0
          state.usage.cacheWrite += typeof usage?.cacheWrite === "number" ? usage.cacheWrite : 0
          const cost = usage?.cost as { total?: unknown } | undefined
          state.usage.cost += typeof cost?.total === "number" ? cost.total : 0
        })
      }
    }
  }

  proc.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString()
    const lines = stdoutBuffer.split("\n")
    stdoutBuffer = lines.pop() ?? ""
    for (const line of lines) processLine(line)
  })
  proc.stderr.on("data", (chunk) => {
    stderr += chunk.toString()
  })
  proc.on("error", (error) => {
    finishAnalysis(pi, cwd, session, kind, errorMessage(error))
  })
  proc.on("close", (code) => {
    if (stdoutBuffer.trim()) processLine(stdoutBuffer)
    const failed =
      code !== 0 ? stderr.trim() || `${kind} subagent exited with code ${code}` : undefined
    finishAnalysis(pi, cwd, session, kind, failed)
  })
}

async function maybeStartAiAnalysis(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  session: ReviewSession
): Promise<void> {
  if (!ctx.hasUI) return
  const choice = await ctx.ui.select("AI Analysis", [
    "Summary + review",
    "Summary only",
    "Review only",
    "Skip",
  ])
  if (!choice || choice === "Skip") return

  pi.sendMessage({
    customType: "diff-analysis-context",
    display: false,
    content: analysisContextMessage(session, choice),
  })

  if (choice === "Summary + review" || choice === "Summary only") {
    startAnalysisSubagent(pi, ctx, session, "summary")
  }
  if (choice === "Summary + review" || choice === "Review only") {
    startAnalysisSubagent(pi, ctx, session, "review")
  }
  notify(ctx, `AI ${choice.toLowerCase()} started. Watch the diff UI for updates.`, "info")
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

      if (req.method === "GET" && url.pathname === "/api/summary") {
        const id = url.searchParams.get("id") ?? ""
        const session = sessions.get(id)
        if (!session) return sendJson(res, { error: "Unknown review" }, 404)
        return sendJson(res, readJsonFile(summaryPathForSession(session), emptySummaryState()))
      }

      if (req.method === "GET" && url.pathname === "/api/review-comments") {
        const id = url.searchParams.get("id") ?? ""
        const session = sessions.get(id)
        if (!session) return sendJson(res, { error: "Unknown review" }, 404)
        return sendJson(res, readJsonFile(reviewPathForSession(session), emptyReviewState()))
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
  const branches = branchOptions(ctx)
  if (!branches.length) {
    notify(ctx, "No branches found to use as base.", "warning")
    return
  }

  if (!ctx.hasUI) return branches[0]

  const topBranches = branches.slice(0, TOP_BASE_BRANCH_OPTIONS)
  if (branches.length <= TOP_BASE_BRANCH_OPTIONS) {
    return await ctx.ui.select("Choose base branch for PR-style review", topBranches)
  }

  const showMore = `Show all ${branches.length} branches…`
  const selected = await ctx.ui.select("Choose base branch for PR-style review", [
    ...topBranches,
    showMore,
  ])
  if (!selected || selected !== showMore) return selected

  return await ctx.ui.select("Choose base branch for PR-style review (all branches)", branches)
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
  await maybeStartAiAnalysis(pi, ctx, session)
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
  await maybeStartAiAnalysis(pi, ctx, session)
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
  await maybeStartAiAnalysis(pi, ctx, session)
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

function sessionForTool(cwd: string, reviewId: string): ReviewSession {
  const session = sessions.get(reviewId) ?? readSessionFromDisk(cwd, reviewId)
  if (!session) throw new Error(`Unknown diff review id: ${reviewId}`)
  return session
}

export default function diff(pi: ExtensionAPI): void {
  pi.on("session_shutdown", async () => {
    await stopServer()
  })

  pi.registerTool({
    name: "diff_summary_tldr",
    label: "Diff Summary TLDR",
    description:
      "Post the top-level TLDR, developer intent, implementation flow, and suggested review flow for a diff.",
    parameters: summaryTldrSchema,
    async execute(_toolCallId, params: SummaryTldrInput, _signal, _onUpdate, ctx) {
      const reviewId = params.reviewId.trim()
      sessionForTool(ctx.cwd, reviewId)
      const state = readSummaryState(ctx.cwd, reviewId)
      state.status = "running"
      state.tldr = params.tldr.trim()
      state.developerIntent = params.developerIntent.trim()
      state.implementationFlow =
        params.implementationFlow?.map((line) => line.trim()).filter(Boolean) ?? []
      state.suggestedReviewFlow =
        params.suggestedReviewFlow?.map((line) => line.trim()).filter(Boolean) ?? []
      state.lastActivityAt = Date.now()
      writeSummaryState(ctx.cwd, reviewId, state)
      return {
        content: [{ type: "text", text: "Posted diff TLDR summary." }],
        details: { reviewId },
      }
    },
  })

  pi.registerTool({
    name: "diff_summary_file",
    label: "Diff File Summary",
    description: "Post an explanatory summary for a changed file in the diff UI.",
    parameters: summaryFileSchema,
    async execute(_toolCallId, params: SummaryFileInput, _signal, _onUpdate, ctx) {
      const reviewId = params.reviewId.trim()
      const session = sessionForTool(ctx.cwd, reviewId)
      const file = findDiffFile(session, params.file.trim())
      if (!file) throw new Error(`${params.file} is not in this diff.`)
      const state = readSummaryState(ctx.cwd, reviewId)
      state.status = "running"
      const fileName = fileDisplayName(file)
      state.files.push({
        id: randomUUID(),
        createdAt: Date.now(),
        file: fileName,
        summary: params.summary.trim(),
      })
      state.lastActivityAt = Date.now()
      writeSummaryState(ctx.cwd, reviewId, state)
      return {
        content: [{ type: "text", text: `Posted summary for ${fileName}.` }],
        details: { reviewId },
      }
    },
  })

  pi.registerTool({
    name: "diff_summary_block",
    label: "Diff Block Summary",
    description: "Post an inline explanatory summary anchored to a changed code block.",
    parameters: summaryBlockSchema,
    async execute(_toolCallId, params: SummaryBlockInput, _signal, _onUpdate, ctx) {
      const reviewId = params.reviewId.trim()
      const session = sessionForTool(ctx.cwd, reviewId)
      const validation = validateReviewAnchor(session, {
        anchorKind: "range",
        file: params.file,
        side: params.side,
        start: params.start,
        end: params.end,
      })
      if (!validation.ok) throw new Error(validation.reason)
      if (validation.anchor.kind !== "range") throw new Error("Expected a range anchor.")
      const state = readSummaryState(ctx.cwd, reviewId)
      state.status = "running"
      state.blocks.push({
        id: randomUUID(),
        createdAt: Date.now(),
        file: validation.anchor.file,
        side: validation.anchor.side,
        start: validation.anchor.start,
        end: validation.anchor.end,
        title: params.title.trim(),
        summary: params.summary.trim(),
      })
      state.lastActivityAt = Date.now()
      writeSummaryState(ctx.cwd, reviewId, state)
      return {
        content: [{ type: "text", text: `Posted block summary: ${params.title.trim()}` }],
        details: { reviewId },
      }
    },
  })

  pi.registerTool({
    name: "diff_summary_done",
    label: "Diff Summary Done",
    description: "Mark the AI diff summary as complete.",
    parameters: summaryDoneSchema,
    async execute(_toolCallId, params: SummaryDoneInput, _signal, _onUpdate, ctx) {
      const reviewId = params.reviewId.trim()
      sessionForTool(ctx.cwd, reviewId)
      const state = readSummaryState(ctx.cwd, reviewId)
      state.status = "done"
      state.finishedAt = Date.now()
      state.lastActivityAt = Date.now()
      writeSummaryState(ctx.cwd, reviewId, state)
      return {
        content: [{ type: "text", text: `Marked diff summary ${reviewId} as done.` }],
        details: { reviewId },
      }
    },
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
    async execute(_toolCallId, params: ReviewCommentInput, _signal, _onUpdate, ctx) {
      const reviewId = params.reviewId.trim()
      const session = sessionForTool(ctx.cwd, reviewId)

      const validation = validateReviewAnchor(session, params)
      if (!validation.ok) throw new Error(validation.reason)

      const title = params.title.trim()
      const body = params.body.trim()
      if (!title) throw new Error("title is required")
      if (!body) throw new Error("body is required")

      const state = readReviewState(ctx.cwd, reviewId)
      if (state.status === "idle") state.status = "running"
      state.comments.push({
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
      state.lastActivityAt = Date.now()
      writeReviewState(ctx.cwd, reviewId, state)

      return {
        content: [{ type: "text", text: `Added diff review comment: ${title}` }],
        details: { reviewId, commentCount: state.comments.length },
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
    async execute(_toolCallId, params: ReviewDoneInput, _signal, _onUpdate, ctx) {
      const reviewId = params.reviewId.trim()
      sessionForTool(ctx.cwd, reviewId)

      const state = readReviewState(ctx.cwd, reviewId)
      state.status = "done"
      state.summary = params.summary.trim() || "AI review complete."
      state.error = undefined
      state.finishedAt = Date.now()
      state.lastActivityAt = Date.now()
      writeReviewState(ctx.cwd, reviewId, state)

      return {
        content: [{ type: "text", text: `Marked diff review ${reviewId} as done.` }],
        details: { reviewId, commentCount: state.comments.length },
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
