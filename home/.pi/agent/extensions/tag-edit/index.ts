import type { ExtensionAPI, TruncationResult } from "@earendil-works/pi-coding-agent"
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { access, readFile, writeFile } from "node:fs/promises"
import { isAbsolute, relative, resolve, sep } from "node:path"
import { type Static, Type } from "typebox"

// Constants

const LINE_TAG_LENGTH = 5
const FILE_TAG_LENGTH = 8
const LINE_TAG_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
const MAX_DISPLAY_LINE_CHARS = 600
const DEFAULT_SEARCH_MATCHES = 100
const MAX_SEARCH_MATCHES = 500
const RG_STDERR_LIMIT = 16 * 1024

// Types

type Brand<T, Name extends string> = T & { readonly __brand: Name }
type LineTag = Brand<string, "LineTag">
type FileTag = Brand<string, "FileTag">

type LineRef = {
  line: number
  tag: LineTag
}

type ParsedTarget =
  | { kind: "single"; ref: LineRef; checkedRefs: LineRef[] }
  | { kind: "range"; start: LineRef; end: LineRef; checkedRefs: LineRef[]; fromLinesBlock: boolean }

type PlannedEdit = {
  editIndex: number
  startIndex: number
  deleteCount: number
  newLines: string[]
}

type ParsedFile = {
  bom: string
  lineEnding: "\n" | "\r\n"
  normalizedContent: string
  finalNewline: boolean
  lines: string[]
  fileTag: FileTag
}

type SearchMatch = {
  path: string
  line: number
}

type FileInfo = {
  parsed: ParsedFile
  displayPath: string
}

type TagToolDetails = {
  path?: string
  file?: FileTag
  lines?: number
  truncation?: TruncationResult
}

type SearchToolDetails = {
  pattern: string
  matches: number
  stoppedEarly: boolean
  truncation?: TruncationResult
}

type EditTagsDetails = {
  path: string
  fileBefore: FileTag
  fileAfter: FileTag
  editsApplied: number
  firstChangedLine?: number
  diff: string
}

// Schemas

type EditPosition = "replace" | "before" | "after"

const readTagsSchema = Type.Object(
  {
    path: Type.String({ description: "Text file path to read with compact line tags" }),
    offset: Type.Optional(Type.Number({ description: "Line number to start at, 1-indexed" })),
    limit: Type.Optional(Type.Number({ description: "Maximum number of tagged lines to return" })),
  },
  { additionalProperties: false }
)
type ReadTagsInput = Static<typeof readTagsSchema>

const searchTagsSchema = Type.Object(
  {
    pattern: Type.String({ description: "ripgrep pattern to search for" }),
    path: Type.Optional(
      Type.String({ description: "File or directory to search, defaults to cwd" })
    ),
    glob: Type.Optional(Type.String({ description: "Optional ripgrep glob, e.g. '*.ts'" })),
    fixedStrings: Type.Optional(
      Type.Boolean({ description: "Use fixed string search instead of regex" })
    ),
    maxMatches: Type.Optional(
      Type.Number({ description: `Stop after this many matches, max ${MAX_SEARCH_MATCHES}` })
    ),
  },
  { additionalProperties: false }
)
type SearchTagsInput = Static<typeof searchTagsSchema>

const tagEditSchema = Type.Object(
  {
    at: Type.Optional(
      Type.String({
        description: "Line ref like '42:Q8fA1' or inclusive range like '42:Q8fA1..55:Z9xY2'",
      })
    ),
    lines: Type.Optional(
      Type.String({
        description:
          "One or more contiguous line refs copied from read_tags/search_tags, one per line; checks every listed line",
      })
    ),
    position: Type.Optional(
      Type.String({
        description:
          "replace (default), before, or after. before/after only insert at a single line ref.",
      })
    ),
    new: Type.String({
      description:
        "Replacement or insertion block. Omit a trailing newline unless inserting an intentional blank final line. Empty string deletes when position=replace.",
    }),
  },
  { additionalProperties: false }
)

type TagEditInput = Static<typeof tagEditSchema> & {
  position?: EditPosition
}

const editTagsSchema = Type.Object(
  {
    path: Type.String({ description: "Text file path to edit" }),
    file: Type.Optional(
      Type.String({
        description: "Optional 8-char file tag from read_tags/search_tags for whole-file CAS",
      })
    ),
    edits: Type.Array(tagEditSchema, {
      description:
        "Line-tag edits. Each edit is matched against the original file, not incrementally. Ranges require a file tag unless lines lists every line ref.",
    }),
  },
  { additionalProperties: false }
)
type EditTagsInput = Static<typeof editTagsSchema>

// Generic helpers

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stripAtPrefix(path: string): string {
  return path.startsWith("@") ? path.slice(1) : path
}

function resolvePath(cwd: string, path: string): string {
  const normalized = stripAtPrefix(path)
  return isAbsolute(normalized) ? normalized : resolve(cwd, normalized)
}

function displayPath(cwd: string, path: string): string {
  const rel = relative(cwd, path)
  if (!rel || rel === "") return "."
  if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) return path
  return rel.split(sep).join("/")
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

// Hashing / tags

function encodeHash30(hash: number): LineTag {
  let output = ""
  for (let shift = 24; shift >= 0; shift -= 6) {
    output += LINE_TAG_ALPHABET[(hash >>> shift) & 0x3f]
  }
  return output as LineTag
}

function lineHash(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  hash ^= text.length
  return Math.imul(hash, 0x01000193) >>> 0
}

function lineTag(text: string): LineTag {
  return encodeHash30(lineHash(text))
}

function fileTag(normalizedContent: string): FileTag {
  return createHash("sha1")
    .update(normalizedContent, "utf8")
    .digest("base64url")
    .slice(0, FILE_TAG_LENGTH) as FileTag
}

// File parsing / formatting

function stripBom(text: string): { bom: string; text: string } {
  return text.startsWith("\uFEFF") ? { bom: "\uFEFF", text: text.slice(1) } : { bom: "", text }
}

function detectLineEnding(text: string): "\n" | "\r\n" {
  const crlfIndex = text.indexOf("\r\n")
  const lfIndex = text.indexOf("\n")
  if (lfIndex === -1 || crlfIndex === -1) return "\n"
  return crlfIndex < lfIndex ? "\r\n" : "\n"
}

function normalizeToLf(text: string): string {
  return text.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n")
}

function restoreLineEndings(text: string, lineEnding: "\n" | "\r\n"): string {
  return lineEnding === "\r\n" ? text.replace(/\n/gu, "\r\n") : text
}

function splitContentLines(normalizedContent: string): { lines: string[]; finalNewline: boolean } {
  if (normalizedContent === "") return { lines: [], finalNewline: false }

  const finalNewline = normalizedContent.endsWith("\n")
  const lines = normalizedContent.split("\n")
  if (finalNewline) lines.pop()
  return { lines, finalNewline }
}

function joinContentLines(lines: string[], finalNewline: boolean): string {
  if (lines.length === 0) return ""
  const content = lines.join("\n")
  return finalNewline ? `${content}\n` : content
}

function parseFile(buffer: Buffer): ParsedFile {
  const raw = buffer.toString("utf8")
  const { bom, text } = stripBom(raw)
  const lineEnding = detectLineEnding(text)
  const normalizedContent = normalizeToLf(text)
  const { lines, finalNewline } = splitContentLines(normalizedContent)
  return {
    bom,
    lineEnding,
    normalizedContent,
    finalNewline,
    lines,
    fileTag: fileTag(normalizedContent),
  }
}

async function readParsedFile(path: string): Promise<ParsedFile> {
  await access(path, constants.R_OK)
  return parseFile(await readFile(path))
}

function truncateLineText(text: string): string {
  if (text.length <= MAX_DISPLAY_LINE_CHARS) return text
  return `${text.slice(0, MAX_DISPLAY_LINE_CHARS - 1)}…`
}

function taggedLine(lineNumber: number, text: string): string {
  return `${lineNumber}:${lineTag(text)} ${truncateLineText(text)}`
}

function formatTaggedRead(
  path: string,
  parsed: ParsedFile,
  offset: number | undefined,
  limit: number | undefined
): string {
  if (parsed.lines.length === 0) {
    return [`file ${parsed.fileTag} lines 0/0 ${path}`, "[empty file]"].join("\n")
  }

  const requestedOffset = clampInteger(offset, 1, 1, Number.MAX_SAFE_INTEGER)
  if (requestedOffset > parsed.lines.length) {
    throw new Error(
      `Offset ${requestedOffset} is beyond end of file (${parsed.lines.length} lines).`
    )
  }

  const startIndex = requestedOffset - 1
  const requestedLimit = clampInteger(limit, DEFAULT_MAX_LINES, 1, DEFAULT_MAX_LINES)
  const endExclusive = Math.min(parsed.lines.length, startIndex + requestedLimit)
  const lines: string[] = []

  for (let index = startIndex; index < endExclusive; index++) {
    lines.push(taggedLine(index + 1, parsed.lines[index] ?? ""))
  }

  const endLine = startIndex + lines.length
  const header = `file ${parsed.fileTag} lines ${startIndex + 1}-${endLine}/${parsed.lines.length} ${path}`
  const output = [header, ...lines]

  if (endLine < parsed.lines.length) {
    output.push(`[more: offset=${endLine + 1}]`)
  }

  return output.join("\n")
}

function maybeTruncateOutput(output: string): { text: string; truncation?: TruncationResult } {
  const truncation = truncateHead(output, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  })
  if (!truncation.truncated) return { text: output }

  const notice = `[Output truncated: showing ${truncation.outputLines}/${truncation.totalLines} lines, ${formatSize(
    truncation.outputBytes
  )}/${formatSize(truncation.totalBytes)}. Use a narrower range/search.]`
  return { text: `${truncation.content}\n\n${notice}`, truncation }
}

// Edit target parsing / validation

function parseLineRef(input: string, label: string): LineRef {
  const match = input.trim().match(/^(\d+):([A-Za-z0-9_-]{4,12})(?:\s.*)?$/u)
  if (!match) {
    throw new Error(
      `${label} must look like '42:${"A".repeat(LINE_TAG_LENGTH)}'. Received: ${input}`
    )
  }

  const line = Number(match[1])
  if (!Number.isSafeInteger(line) || line < 1) {
    throw new Error(`${label} has invalid line number: ${match[1]}`)
  }

  return { line, tag: match[2] as LineTag }
}

function parseLinesBlock(lines: string): LineRef[] {
  const refs = lines
    .split(/[\n,]+/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => parseLineRef(line, `lines[${index}]`))

  if (refs.length === 0) throw new Error("lines must include at least one line ref.")

  for (let index = 1; index < refs.length; index++) {
    const previous = refs[index - 1]
    const current = refs[index]
    if (!previous || !current || current.line !== previous.line + 1) {
      throw new Error("lines refs must be contiguous and ascending.")
    }
  }

  return refs
}

function parseAtTarget(at: string): ParsedTarget {
  const parts = at.split("..")
  if (parts.length === 1) {
    const ref = parseLineRef(parts[0] ?? "", "at")
    return { kind: "single", ref, checkedRefs: [ref] }
  }

  if (parts.length !== 2) throw new Error(`Invalid at range: ${at}`)

  const start = parseLineRef(parts[0] ?? "", "range start")
  const end = parseLineRef(parts[1] ?? "", "range end")
  if (end.line < start.line) throw new Error("Range end must be after range start.")

  return { kind: "range", start, end, checkedRefs: [start, end], fromLinesBlock: false }
}

function parseEditTarget(edit: TagEditInput, editIndex: number): ParsedTarget {
  const hasAt = typeof edit.at === "string" && edit.at.trim() !== ""
  const hasLines = typeof edit.lines === "string" && edit.lines.trim() !== ""

  if (hasAt === hasLines) {
    throw new Error(`edits[${editIndex}] must provide exactly one of at or lines.`)
  }

  if (hasLines) {
    const refs = parseLinesBlock(edit.lines ?? "")
    if (refs.length === 1) return { kind: "single", ref: refs[0]!, checkedRefs: refs }
    return {
      kind: "range",
      start: refs[0]!,
      end: refs[refs.length - 1]!,
      checkedRefs: refs,
      fromLinesBlock: true,
    }
  }

  return parseAtTarget(edit.at ?? "")
}

function findNearbyTag(lines: string[], ref: LineRef): number | undefined {
  const start = Math.max(1, ref.line - 3)
  const end = Math.min(lines.length, ref.line + 3)
  for (let line = start; line <= end; line++) {
    if (lineTag(lines[line - 1] ?? "") === ref.tag) return line
  }
  return undefined
}

function assertLineRef(lines: string[], ref: LineRef, path: string): void {
  if (ref.line > lines.length) {
    throw new Error(
      `${path}:${ref.line} is beyond end of file (${lines.length} lines). Re-read tags.`
    )
  }

  const actual = lineTag(lines[ref.line - 1] ?? "")
  if (actual === ref.tag) return

  const nearby = findNearbyTag(lines, ref)
  const hint = nearby ? ` Similar tag is now at line ${nearby}.` : ""
  throw new Error(
    `${path}:${ref.line} tag mismatch: expected ${ref.tag}, found ${actual}.${hint} Re-read tags.`
  )
}

function blockToLines(block: string): string[] {
  if (block === "") return []

  const normalized = normalizeToLf(block)
  const withoutOneTrailingNewline = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized
  return withoutOneTrailingNewline.split("\n")
}

function planOneEdit(
  edit: TagEditInput,
  editIndex: number,
  parsed: ParsedFile,
  displayPathValue: string,
  hasWholeFileCas: boolean
): PlannedEdit {
  const target = parseEditTarget(edit, editIndex)
  const position = edit.position ?? "replace"

  if (!(["replace", "before", "after"] as const).includes(position)) {
    throw new Error(`edits[${editIndex}].position must be replace, before, or after.`)
  }

  for (const ref of target.checkedRefs) {
    assertLineRef(parsed.lines, ref, displayPathValue)
  }

  const newLines = blockToLines(edit.new)

  if (target.kind === "single") {
    if (position === "replace") {
      return {
        editIndex,
        startIndex: target.ref.line - 1,
        deleteCount: 1,
        newLines,
      }
    }

    if (newLines.length === 0) throw new Error(`edits[${editIndex}] inserts no lines.`)

    const insertIndex = position === "before" ? target.ref.line - 1 : target.ref.line
    return {
      editIndex,
      startIndex: insertIndex,
      deleteCount: 0,
      newLines,
    }
  }

  if (position !== "replace") {
    throw new Error(`edits[${editIndex}] uses a range; position must be replace.`)
  }

  if (!target.fromLinesBlock && !hasWholeFileCas) {
    throw new Error(
      `edits[${editIndex}] range checks only endpoint tags. Provide file from read_tags/search_tags or use lines with every line ref.`
    )
  }

  return {
    editIndex,
    startIndex: target.start.line - 1,
    deleteCount: target.end.line - target.start.line + 1,
    newLines,
  }
}

function assertNoOverlaps(edits: PlannedEdit[], path: string): void {
  const sorted = [...edits].sort((left, right) => left.startIndex - right.startIndex)

  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1]
    const current = sorted[index]
    if (!previous || !current) continue

    const previousEnd = previous.startIndex + previous.deleteCount
    if (previous.startIndex === current.startIndex || previousEnd > current.startIndex) {
      throw new Error(
        `edits[${previous.editIndex}] and edits[${current.editIndex}] overlap in ${path}. Merge them into one edit.`
      )
    }
  }
}

function applyPlannedEdits(lines: string[], edits: PlannedEdit[]): string[] {
  const next = [...lines]
  const sortedDescending = [...edits].sort((left, right) => right.startIndex - left.startIndex)

  for (const edit of sortedDescending) {
    next.splice(edit.startIndex, edit.deleteCount, ...edit.newLines)
  }

  return next
}

// Diff formatting

function diffHeader(
  oldStart: number,
  oldCount: number,
  newStart: number,
  newCount: number
): string {
  return `@@ -${oldStart}${oldCount === 1 ? "" : `,${oldCount}`} +${newStart}${newCount === 1 ? "" : `,${newCount}`} @@`
}

function buildFocusedDiff(originalLines: string[], edits: PlannedEdit[], contextLines = 3): string {
  const sorted = [...edits].sort((left, right) => left.startIndex - right.startIndex)
  const output: string[] = []
  let lineOffset = 0

  for (const edit of sorted) {
    const contextStart = Math.max(0, edit.startIndex - contextLines)
    const contextEnd = Math.min(
      originalLines.length,
      edit.startIndex + edit.deleteCount + contextLines
    )
    const oldStartLine = contextStart + 1
    const oldCount = Math.max(1, contextEnd - contextStart)
    const newStartLine = contextStart + lineOffset + 1
    const newCount = Math.max(1, oldCount - edit.deleteCount + edit.newLines.length)

    output.push(diffHeader(oldStartLine, oldCount, newStartLine, newCount))

    for (let index = contextStart; index < edit.startIndex; index++) {
      output.push(` ${index + 1} ${originalLines[index] ?? ""}`)
    }
    for (let index = edit.startIndex; index < edit.startIndex + edit.deleteCount; index++) {
      output.push(`-${index + 1} ${originalLines[index] ?? ""}`)
    }
    for (let index = 0; index < edit.newLines.length; index++) {
      output.push(`+${edit.startIndex + lineOffset + index + 1} ${edit.newLines[index] ?? ""}`)
    }
    for (let index = edit.startIndex + edit.deleteCount; index < contextEnd; index++) {
      output.push(` ${index + 1} ${originalLines[index] ?? ""}`)
    }

    lineOffset += edit.newLines.length - edit.deleteCount
  }

  const diff = output.join("\n")
  const truncation = truncateHead(diff, { maxLines: 400, maxBytes: 20 * 1024 })
  if (!truncation.truncated) return diff
  return `${truncation.content}\n[diff truncated]`
}

function firstChangedLine(edits: PlannedEdit[]): number | undefined {
  return edits.reduce<number | undefined>((first, edit) => {
    const line = edit.startIndex + 1
    return first === undefined || line < first ? line : first
  }, undefined)
}

// Argument preparation

function normalizeOneTagEdit(value: unknown): unknown {
  if (!isRecord(value)) return value

  const next: Record<string, unknown> = {}
  if (typeof value.at === "string") next.at = value.at
  if (typeof value.lines === "string") next.lines = value.lines
  if (typeof value.position === "string") next.position = value.position
  if (typeof value.new === "string") {
    next.new = value.new
  } else if (typeof value.newText === "string") {
    next.new = value.newText
  }

  return next
}

function prepareEditTagsArguments(input: unknown): unknown {
  if (!isRecord(input)) return input

  const next: Record<string, unknown> = { ...input }
  if (typeof next.file !== "string" && typeof next.fileTag === "string") {
    next.file = next.fileTag
    delete next.fileTag
  }

  if (typeof next.edits === "string") {
    try {
      const parsed: unknown = JSON.parse(next.edits)
      if (Array.isArray(parsed)) next.edits = parsed
    } catch {}
  }

  if (
    !Array.isArray(next.edits) &&
    (typeof next.at === "string" || typeof next.lines === "string")
  ) {
    next.edits = [normalizeOneTagEdit(next)]
  } else if (Array.isArray(next.edits)) {
    next.edits = next.edits.map(normalizeOneTagEdit)
  }

  return next
}

function validateEditTagsInput(input: EditTagsInput): void {
  if (!Array.isArray(input.edits) || input.edits.length === 0) {
    throw new Error("edit_tags requires at least one edit.")
  }
}

// Search helpers

function rgArgs(input: SearchTagsInput, maxMatches: number): string[] {
  const args = ["--json", "--line-number", "--color=never", "--max-count", String(maxMatches)]
  if (input.fixedStrings) args.push("--fixed-strings")
  if (input.glob) args.push("--glob", input.glob)
  args.push("--", input.pattern, stripAtPrefix(input.path ?? "."))
  return args
}

function jsonString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function jsonNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function parseRgJsonLine(line: string, cwd: string): SearchMatch | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return undefined
  }

  if (!isRecord(parsed) || parsed.type !== "match" || !isRecord(parsed.data)) return undefined
  const pathValue = parsed.data.path
  const linesValue = parsed.data.lines
  const pathText = isRecord(pathValue) ? jsonString(pathValue.text) : undefined
  const lineNumber = jsonNumber(parsed.data.line_number)

  if (!pathText || lineNumber === undefined) return undefined
  if (isRecord(linesValue) && typeof linesValue.text !== "string") return undefined

  return { path: resolvePath(cwd, pathText), line: lineNumber }
}

function runRipgrep(
  input: SearchTagsInput,
  cwd: string,
  signal: AbortSignal | undefined
): Promise<{ matches: SearchMatch[]; stoppedEarly: boolean }> {
  const maxMatches = clampInteger(input.maxMatches, DEFAULT_SEARCH_MATCHES, 1, MAX_SEARCH_MATCHES)
  const args = rgArgs(input, maxMatches)

  return new Promise((resolvePromise, reject) => {
    const child = spawn("rg", args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    const matches: SearchMatch[] = []
    let stdoutBuffer = ""
    let stderr = ""
    let stoppedEarly = false
    let settled = false

    const cleanup = (): void => {
      signal?.removeEventListener("abort", onAbort)
    }

    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }

    const onAbort = (): void => {
      child.kill("SIGTERM")
      finish(() => reject(new Error("Operation aborted")))
    }

    signal?.addEventListener("abort", onAbort, { once: true })

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf8")
      const lines = stdoutBuffer.split("\n")
      stdoutBuffer = lines.pop() ?? ""

      for (const line of lines) {
        if (!line.trim()) continue
        const match = parseRgJsonLine(line, cwd)
        if (!match) continue
        matches.push(match)
        if (matches.length >= maxMatches) {
          stoppedEarly = true
          child.kill("SIGTERM")
          break
        }
      }
    })

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < RG_STDERR_LIMIT) stderr += chunk.toString("utf8")
    })

    child.on("error", (error) => {
      finish(() => reject(error))
    })

    child.on("close", (code) => {
      if (stdoutBuffer.trim() && matches.length < maxMatches) {
        const match = parseRgJsonLine(stdoutBuffer, cwd)
        if (match) matches.push(match)
      }

      if (code === 0 || code === 1 || stoppedEarly) {
        finish(() => resolvePromise({ matches, stoppedEarly }))
        return
      }

      const reason = stderr.trim() || `rg exited with code ${code}`
      finish(() => reject(new Error(reason)))
    })
  })
}

async function loadFileInfo(
  path: string,
  cwd: string,
  cache: Map<string, Promise<FileInfo>>
): Promise<FileInfo> {
  const existing = cache.get(path)
  if (existing) return existing

  const promise = readParsedFile(path).then((parsed) => ({
    parsed,
    displayPath: displayPath(cwd, path),
  }))
  cache.set(path, promise)
  return promise
}

async function formatSearchMatches(
  matches: SearchMatch[],
  cwd: string
): Promise<{ output: string; fileCount: number }> {
  const cache = new Map<string, Promise<FileInfo>>()
  const output: string[] = []
  let currentPath: string | undefined
  let fileCount = 0

  for (const match of matches) {
    const fileInfo = await loadFileInfo(match.path, cwd, cache)
    if (currentPath !== match.path) {
      currentPath = match.path
      fileCount++
      output.push(`${fileInfo.displayPath} file ${fileInfo.parsed.fileTag}`)
    }

    const text = fileInfo.parsed.lines[match.line - 1] ?? ""
    output.push(taggedLine(match.line, text))
  }

  return { output: output.join("\n"), fileCount }
}

// Extension entrypoint

export default function tagEditExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "read_tags",
    label: "read tags",
    description: `Read a text file with compact CAS line tags for edit_tags. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(
      DEFAULT_MAX_BYTES
    )}. Each line is 'line:tag text'.`,
    promptSnippet: "Read text files with compact line tags for edit_tags",
    promptGuidelines: [
      "Use read_tags before edit_tags when line-level replacements, insertions, or deletions would make built-in edit oldText large.",
      "Copy line refs from read_tags exactly as line:tag; include the file tag in edit_tags for range edits.",
    ],
    parameters: readTagsSchema,
    async execute(_toolCallId, input: ReadTagsInput, _signal, _onUpdate, ctx) {
      const absolutePath = resolvePath(ctx.cwd, input.path)
      const parsed = await readParsedFile(absolutePath)
      const output = formatTaggedRead(
        displayPath(ctx.cwd, absolutePath),
        parsed,
        input.offset,
        input.limit
      )
      const truncated = maybeTruncateOutput(output)

      return {
        content: [{ type: "text", text: truncated.text }],
        details: {
          path: displayPath(ctx.cwd, absolutePath),
          file: parsed.fileTag,
          lines: parsed.lines.length,
          truncation: truncated.truncation,
        } satisfies TagToolDetails,
      }
    },
  })

  pi.registerTool({
    name: "search_tags",
    label: "search tags",
    description: `Search with ripgrep and return matching lines as edit_tags refs. Stops after ${DEFAULT_SEARCH_MATCHES} matches by default and truncates output to ${formatSize(
      DEFAULT_MAX_BYTES
    )}.`,
    promptSnippet: "Search files and return line tags that can be edited with edit_tags",
    promptGuidelines: [
      "Use search_tags instead of grep when search results may need tag-based edits afterwards.",
      "Use the per-file file tag shown by search_tags when calling edit_tags for ranges in that file.",
    ],
    parameters: searchTagsSchema,
    async execute(_toolCallId, input: SearchTagsInput, signal, _onUpdate, ctx) {
      const result = await runRipgrep(input, ctx.cwd, signal)
      if (result.matches.length === 0) {
        return {
          content: [{ type: "text", text: "No matches." }],
          details: {
            pattern: input.pattern,
            matches: 0,
            stoppedEarly: false,
          } satisfies SearchToolDetails,
        }
      }

      const formatted = await formatSearchMatches(result.matches, ctx.cwd)
      const suffix = result.stoppedEarly
        ? `\n[Stopped at ${result.matches.length} matches. Narrow the search or raise maxMatches up to ${MAX_SEARCH_MATCHES}.]`
        : ""
      const truncated = maybeTruncateOutput(`${formatted.output}${suffix}`)

      return {
        content: [{ type: "text", text: truncated.text }],
        details: {
          pattern: input.pattern,
          matches: result.matches.length,
          stoppedEarly: result.stoppedEarly,
          truncation: truncated.truncation,
        } satisfies SearchToolDetails,
      }
    },
  })

  pi.registerTool({
    name: "edit_tags",
    label: "edit tags",
    description:
      "Token-efficient CAS edit using line tags from read_tags/search_tags. Replaces/deletes whole lines or inserts before/after a tagged line. Ranges require a file tag unless every line ref is provided via lines.",
    promptSnippet: "Edit files using compact line tags instead of repeating old text",
    promptGuidelines: [
      "Use edit_tags for whole-line replacements, insertions, and large deletions after read_tags/search_tags.",
      "For edit_tags, pass file from read_tags/search_tags whenever deleting or replacing a multi-line range.",
      "Use built-in edit instead of edit_tags for precise substring changes inside a line.",
    ],
    parameters: editTagsSchema,
    prepareArguments: prepareEditTagsArguments,
    async execute(_toolCallId, input: EditTagsInput, signal, _onUpdate, ctx) {
      validateEditTagsInput(input)
      const absolutePath = resolvePath(ctx.cwd, input.path)
      const display = displayPath(ctx.cwd, absolutePath)

      return withFileMutationQueue(absolutePath, async () => {
        if (signal?.aborted) throw new Error("Operation aborted")

        await access(absolutePath, constants.R_OK | constants.W_OK)
        const parsed = parseFile(await readFile(absolutePath))
        const expectedFile = input.file as FileTag | undefined
        const hasWholeFileCas = typeof expectedFile === "string" && expectedFile.length > 0

        if (hasWholeFileCas && parsed.fileTag !== expectedFile) {
          throw new Error(
            `${display} file tag mismatch: expected ${expectedFile}, found ${parsed.fileTag}. Re-read tags.`
          )
        }

        const planned = input.edits.map((edit, index) =>
          planOneEdit(edit as TagEditInput, index, parsed, display, hasWholeFileCas)
        )
        assertNoOverlaps(planned, display)

        const nextLines = applyPlannedEdits(parsed.lines, planned)
        const nextContent = joinContentLines(nextLines, parsed.finalNewline)
        if (nextContent === parsed.normalizedContent) {
          throw new Error(`No changes made to ${display}.`)
        }

        if (signal?.aborted) throw new Error("Operation aborted")

        const finalContent = parsed.bom + restoreLineEndings(nextContent, parsed.lineEnding)
        await writeFile(absolutePath, finalContent, "utf8")

        const nextTag = fileTag(nextContent)
        const diff = buildFocusedDiff(parsed.lines, planned)
        const firstLine = firstChangedLine(planned)
        const summary = [
          `Applied ${planned.length} tag edit(s) to ${display}.`,
          `file ${parsed.fileTag} -> ${nextTag}`,
          diff,
        ].join("\n")

        return {
          content: [{ type: "text", text: summary }],
          details: {
            path: display,
            fileBefore: parsed.fileTag,
            fileAfter: nextTag,
            editsApplied: planned.length,
            firstChangedLine: firstLine,
            diff,
          } satisfies EditTagsDetails,
        }
      })
    },
  })

  pi.registerCommand("tag-edit-help", {
    description: "Show tag-edit tool syntax",
    handler: async (_args, ctx) => {
      const message = [
        "read_tags returns: file <filetag> lines <range>/<total> <path>",
        "Each tagged line is: <line>:<tag> <text>",
        "edit_tags example: { path, file, edits: [{ at: '10:Q8fA1..20:Ab9_Z', new: '' }] }",
        "Use position: 'before' or 'after' with a single line ref for insertions.",
      ].join("\n")
      ctx.ui.notify(message, "info")
    },
  })
}
