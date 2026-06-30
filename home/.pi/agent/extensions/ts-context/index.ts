import { existsSync, statSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { Node, Project, TypeFormatFlags, ts } from "ts-morph"
import type { Identifier, SourceFile, Symbol as MorphSymbol, Type as MorphType } from "ts-morph"
import { Type, type Static } from "typebox"

// Constants

const CONFIG_FILENAMES = ["tsconfig.json", "jsconfig.json"] as const
const DEFAULT_DEPTH = 2
const MAX_DEPTH = 4
const DEFAULT_MAX_RESULTS = 100
const MAX_RESULTS = 500
const MAX_PROJECT_CACHE_SIZE = 8
const MAX_EXPANDED_PROPERTIES = 80
const MAX_EXPANDED_MEMBERS = 80
const MAX_OUTPUT_BYTES = 50 * 1024
const MAX_OUTPUT_LINES = 2000
const MAX_TYPE_TEXT_CHARS = 4000
const MAX_PREVIEW_CHARS = 160

const FORMAT_FLAGS =
  TypeFormatFlags.NoTruncation |
  TypeFormatFlags.WriteArrayAsGenericType |
  TypeFormatFlags.UseSingleQuotesForStringLiteralType

const TOOL_GUIDELINES = [
  "Use ts_type_at on TypeScript/TSX identifiers, calls, and properties when inferred return types, nullability, generics, discriminated unions, or generated/framework types matter.",
  "Use ts_definition_at instead of grep when the exact TypeScript symbol definition matters, especially across imports, re-exports, and same-name symbols.",
  "Use ts_references_at before TypeScript refactors to find semantic references, not text matches.",
  "Use ts_diagnostics after TypeScript edits or when compiler errors would change the plan.",
  "For ts_type_at/ts_definition_at/ts_references_at, choose a precise source position on the identifier or expression; if the result says the position is trivia/comment/whitespace, retry on the real token.",
]

// Types

type ProjectCacheEntry = {
  tsconfigPath: string
  project: Project
  lastUsedAt: number
}

type ResolvedSourceNode = {
  entry: ProjectCacheEntry
  node: Node
}

type ToolResultDetails = Record<string, unknown>

type ToolResult = {
  content: Array<{ type: "text"; text: string }>
  details: ToolResultDetails
}

type TextWithDetails = {
  text: string
  details?: ToolResultDetails
}

const locSchema = Type.Object({
  file: Type.String({ description: "TypeScript/TSX file path, relative to cwd or absolute" }),
  line: Type.Number({ description: "1-based line number" }),
  col: Type.Number({ description: "1-based column number" }),
})

const typeAtSchema = Type.Object({
  file: Type.String({ description: "TypeScript/TSX file path, relative to cwd or absolute" }),
  line: Type.Number({ description: "1-based line number" }),
  col: Type.Number({ description: "1-based column number" }),
  depth: Type.Optional(
    Type.Number({ description: `Expansion depth, default ${DEFAULT_DEPTH}, max ${MAX_DEPTH}` })
  ),
})

const referencesAtSchema = Type.Object({
  file: Type.String({ description: "TypeScript/TSX file path, relative to cwd or absolute" }),
  line: Type.Number({ description: "1-based line number" }),
  col: Type.Number({ description: "1-based column number" }),
  maxResults: Type.Optional(
    Type.Number({ description: `Max references to print, default ${DEFAULT_MAX_RESULTS}` })
  ),
})

const diagnosticsSchema = Type.Object({
  file: Type.Optional(
    Type.String({ description: "Optional TypeScript/TSX file path. If omitted, checks project." })
  ),
  maxResults: Type.Optional(
    Type.Number({ description: `Max diagnostics to print, default ${DEFAULT_MAX_RESULTS}` })
  ),
})

const reloadSchema = Type.Object({
  reason: Type.Optional(Type.String({ description: "Optional reason for clearing the TS cache" })),
})

type LocParams = Static<typeof locSchema>
type TypeAtParams = Static<typeof typeAtSchema>
type ReferencesAtParams = Static<typeof referencesAtSchema>
type DiagnosticsParams = Static<typeof diagnosticsSchema>
type ReloadParams = Static<typeof reloadSchema>

// State

const projectCache = new Map<string, ProjectCacheEntry>()

// Generic helpers

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
}

function truncateLine(text: string, maxChars = MAX_TYPE_TEXT_CHARS): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`
}

function truncateOutput(text: string): { text: string; truncated: boolean } {
  const lines = text.split("\n")
  let outputLines = 0
  let outputBytes = 0
  const kept: string[] = []

  for (const line of lines) {
    const nextBytes = Buffer.byteLength(line, "utf8") + 1
    if (outputLines >= MAX_OUTPUT_LINES || outputBytes + nextBytes > MAX_OUTPUT_BYTES) break
    kept.push(line)
    outputLines += 1
    outputBytes += nextBytes
  }

  const truncated = kept.length < lines.length
  if (!truncated) return { text, truncated: false }

  const totalBytes = Buffer.byteLength(text, "utf8")
  kept.push(
    "",
    `[Output truncated: showing ${outputLines} of ${lines.length} lines, ${outputBytes} of ${totalBytes} bytes.]`
  )
  return { text: kept.join("\n"), truncated: true }
}

function toToolResult({ text, details = {} }: TextWithDetails): ToolResult {
  const truncated = truncateOutput(text)
  return {
    content: [{ type: "text", text: truncated.text }],
    details: truncated.truncated ? { ...details, truncated: true } : details,
  }
}

function toErrorResult(error: unknown, details: ToolResultDetails = {}): ToolResult {
  return toToolResult({
    text: `Error: ${errorMessage(error)}`,
    details: { ...details, error: true },
  })
}

function textPreview(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim()
  return truncateLine(compact, MAX_PREVIEW_CHARS)
}

// Path/file helpers

function stripPathPrefix(path: string): string {
  return path.startsWith("@") ? path.slice(1) : path
}

function absolutePath(cwd: string, path: string): string {
  const stripped = stripPathPrefix(path.trim())
  if (!stripped) throw new Error("file path is required")
  return isAbsolute(stripped) ? resolve(stripped) : resolve(cwd, stripped)
}

function displayPath(cwd: string, path: string): string {
  const rel = relative(cwd, path)
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : path
}

function directoryForConfigSearch(path: string): string {
  if (!existsSync(path)) return dirname(path)
  const info = statSync(path)
  return info.isDirectory() ? path : dirname(path)
}

function findNearestConfig(startDirectory: string): string | undefined {
  let current = startDirectory

  while (true) {
    for (const filename of CONFIG_FILENAMES) {
      const candidate = join(current, filename)
      if (existsSync(candidate)) return candidate
    }

    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

function sourceFileForPath(entry: ProjectCacheEntry, absoluteFile: string): SourceFile {
  const existing = entry.project.getSourceFile(absoluteFile)
  if (existing) {
    existing.refreshFromFileSystemSync()
    return existing
  }

  if (!existsSync(absoluteFile)) throw new Error(`file does not exist: ${absoluteFile}`)
  return entry.project.addSourceFileAtPath(absoluteFile)
}

function formatLocation(cwd: string, sourceFile: SourceFile, pos: number): string {
  const { line, column } = sourceFile.getLineAndColumnAtPos(pos)
  return `${displayPath(cwd, sourceFile.getFilePath())}:${line}:${column}`
}

// Project cache

function pruneProjectCache(): void {
  if (projectCache.size <= MAX_PROJECT_CACHE_SIZE) return

  const oldest = [...projectCache.entries()].sort(([, a], [, b]) => a.lastUsedAt - b.lastUsedAt)[0]
  if (!oldest) return
  projectCache.delete(oldest[0])
}

function getProjectForPath(cwd: string, path: string): ProjectCacheEntry {
  const start = directoryForConfigSearch(path)
  const tsconfigPath = findNearestConfig(start)
  if (!tsconfigPath) {
    throw new Error(
      `No tsconfig.json or jsconfig.json found above ${displayPath(cwd, start)}. This tool only works inside TypeScript projects.`
    )
  }

  const cached = projectCache.get(tsconfigPath)
  if (cached) {
    cached.lastUsedAt = Date.now()
    return cached
  }

  const entry: ProjectCacheEntry = {
    tsconfigPath,
    project: new Project({ tsConfigFilePath: tsconfigPath }),
    lastUsedAt: Date.now(),
  }
  projectCache.set(tsconfigPath, entry)
  pruneProjectCache()
  return entry
}

function clearProjectCache(): number {
  const count = projectCache.size
  projectCache.clear()
  return count
}

// Node resolution

function resolvePosition(sourceFile: SourceFile, line: number, col: number): number {
  assertPositiveInteger(line, "line")
  assertPositiveInteger(col, "col")

  try {
    return ts.getPositionOfLineAndCharacter(sourceFile.compilerNode, line - 1, col - 1)
  } catch {
    throw new Error(`position ${line}:${col} is out of range`)
  }
}

function isTriviaNode(node: Node): boolean {
  const kind = node.getKind()
  return (
    kind === ts.SyntaxKind.SingleLineCommentTrivia ||
    kind === ts.SyntaxKind.MultiLineCommentTrivia ||
    kind === ts.SyntaxKind.WhitespaceTrivia ||
    kind === ts.SyntaxKind.NewLineTrivia
  )
}

function resolveSourceNode(
  cwd: string,
  file: string,
  line: number,
  col: number
): ResolvedSourceNode {
  const absoluteFile = absolutePath(cwd, file)
  const entry = getProjectForPath(cwd, absoluteFile)
  const sourceFile = sourceFileForPath(entry, absoluteFile)
  const pos = resolvePosition(sourceFile, line, col)
  const node = sourceFile.getDescendantAtPos(pos)

  if (!node)
    throw new Error(`no TypeScript AST node at ${displayPath(cwd, absoluteFile)}:${line}:${col}`)
  if (isTriviaNode(node)) {
    throw new Error(
      `position resolves to ${node.getKindName()} (${JSON.stringify(textPreview(node.getText()))}); point at an identifier/expression instead`
    )
  }

  return { entry, node }
}

function identifierAtNode(node: Node): Identifier {
  if (Node.isIdentifier(node)) return node
  throw new Error(
    `position resolves to ${node.getKindName()} (${JSON.stringify(textPreview(node.getText()))}); point at the exact identifier instead`
  )
}

// Type formatting

function isOptionalSymbol(symbol: MorphSymbol): boolean {
  return (symbol.getFlags() & ts.SymbolFlags.Optional) !== 0
}

function typeDeclarations(type: MorphType): Node[] {
  return [
    ...(type.getSymbol()?.getDeclarations() ?? []),
    ...(type.getAliasSymbol()?.getDeclarations() ?? []),
  ]
}

function isExternalType(type: MorphType): boolean {
  return typeDeclarations(type).some((declaration) => {
    const sourceFile = declaration.getSourceFile()
    const filePath = sourceFile.getFilePath()
    return sourceFile.isInNodeModules() || /[\\/]typescript[\\/]lib[\\/]/.test(filePath)
  })
}

function declarationLocation(cwd: string, type: MorphType): string | undefined {
  const declaration = typeDeclarations(type)[0]
  if (!declaration) return undefined
  return formatLocation(cwd, declaration.getSourceFile(), declaration.getStart())
}

function formatType(type: MorphType, node: Node, maxChars = MAX_TYPE_TEXT_CHARS): string {
  try {
    return truncateLine(type.getText(node, FORMAT_FLAGS), maxChars)
  } catch (error) {
    return truncateLine(`<unable to render type: ${errorMessage(error)}>`, maxChars)
  }
}

function isPrimitiveType(type: MorphType): boolean {
  return (
    type.isString() ||
    type.isNumber() ||
    type.isBoolean() ||
    type.isLiteral() ||
    type.isNull() ||
    type.isUndefined() ||
    type.isVoid() ||
    type.isAny() ||
    type.isUnknown() ||
    type.isNever()
  )
}

function describeType(
  type: MorphType,
  node: Node,
  depth: number,
  maxDepth: number,
  seen: Set<string>
): string[] {
  const indent = "  ".repeat(depth + 1)
  const typeText = formatType(type, node)
  const lines: string[] = []

  if (depth >= maxDepth || isPrimitiveType(type)) return [`${indent}${typeText}`]

  if (type.isTuple()) {
    const elements = type.getTupleElements()
    const readonlyPrefix = typeText.startsWith("readonly ") ? "readonly " : ""
    if (elements.every(isPrimitiveType)) return [`${indent}${typeText}`]

    lines.push(`${indent}${readonlyPrefix}[`)
    for (const element of elements.slice(0, MAX_EXPANDED_MEMBERS)) {
      lines.push(...describeType(element, node, depth + 1, maxDepth, seen))
    }
    if (elements.length > MAX_EXPANDED_MEMBERS) {
      lines.push(`${indent}  ... ${elements.length - MAX_EXPANDED_MEMBERS} more tuple elements`)
    }
    lines.push(`${indent}]`)
    return lines
  }

  if (type.isArray()) {
    const elementType = type.getArrayElementType()
    if (!elementType || isPrimitiveType(elementType) || isExternalType(elementType)) {
      return [`${indent}${typeText}`]
    }

    const child = describeType(elementType, node, depth + 1, maxDepth, seen)
    return [`${indent}Array<`, ...child, `${indent}>`]
  }

  if (isExternalType(type)) return [`${indent}${typeText}`]

  if (type.isUnion()) {
    const members = type.getUnionTypes()
    lines.push(`${indent}union (${members.length}):`)
    for (const member of members.slice(0, MAX_EXPANDED_MEMBERS)) {
      lines.push(...describeType(member, node, depth + 1, maxDepth, seen))
    }
    if (members.length > MAX_EXPANDED_MEMBERS) {
      lines.push(`${indent}  ... ${members.length - MAX_EXPANDED_MEMBERS} more union members`)
    }
    return lines
  }

  if (type.isIntersection()) {
    const members = type.getIntersectionTypes()
    lines.push(`${indent}intersection (${members.length}):`)
    for (const member of members.slice(0, MAX_EXPANDED_MEMBERS)) {
      lines.push(...describeType(member, node, depth + 1, maxDepth, seen))
    }
    if (members.length > MAX_EXPANDED_MEMBERS) {
      lines.push(
        `${indent}  ... ${members.length - MAX_EXPANDED_MEMBERS} more intersection members`
      )
    }
    return lines
  }

  const callSignatures = type.getCallSignatures()
  if (callSignatures.length > 0) {
    for (const signature of callSignatures.slice(0, MAX_EXPANDED_MEMBERS)) {
      const params = signature
        .getParameters()
        .map((parameter) => {
          const parameterType = parameter.getTypeAtLocation(node)
          return `${parameter.getName()}: ${formatType(parameterType, node)}`
        })
        .join(", ")
      const returnType = formatType(signature.getReturnType(), node)
      lines.push(`${indent}(${params}) => ${returnType}`)
    }
    if (callSignatures.length > MAX_EXPANDED_MEMBERS) {
      lines.push(
        `${indent}... ${callSignatures.length - MAX_EXPANDED_MEMBERS} more call signatures`
      )
    }
    return lines
  }

  const properties = type.getProperties()
  if (properties.length > 0) {
    const key = formatType(type, node, 1000)
    if (seen.has(key)) return [`${indent}${typeText} (recursive)`]
    seen.add(key)

    lines.push(`${indent}{`)
    for (const property of properties.slice(0, MAX_EXPANDED_PROPERTIES)) {
      const propertyType = property.getTypeAtLocation(node)
      const optional = isOptionalSymbol(property) ? "?" : ""
      const child = describeType(propertyType, node, depth + 1, maxDepth, seen)
      if (child.length === 1) {
        lines.push(
          `${indent}  ${property.getName()}${optional}: ${child[0]?.trimStart() ?? "unknown"}`
        )
      } else {
        lines.push(`${indent}  ${property.getName()}${optional}:`)
        lines.push(...child)
      }
    }
    if (properties.length > MAX_EXPANDED_PROPERTIES) {
      lines.push(`${indent}  ... ${properties.length - MAX_EXPANDED_PROPERTIES} more properties`)
    }
    lines.push(`${indent}}`)
    return lines
  }

  return [`${indent}${typeText}`]
}

// Tool implementations

function typeAt(params: TypeAtParams, ctx: ExtensionContext): TextWithDetails {
  const depth = clampInt(params.depth, DEFAULT_DEPTH, 0, MAX_DEPTH)
  const { entry, node } = resolveSourceNode(ctx.cwd, params.file, params.line, params.col)
  const type = node.getType()
  const symbol = node.getSymbol() ?? type.getSymbol()
  const typeText = formatType(type, node)
  const typeLocation = declarationLocation(ctx.cwd, type)
  const aliasSymbol = type.getAliasSymbol()
  const lines = [
    `# ${params.file}:${params.line}:${params.col}`,
    `tsconfig: ${displayPath(ctx.cwd, entry.tsconfigPath)}`,
    `node:     ${node.getKindName()} ${JSON.stringify(textPreview(node.getText()))}`,
  ]

  if (symbol) lines.push(`symbol:   ${symbol.getName()}`)
  if (typeLocation) lines.push(`type at:  ${typeLocation}`)
  lines.push(`type:     ${typeText}`)
  if (aliasSymbol) lines.push(`alias:    ${aliasSymbol.getName()}`)

  lines.push("", `expanded (depth ${depth}):`)
  lines.push(...describeType(type, node, 0, depth, new Set()))

  return {
    text: lines.join("\n"),
    details: {
      tsconfigPath: entry.tsconfigPath,
      nodeKind: node.getKindName(),
      symbol: symbol?.getName(),
      type: typeText,
    },
  }
}

function definitionAt(params: LocParams, ctx: ExtensionContext): TextWithDetails {
  const { entry, node } = resolveSourceNode(ctx.cwd, params.file, params.line, params.col)
  const identifier = identifierAtNode(node)
  const definitions = identifier.getDefinitionNodes()
  const lines = [
    `# ${params.file}:${params.line}:${params.col}`,
    `tsconfig: ${displayPath(ctx.cwd, entry.tsconfigPath)}`,
    `symbol:   ${identifier.getText()}`,
  ]

  if (definitions.length === 0) {
    lines.push("", "no definition found (built-in or unresolved).")
    return { text: lines.join("\n"), details: { tsconfigPath: entry.tsconfigPath, count: 0 } }
  }

  lines.push("", `definition (${definitions.length}):`)
  for (const definition of definitions.slice(0, DEFAULT_MAX_RESULTS)) {
    const kindName = definition.getKindName()
    const name = Node.hasName(definition) ? `${kindName} ${definition.getName()}` : kindName
    lines.push(`  ${name}`)
    lines.push(
      `    at ${formatLocation(ctx.cwd, definition.getSourceFile(), definition.getStart())}`
    )
    lines.push(`    ${textPreview(definition.getText().split("\n")[0] ?? "")}`)
  }

  if (definitions.length > DEFAULT_MAX_RESULTS) {
    lines.push(`  ... ${definitions.length - DEFAULT_MAX_RESULTS} more definitions omitted`)
  }

  return {
    text: lines.join("\n"),
    details: { tsconfigPath: entry.tsconfigPath, count: definitions.length },
  }
}

function referencesAt(params: ReferencesAtParams, ctx: ExtensionContext): TextWithDetails {
  const maxResults = clampInt(params.maxResults, DEFAULT_MAX_RESULTS, 1, MAX_RESULTS)
  const { entry, node } = resolveSourceNode(ctx.cwd, params.file, params.line, params.col)
  const identifier = identifierAtNode(node)
  const references = identifier.findReferencesAsNodes()
  const lines = [
    `# ${params.file}:${params.line}:${params.col}`,
    `tsconfig: ${displayPath(ctx.cwd, entry.tsconfigPath)}`,
    `symbol:   ${identifier.getText()}`,
  ]

  if (references.length === 0) {
    lines.push("", "no references found.")
    return { text: lines.join("\n"), details: { tsconfigPath: entry.tsconfigPath, count: 0 } }
  }

  const shown = references.slice(0, maxResults)
  const byFile = new Map<string, Node[]>()
  for (const reference of shown) {
    const filePath = reference.getSourceFile().getFilePath()
    byFile.set(filePath, [...(byFile.get(filePath) ?? []), reference])
  }

  lines.push("", `references (${references.length}) in ${byFile.size} shown file(s):`)
  for (const [filePath, nodes] of byFile) {
    const sourceFile = nodes[0]?.getSourceFile()
    lines.push(`  ${sourceFile ? displayPath(ctx.cwd, sourceFile.getFilePath()) : filePath}`)
    const fullText = sourceFile?.getFullText() ?? ""
    const sourceLines = fullText.split("\n")

    for (const reference of nodes) {
      const { line, column } = reference.getSourceFile().getLineAndColumnAtPos(reference.getStart())
      const lineText = sourceLines[line - 1]?.trim() ?? ""
      lines.push(`    ${line}:${column}  ${truncateLine(lineText, 240)}`)
    }
  }

  if (references.length > shown.length) {
    lines.push(
      ``,
      `... ${references.length - shown.length} more references omitted. Increase maxResults if needed.`
    )
  }

  return {
    text: lines.join("\n"),
    details: { tsconfigPath: entry.tsconfigPath, count: references.length, shown: shown.length },
  }
}

function diagnostics(params: DiagnosticsParams, ctx: ExtensionContext): TextWithDetails {
  const maxResults = clampInt(params.maxResults, DEFAULT_MAX_RESULTS, 1, MAX_RESULTS)
  const absoluteFile = params.file ? absolutePath(ctx.cwd, params.file) : ctx.cwd
  const entry = getProjectForPath(ctx.cwd, absoluteFile)
  const sourceFile = params.file ? sourceFileForPath(entry, absoluteFile) : undefined
  const diagnostics = sourceFile
    ? sourceFile.getPreEmitDiagnostics()
    : entry.project.getPreEmitDiagnostics()
  const errorCount = diagnostics.filter(
    (diagnostic) => diagnostic.getCategory() === ts.DiagnosticCategory.Error
  ).length
  const lines = [
    `# ${params.file ?? "project"}`,
    `tsconfig: ${displayPath(ctx.cwd, entry.tsconfigPath)}`,
  ]

  if (diagnostics.length === 0) {
    lines.push("no diagnostics.")
    return {
      text: lines.join("\n"),
      details: { tsconfigPath: entry.tsconfigPath, count: 0, errorCount: 0 },
    }
  }

  lines.push(`${diagnostics.length} diagnostic(s), ${errorCount} error(s):`)
  for (const diagnostic of diagnostics.slice(0, maxResults)) {
    const source = diagnostic.getSourceFile()
    const start = diagnostic.getStart()
    const location =
      source && start !== undefined
        ? formatLocation(ctx.cwd, source, start)
        : (source?.getFilePath() ?? "(no file)")
    const category = diagnostic.getCategory()
    const categoryName = ts.DiagnosticCategory[category]
    const message = ts.flattenDiagnosticMessageText(diagnostic.compilerObject.messageText, "\n    ")
    lines.push(`  ${location}  ${categoryName} TS${diagnostic.getCode()}: ${message}`)
  }

  if (diagnostics.length > maxResults) {
    lines.push(
      ``,
      `... ${diagnostics.length - maxResults} more diagnostics omitted. Increase maxResults if needed.`
    )
  }

  return {
    text: lines.join("\n"),
    details: { tsconfigPath: entry.tsconfigPath, count: diagnostics.length, errorCount },
  }
}

// Extension entrypoint

export default function tsContextExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "ts_type_at",
    label: "TS Type At",
    description:
      "Resolve the TypeScript compiler-inferred type at a precise source position. Output is depth-limited and cached per tsconfig.",
    promptSnippet: "Inspect compiler-inferred TypeScript types at a source position.",
    promptGuidelines: TOOL_GUIDELINES,
    parameters: typeAtSchema,
    async execute(_toolCallId, params: TypeAtParams, _signal, _onUpdate, ctx) {
      try {
        return toToolResult(typeAt(params, ctx))
      } catch (error) {
        return toErrorResult(error, { tool: "ts_type_at" })
      }
    },
  })

  pi.registerTool({
    name: "ts_definition_at",
    label: "TS Definition At",
    description:
      "Find the TypeScript semantic definition for the identifier at a precise source position.",
    promptSnippet:
      "Find the TypeScript definition for an identifier using the compiler symbol graph.",
    promptGuidelines: TOOL_GUIDELINES,
    parameters: locSchema,
    async execute(_toolCallId, params: LocParams, _signal, _onUpdate, ctx) {
      try {
        return toToolResult(definitionAt(params, ctx))
      } catch (error) {
        return toErrorResult(error, { tool: "ts_definition_at" })
      }
    },
  })

  pi.registerTool({
    name: "ts_references_at",
    label: "TS References At",
    description:
      "Find semantic TypeScript references for the identifier at a precise source position. This walks the whole tsconfig program.",
    promptSnippet: "Find semantic TypeScript references for an identifier before refactors.",
    promptGuidelines: TOOL_GUIDELINES,
    parameters: referencesAtSchema,
    async execute(_toolCallId, params: ReferencesAtParams, _signal, _onUpdate, ctx) {
      try {
        return toToolResult(referencesAt(params, ctx))
      } catch (error) {
        return toErrorResult(error, { tool: "ts_references_at" })
      }
    },
  })

  pi.registerTool({
    name: "ts_diagnostics",
    label: "TS Diagnostics",
    description:
      "Show TypeScript pre-emit diagnostics for a file or the nearest tsconfig project. Uses a warm cached project.",
    promptSnippet: "Show TypeScript diagnostics for a file or project.",
    promptGuidelines: TOOL_GUIDELINES,
    parameters: diagnosticsSchema,
    async execute(_toolCallId, params: DiagnosticsParams, _signal, _onUpdate, ctx) {
      try {
        return toToolResult(diagnostics(params, ctx))
      } catch (error) {
        return toErrorResult(error, { tool: "ts_diagnostics" })
      }
    },
  })

  pi.registerTool({
    name: "ts_context_reload",
    label: "TS Context Reload",
    description:
      "Clear the warm TypeScript project cache. Use after file changes outside Pi edit/write tools, branch switches, installs, or tsconfig changes.",
    promptSnippet:
      "Clear the warm TypeScript semantic cache when project files changed outside Pi tools.",
    promptGuidelines: TOOL_GUIDELINES,
    parameters: reloadSchema,
    async execute(_toolCallId, params: ReloadParams) {
      const count = clearProjectCache()
      const reason = params.reason?.trim()
      return toToolResult({
        text: `Cleared ${count} cached TypeScript project(s).${reason ? ` Reason: ${reason}` : ""}`,
        details: { cleared: count, reason },
      })
    },
  })

  pi.on("tool_result", (event) => {
    if (event.isError) return
    if (event.toolName !== "edit" && event.toolName !== "write") return
    clearProjectCache()
  })

  pi.registerCommand("ts-context-reload", {
    description: "Clear the warm TypeScript project cache used by ts_* tools",
    handler: async (_args, ctx) => {
      const count = clearProjectCache()
      ctx.ui.notify(`Cleared ${count} cached TypeScript project(s).`, "info")
    },
  })
}
