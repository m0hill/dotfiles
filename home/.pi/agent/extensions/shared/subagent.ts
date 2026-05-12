import type { AgentMessage } from "@earendil-works/pi-agent-core"
import {
  createAgentSession,
  createBashToolDefinition,
  createExtensionRuntime,
  createLocalBashOperations,
  SessionManager,
  type AgentSessionEvent,
  type ExtensionCommandContext,
  type ExtensionContext,
  type ResourceLoader,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent"

// Constants

const STORE_KEY = Symbol.for("mohil.pi.subagents")
const WIDGET_KEY = "subagents"
const DONE_LINGER_MS = 45_000
const RUN_RETENTION_MS = 10 * 60_000
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const READ_ONLY_DENIED_TOOLS = new Set(["edit", "write"])
const READ_ONLY_BASH_DENIED_CUSTOM_TOOLS = new Set(["bash", "edit", "write"])
const READ_ONLY_BASH_FORBIDDEN_SHELL_SYNTAX = /[\n;&|<>`]|\$\(|\$\{/u
const READ_ONLY_BASH_ALLOWED_COMMANDS = new Set([
  "cat",
  "fd",
  "find",
  "git",
  "grep",
  "head",
  "ls",
  "pwd",
  "rg",
  "sed",
  "tail",
  "wc",
])
const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  "blame",
  "branch",
  "diff",
  "grep",
  "log",
  "ls-files",
  "rev-parse",
  "show",
  "status",
])

// Types

type AgentSessionOptions = NonNullable<Parameters<typeof createAgentSession>[0]>
type ThinkingLevel = NonNullable<AgentSessionOptions["thinkingLevel"]>

type RunStatus = "running" | "completed" | "error" | "cancelled"

type AssistantMessage = Extract<AgentMessage, { role: "assistant" }>
type MessageWithContent = Extract<AgentMessage, { content: unknown }>
type Usage = AssistantMessage["usage"]

type TrackedRunRecord = {
  id: string
  label: string
  status: RunStatus
  startedAt: number
  completedAt?: number
  cwd: string
  tools: string[]
  currentTool?: string
  toolCount: number
  turnCount: number
  recentOutput: string[]
  usage: Usage
  error?: string
}

type Store = {
  runs: Map<string, TrackedRunRecord>
  ui?: Pick<ExtensionContext["ui"], "setWidget" | "setStatus">
  frame: number
  timer?: ReturnType<typeof setInterval>
}

export type TrackedSubagentOptions = {
  ctx: ExtensionContext | ExtensionCommandContext
  label: string
  prompt: string
  systemPrompt: string
  tools?: string[]
  customTools?: ToolDefinition[]
  thinkingLevel?: ThinkingLevel
  readOnly?: boolean
  timeoutMs?: number
  signal?: AbortSignal
}

export type TrackedSubagentResult = {
  id: string
  label: string
  text: string
  durationMs: number
  toolCount: number
  turnCount: number
  usage: Usage
}

// Generic helpers

function store(): Store {
  const globalStore = globalThis as Record<PropertyKey, unknown>
  const existing = globalStore[STORE_KEY]
  if (isStore(existing)) return existing

  const created: Store = {
    runs: new Map(),
    frame: 0,
  }
  globalStore[STORE_KEY] = created
  return created
}

function isStore(value: unknown): value is Store {
  return (
    typeof value === "object" &&
    value !== null &&
    "runs" in value &&
    (value as { runs?: unknown }).runs instanceof Map
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

function hasContent(message: AgentMessage): message is MessageWithContent {
  return "content" in message
}

function textFromContent(content: MessageWithContent["content"]): string {
  if (typeof content === "string") return content

  return content
    .map((part) => {
      switch (part.type) {
        case "text":
          return part.text
        case "thinking":
          return part.thinking
        default:
          return ""
      }
    })
    .filter(Boolean)
    .join("\n")
}

function latestAssistantText(messages: AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== "assistant" || !hasContent(message)) continue
    const text = textFromContent(message.content).trim()
    if (text) return text
  }
  return ""
}

function pushRecentOutput(record: TrackedRunRecord, text: string): void {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-5)
  if (lines.length === 0) return
  record.recentOutput.push(...lines)
  record.recentOutput = record.recentOutput.slice(-12)
}

function usageFromMessage(message: AgentMessage): Usage | undefined {
  return message.role === "assistant" ? message.usage : undefined
}

function addUsage(target: Usage, source: Usage): void {
  target.input += source.input
  target.output += source.output
  target.cacheRead += source.cacheRead
  target.cacheWrite += source.cacheWrite
  target.totalTokens += source.totalTokens
  target.cost.input += source.cost.input
  target.cost.output += source.cost.output
  target.cost.cacheRead += source.cost.cacheRead
  target.cost.cacheWrite += source.cost.cacheWrite
  target.cost.total += source.cost.total
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  return `${minutes}m${seconds.toString().padStart(2, "0")}s`
}

function formatTokens(usage: Usage): string | undefined {
  const total = usage.totalTokens || usage.input + usage.output + usage.cacheWrite
  if (total <= 0) return undefined
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M token`
  if (total >= 1_000) return `${(total / 1_000).toFixed(1)}k token`
  return `${total} token`
}

function truncateLine(input: string, max = 90): string {
  const line =
    input
      .split("\n")
      .find((item) => item.trim())
      ?.trim() ?? ""
  if (line.length <= max) return line
  return `${line.slice(0, max - 1).trimEnd()}…`
}

function isTerminal(status: RunStatus): boolean {
  return status === "completed" || status === "error" || status === "cancelled"
}

function iconFor(record: TrackedRunRecord, frame: number): string {
  if (record.status === "running") return SPINNER[frame % SPINNER.length] ?? "⠋"
  if (record.status === "completed") return "✓"
  if (record.status === "cancelled") return "■"
  return "✗"
}

function pruneRuns(now = Date.now()): void {
  const current = store()
  for (const [id, record] of current.runs) {
    if (!isTerminal(record.status)) continue
    const completedAt = record.completedAt ?? record.startedAt
    if (now - completedAt > RUN_RETENTION_MS) current.runs.delete(id)
  }
}

function visibleRuns(now = Date.now()): TrackedRunRecord[] {
  pruneRuns(now)
  return [...store().runs.values()]
    .filter((record) => {
      if (!isTerminal(record.status)) return true
      const completedAt = record.completedAt ?? record.startedAt
      return now - completedAt <= DONE_LINGER_MS
    })
    .sort((left, right) => left.startedAt - right.startedAt)
}

function renderLines(now = Date.now()): string[] {
  const current = store()
  const runs = visibleRuns(now)
  if (runs.length === 0) return []

  const lines = ["● Subagents"]
  for (const [index, record] of runs.slice(-8).entries()) {
    const branch = index === Math.min(runs.length, 8) - 1 ? "└─" : "├─"
    const elapsedMs = (record.completedAt ?? now) - record.startedAt
    const parts = [record.status, `${record.toolCount} tools`, `${record.turnCount} turns`]
    const tokens = formatTokens(record.usage)
    if (tokens) parts.push(tokens)
    parts.push(formatDuration(elapsedMs))
    const tool = record.currentTool ? ` · ${record.currentTool}` : ""
    lines.push(
      `${branch} ${iconFor(record, current.frame)} ${record.label}${tool} · ${parts.join(" · ")}`
    )

    const latest = record.error ?? record.recentOutput.at(-1)
    if (latest)
      lines.push(
        `${index === Math.min(runs.length, 8) - 1 ? "   " : "│  "} ⎿ ${truncateLine(latest)}`
      )
  }
  return lines
}

function updateWidget(): void {
  const current = store()
  if (!current.ui) return

  const lines = renderLines()
  if (lines.length === 0) {
    current.ui.setWidget(WIDGET_KEY, undefined)
    current.ui.setStatus(WIDGET_KEY, undefined)
    stopTimerIfIdle()
    return
  }

  current.ui.setWidget(WIDGET_KEY, lines)
  const running = [...current.runs.values()].filter((record) => record.status === "running").length
  current.ui.setStatus(WIDGET_KEY, running > 0 ? `subagents: ${running} running` : undefined)
}

function ensureTimer(): void {
  const current = store()
  if (current.timer) return
  current.timer = setInterval(() => {
    current.frame++
    updateWidget()
  }, 120)
  current.timer.unref?.()
}

function stopTimerIfIdle(): void {
  const current = store()
  if ([...current.runs.values()].some((record) => record.status === "running")) return
  if (!current.timer) return
  clearInterval(current.timer)
  current.timer = undefined
}

function runId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function validateReadOnlyTools(tools: string[], customTools: ToolDefinition[]): void {
  const denied = [
    ...tools.filter((tool) => READ_ONLY_DENIED_TOOLS.has(tool)),
    ...customTools
      .map((tool) => tool.name)
      .filter((tool) => READ_ONLY_BASH_DENIED_CUSTOM_TOOLS.has(tool)),
  ]
  if (denied.length > 0) {
    throw new Error(
      `Read-only subagent cannot use these tools: ${[...new Set(denied)].sort().join(", ")}. ` +
        "Use read, grep, find, ls, policy-wrapped bash, or purpose-built non-mutating custom tools instead."
    )
  }
}

export function readOnlyBashBlockReason(command: string): string | undefined {
  const trimmed = command.trim()
  if (!trimmed) return "Empty bash command."
  if (READ_ONLY_BASH_FORBIDDEN_SHELL_SYNTAX.test(trimmed)) {
    return "Read-only bash allows one simple command only; shell control operators, pipes, redirects, and command substitution are blocked."
  }

  const match = trimmed.match(/^(?:command\s+)?([A-Za-z0-9_.+-]+)(?:\s+([\s\S]*))?$/u)
  if (!match) return "Could not parse command as a simple read-only command."

  const executable = match[1] ?? ""
  const args = match[2] ?? ""
  if (!READ_ONLY_BASH_ALLOWED_COMMANDS.has(executable)) {
    return `Command '${executable}' is not in the read-only bash allowlist.`
  }

  if (/\b(--output|-o)\b/u.test(args))
    return "Output-writing options are blocked in read-only bash."
  if (executable === "find" && /(?:^|\s)-(?:delete|exec|execdir|ok|okdir)(?:\s|$)/u.test(args)) {
    return "Mutating find actions are blocked in read-only bash."
  }
  if (executable === "fd" && /(?:^|\s)(?:-x|--exec|-X)(?:\s|$)/u.test(args)) {
    return "fd exec actions are blocked in read-only bash."
  }
  if (executable === "sed" && /(?:^|\s)-[^\s]*i[^\s]*(?:\s|$)/u.test(args)) {
    return "sed in-place editing is blocked in read-only bash."
  }
  if (executable === "git") {
    const subcommand = args.trim().split(/\s+/u)[0] ?? ""
    if (!READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) {
      return `git ${subcommand || "(no subcommand)"} is not in the read-only git allowlist.`
    }
  }

  return undefined
}

function createReadOnlyBashTool(cwd: string): ToolDefinition {
  const local = createLocalBashOperations()
  return createBashToolDefinition(cwd, {
    operations: {
      exec(command, cwd, options) {
        const reason = readOnlyBashBlockReason(command)
        if (reason) throw new Error(`Read-only bash blocked command: ${reason}`)
        return local.exec(command, cwd, options)
      },
    },
  }) as ToolDefinition
}

function appendReadOnlyBoundary(systemPrompt: string, hasReadOnlyBash: boolean): string {
  const bashBoundary = hasReadOnlyBash
    ? "Bash is available only through a strict read-only allowlist for simple inspection commands such as git status/diff/log/show, rg, grep, find, ls, cat, head, tail, wc, and pwd. If bash blocks a command, use read/grep/find/ls instead or report the limitation."
    : "Shell execution is unavailable in this subagent."

  return [
    systemPrompt,
    "",
    `Read-only runtime boundary: mutating tools are unavailable. ${bashBoundary}`,
  ].join("\n")
}

// Resource helpers

export function createSystemPromptResourceLoader(systemPrompt: string): ResourceLoader {
  const extensionsResult = { extensions: [], errors: [], runtime: createExtensionRuntime() }

  return {
    getExtensions: () => extensionsResult,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getAppendSystemPrompt: () => [],
    extendResources: () => {},
    reload: async () => {},
  }
}

// Run helpers

export async function runTrackedAgent(
  options: TrackedSubagentOptions
): Promise<TrackedSubagentResult> {
  if (!options.ctx.model) throw new Error(`No active model selected for ${options.label}.`)

  const current = store()
  if (options.ctx.hasUI) current.ui = options.ctx.ui
  const thinkingLevel = options.thinkingLevel
  const requestedTools = options.tools ?? []
  const customTools = options.customTools ?? []
  const hasReadOnlyBash = options.readOnly === true && requestedTools.includes("bash")
  if (options.readOnly) validateReadOnlyTools(requestedTools, customTools)
  const tools = hasReadOnlyBash ? requestedTools.filter((tool) => tool !== "bash") : requestedTools
  const effectiveCustomTools = hasReadOnlyBash
    ? [...customTools, createReadOnlyBashTool(options.ctx.cwd)]
    : customTools

  const record: TrackedRunRecord = {
    id: runId(),
    label: options.label,
    status: "running",
    startedAt: Date.now(),
    cwd: options.ctx.cwd,
    tools: requestedTools,
    toolCount: 0,
    turnCount: 0,
    recentOutput: [],
    usage: emptyUsage(),
  }
  current.runs.set(record.id, record)
  ensureTimer()
  updateWidget()

  const controller = new AbortController()
  const abort = () => controller.abort()
  const timeout = options.timeoutMs ? setTimeout(abort, options.timeoutMs) : undefined
  options.signal?.addEventListener("abort", abort, { once: true })
  options.ctx.signal?.addEventListener("abort", abort, { once: true })

  let unsubscribe: (() => void) | undefined
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined
  const abortSession = () => {
    void session?.abort()
  }
  controller.signal.addEventListener("abort", abortSession)

  try {
    if (controller.signal.aborted) throw new Error("Cancelled.")

    const created = await createAgentSession({
      cwd: options.ctx.cwd,
      sessionManager: SessionManager.inMemory(options.ctx.cwd),
      model: options.ctx.model,
      modelRegistry: options.ctx.modelRegistry as never,
      thinkingLevel,
      tools: [...tools, ...effectiveCustomTools.map((tool) => tool.name)],
      customTools: effectiveCustomTools,
      resourceLoader: createSystemPromptResourceLoader(
        options.readOnly
          ? appendReadOnlyBoundary(options.systemPrompt, hasReadOnlyBash)
          : options.systemPrompt
      ),
    })
    session = created.session
    if (controller.signal.aborted) throw new Error("Cancelled.")

    unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      if (event.type === "tool_execution_start") {
        record.currentTool = event.toolName
        updateWidget()
      }
      if (event.type === "tool_execution_end") {
        record.toolCount++
        record.currentTool = undefined
        updateWidget()
      }
      if (event.type === "turn_end") {
        record.turnCount++
        updateWidget()
      }
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        pushRecentOutput(record, event.assistantMessageEvent.delta)
        updateWidget()
      }
      if (event.type === "message_end") {
        const text = hasContent(event.message) ? textFromContent(event.message.content).trim() : ""
        if (text) pushRecentOutput(record, text)
        const usage = usageFromMessage(event.message)
        if (usage) addUsage(record.usage, usage)
        updateWidget()
      }
    })

    await session.prompt(options.prompt, { source: "extension" })
    record.status = controller.signal.aborted ? "cancelled" : "completed"
    record.completedAt = Date.now()
    updateWidget()

    const text = latestAssistantText(session.state.messages).trim() || "(No response)"
    return {
      id: record.id,
      label: record.label,
      text,
      durationMs: record.completedAt - record.startedAt,
      toolCount: record.toolCount,
      turnCount: record.turnCount,
      usage: { ...record.usage },
    }
  } catch (error) {
    record.status = controller.signal.aborted ? "cancelled" : "error"
    record.completedAt = Date.now()
    record.error = controller.signal.aborted ? "Cancelled." : errorMessage(error)
    updateWidget()
    throw error
  } finally {
    if (timeout) clearTimeout(timeout)
    options.signal?.removeEventListener("abort", abort)
    options.ctx.signal?.removeEventListener("abort", abort)
    controller.signal.removeEventListener("abort", abortSession)
    unsubscribe?.()
    if (session) {
      try {
        await session.abort()
      } catch {
        // Ignore cleanup errors.
      }
      session.dispose()
    }
    setTimeout(updateWidget, DONE_LINGER_MS + 250).unref?.()
  }
}
