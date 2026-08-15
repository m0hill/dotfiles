import { homedir } from "node:os"
import { relative } from "node:path"
import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai"
import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
  Theme,
} from "@earendil-works/pi-coding-agent"
import { getCapabilities, hyperlink, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui"

const GIT_POLL_INTERVAL_MS = 3_000
const COMMAND_TIMEOUT_MS = 3_000
const LIVE_TPS_UPDATE_INTERVAL_MS = 200
const RESET = "\x1b[0m"
const RED_PALETTE: Rgb[] = [
  [159, 18, 57],
  [220, 20, 60],
  [248, 113, 113],
  [220, 20, 60],
  [159, 18, 57],
]
const TITLE_LINES = [
  "  ██████╗  ██╗ ",
  "  ██╔══██╗ ██║ ",
  "  ██████╔╝ ██║ ",
  "  ██╔═══╝  ██║ ",
  "  ██║      ██║ ",
  "  ╚═╝      ╚═╝ ",
]

type Rgb = [number, number, number]

type PullRequest = {
  number: number
  url: string
}

type GitInfo = {
  branch: string | null
  changedFiles: number
  pullRequest: PullRequest | null
}

const EMPTY_GIT_INFO: GitInfo = {
  branch: null,
  changedFiles: 0,
  pullRequest: null,
}

export default function dashboardExtension(pi: ExtensionAPI): void {
  let ctx: ExtensionContext | undefined
  let gitInfo = EMPTY_GIT_INFO
  let render: (() => void) | undefined
  let gitPoll: ReturnType<typeof setInterval> | undefined
  let gitRefreshRunning = false
  let queriedPrBranch: string | null = null
  let generation = 0
  let streamStartedAt: number | undefined
  let streamedCharacters = 0
  let lastTpsUpdate = 0
  let tokensPerSecond: number | undefined

  const requestRender = () => render?.()

  function resetStream(): void {
    streamStartedAt = undefined
    streamedCharacters = 0
    lastTpsUpdate = 0
  }

  async function refreshGit(activeCtx: ExtensionContext, activeGeneration: number): Promise<void> {
    if (gitRefreshRunning) return
    gitRefreshRunning = true

    try {
      const repository = await pi.exec("git", ["rev-parse", "--is-inside-work-tree"], {
        cwd: activeCtx.cwd,
        timeout: COMMAND_TIMEOUT_MS,
      })
      if (activeGeneration !== generation) return
      if (repository.code !== 0 || repository.stdout.trim() !== "true") {
        queriedPrBranch = null
        gitInfo = EMPTY_GIT_INFO
        requestRender()
        return
      }

      const [branchResult, headResult, statusResult] = await Promise.all([
        pi.exec("git", ["branch", "--show-current"], {
          cwd: activeCtx.cwd,
          timeout: COMMAND_TIMEOUT_MS,
        }),
        pi.exec("git", ["rev-parse", "--short", "HEAD"], {
          cwd: activeCtx.cwd,
          timeout: COMMAND_TIMEOUT_MS,
        }),
        pi.exec("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
          cwd: activeCtx.cwd,
          timeout: COMMAND_TIMEOUT_MS,
        }),
      ])
      if (activeGeneration !== generation) return

      const branchName = branchResult.stdout.trim()
      const shortHead = headResult.stdout.trim()
      const branch = branchName || (shortHead ? `detached@${shortHead}` : "detached")
      const branchChanged = branch !== gitInfo.branch
      gitInfo = {
        branch,
        changedFiles:
          statusResult.code === 0
            ? statusResult.stdout.split("\n").filter((line) => line.length > 0).length
            : 0,
        pullRequest: branchChanged ? null : gitInfo.pullRequest,
      }
      requestRender()

      if (!branchName) {
        queriedPrBranch = null
        return
      }
      if (branchName === queriedPrBranch) return
      queriedPrBranch = branchName

      const prResult = await pi.exec(
        "gh",
        ["pr", "view", branchName, "--json", "number,url,state"],
        { cwd: activeCtx.cwd, timeout: COMMAND_TIMEOUT_MS }
      )
      if (activeGeneration !== generation || prResult.code !== 0) return

      gitInfo = { ...gitInfo, pullRequest: parsePullRequest(prResult.stdout) }
      requestRender()
    } catch {
      if (activeGeneration === generation) {
        gitInfo = EMPTY_GIT_INFO
        requestRender()
      }
    } finally {
      gitRefreshRunning = false
    }
  }

  function queueGitRefresh(): void {
    if (ctx) void refreshGit(ctx, generation)
  }

  pi.on("session_start", (_event, activeCtx) => {
    ctx = activeCtx
    generation += 1
    queriedPrBranch = null
    gitInfo = EMPTY_GIT_INFO
    tokensPerSecond = undefined
    resetStream()

    if (gitPoll) clearInterval(gitPoll)
    if (activeCtx.mode !== "tui") return

    activeCtx.ui.setHeader((tui, theme) => {
      render = () => tui.requestRender()
      return {
        render(width: number): string[] {
          const safeWidth = Math.max(1, width)
          const title = TITLE_LINES.map((line, row) => center(redGradient(line, row), safeWidth))
          const subtitle = center(
            theme.fg("accent", theme.bold(formatDirectory(activeCtx.cwd))),
            safeWidth
          )
          return ["", ...title, subtitle, ""]
        },
        invalidate() {},
      }
    })

    activeCtx.ui.setFooter((tui, theme, footerData: ReadonlyFooterDataProvider) => {
      render = () => tui.requestRender()
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender())

      return {
        dispose: unsubscribe,
        invalidate() {},
        render(width: number): string[] {
          return renderFooter(pi, activeCtx, gitInfo, tokensPerSecond, footerData, theme, width)
        },
      }
    })

    activeCtx.ui.setTitle(`pi · ${formatDirectory(activeCtx.cwd)}`)
    queueGitRefresh()
    gitPoll = setInterval(queueGitRefresh, GIT_POLL_INTERVAL_MS)
    gitPoll.unref?.()
  })

  pi.on("model_select", requestRender)
  pi.on("thinking_level_select", requestRender)
  pi.on("turn_end", requestRender)
  pi.on("tool_execution_end", queueGitRefresh)
  pi.on("input", () => {
    queueGitRefresh()
    return { action: "continue" }
  })

  pi.on("agent_start", () => {
    tokensPerSecond = undefined
    resetStream()
    requestRender()
  })

  pi.on("message_start", (event) => {
    if (event.message.role === "assistant") resetStream()
  })

  pi.on("message_update", (event) => {
    if (event.message.role !== "assistant") return
    const delta = contentDelta(event.assistantMessageEvent)
    if (!delta) return

    const now = Date.now()
    streamStartedAt ??= now
    streamedCharacters += delta.length
    const elapsedMs = now - streamStartedAt
    if (elapsedMs <= 0 || now - lastTpsUpdate < LIVE_TPS_UPDATE_INTERVAL_MS) return

    lastTpsUpdate = now
    tokensPerSecond = streamedCharacters / 4 / (elapsedMs / 1_000)
    requestRender()
  })

  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant" || streamStartedAt === undefined) return
    const elapsedMs = Date.now() - streamStartedAt
    if (elapsedMs > 0 && event.message.usage.output > 0) {
      tokensPerSecond = event.message.usage.output / (elapsedMs / 1_000)
    }
    requestRender()
  })

  pi.on("session_shutdown", (_event, activeCtx) => {
    generation += 1
    ctx = undefined
    render = undefined
    if (gitPoll) clearInterval(gitPoll)
    gitPoll = undefined
    if (activeCtx.mode === "tui") {
      activeCtx.ui.setHeader(undefined)
      activeCtx.ui.setFooter(undefined)
      activeCtx.ui.setTitle("pi")
    }
  })
}

function renderFooter(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  gitInfo: GitInfo,
  tokensPerSecond: number | undefined,
  footerData: ReadonlyFooterDataProvider,
  theme: Theme,
  width: number
): string[] {
  const safeWidth = Math.max(1, width)
  const model = ctx.model
  const modelLabel = model
    ? `${model.provider}/${model.id} · ${model.reasoning ? pi.getThinkingLevel() : "off"}`
    : "no model"
  const usage = ctx.getContextUsage()
  const contextPercent = usage?.percent == null ? "?" : `${Math.round(usage.percent)}%`
  const contextWindow = formatTokens(usage?.contextWindow ?? model?.contextWindow ?? 0)
  const cost = sessionCost(ctx)
  const speed = tokensPerSecond === undefined ? "— tok/s" : `${Math.round(tokensPerSecond)} tok/s`
  const usageLabel = `${contextPercent}/${contextWindow} · $${cost.toFixed(2)} · ${speed}`
  const directory = theme.fg("text", formatDirectory(ctx.cwd))
  const gitLabel = formatGitInfo(gitInfo)
  const statuses = footerData.getExtensionStatuses()
  const mcpStatus = statuses.get("mcp")?.replace(/\s*\n\s*/g, " · ")
  const directoryStatus = mcpStatus ? `${theme.fg("dim", mcpStatus)} · ${directory}` : directory

  const lines = [
    columns(directoryStatus, theme.fg("muted", modelLabel), safeWidth),
    columns(theme.fg("muted", usageLabel), theme.fg("muted", gitLabel), safeWidth),
  ]

  const extraStatuses = Array.from(statuses.entries())
    .filter(([key]) => key !== "mcp")
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([, text]) => text.split("\n"))
  for (const status of extraStatuses) {
    lines.push(truncateToWidth(status, safeWidth, theme.fg("dim", "…")))
  }

  return lines
}

function sessionCost(ctx: ExtensionContext): number {
  let cost = 0
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      cost += (entry.message as AssistantMessage).usage.cost.total
    }
  }
  return cost
}

function contentDelta(event: AssistantMessageEvent): string | undefined {
  if (event.type !== "text_delta" && event.type !== "thinking_delta") return undefined
  return event.delta || undefined
}

function parsePullRequest(raw: string): PullRequest | null {
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || value.state !== "OPEN") return null
    if (typeof value.number !== "number" || typeof value.url !== "string") return null
    return { number: value.number, url: value.url }
  } catch {
    return null
  }
}

function formatGitInfo(info: GitInfo): string {
  if (!info.branch) return ""
  const fileLabel = info.changedFiles === 1 ? "file" : "files"
  let label = `${info.branch} · ${info.changedFiles} ${fileLabel} changed`
  if (info.pullRequest) {
    const text = `PR #${info.pullRequest.number}`
    label += ` · ${getCapabilities().hyperlinks ? hyperlink(text, info.pullRequest.url) : text}`
  }
  return label
}

function formatDirectory(cwd: string): string {
  const home = homedir()
  const path = cwd === home ? "~" : cwd.startsWith(`${home}/`) ? `~/${relative(home, cwd)}` : cwd
  return sanitizeTerminalLabel(path)
}

function sanitizeTerminalLabel(text: string): string {
  return Array.from(text)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0
      return code >= 32 && (code < 127 || code > 159)
    })
    .join("")
}

function formatTokens(tokens: number): string {
  if (tokens <= 0) return "?"
  if (tokens < 1_000) return `${tokens}`
  if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}k`
  return `${(tokens / 1_000_000).toFixed(1)}M`
}

function redGradient(text: string, row: number): string {
  const characters = Array.from(text)
  const span = Math.max(1, characters.length - 1)

  return characters
    .map((character, index) => {
      if (character === " ") return character
      return foreground(sampleRedGradient(index / span + row * 0.035), character)
    })
    .join("")
}

function sampleRedGradient(position: number): Rgb {
  const wrapped = ((position % 1) + 1) % 1
  const scaled = wrapped * (RED_PALETTE.length - 1)
  const index = Math.min(Math.floor(scaled), RED_PALETTE.length - 2)
  const amount = scaled - index
  const start = RED_PALETTE[index] ?? RED_PALETTE[0]!
  const end = RED_PALETTE[index + 1] ?? RED_PALETTE[RED_PALETTE.length - 1]!

  return [
    mix(start[0], end[0], amount),
    mix(start[1], end[1], amount),
    mix(start[2], end[2], amount),
  ]
}

function mix(start: number, end: number, amount: number): number {
  return Math.round(start + (end - start) * amount)
}

function foreground([red, green, blue]: Rgb, text: string): string {
  return `\x1b[38;2;${red};${green};${blue}m${text}${RESET}`
}

function center(text: string, width: number): string {
  const padding = Math.max(0, Math.floor((width - visibleWidth(text)) / 2))
  return truncateToWidth(`${" ".repeat(padding)}${text}`, width, "")
}

function columns(left: string, right: string, width: number): string {
  if (!right) return truncateToWidth(left, width)

  const naturalGap = width - visibleWidth(left) - visibleWidth(right)
  if (naturalGap >= 1) return `${left}${" ".repeat(naturalGap)}${right}`

  const leftWidth = Math.max(1, Math.floor(width * 0.45))
  const rightWidth = Math.max(1, width - leftWidth - 1)
  const fittedLeft = truncateToWidth(left, leftWidth)
  const fittedRight = truncateToWidth(right, rightWidth)
  const gap = Math.max(1, width - visibleWidth(fittedLeft) - visibleWidth(fittedRight))
  return truncateToWidth(`${fittedLeft}${" ".repeat(gap)}${fittedRight}`, width)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
