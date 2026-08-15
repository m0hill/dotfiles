import {
  buildSessionContext,
  estimateTokens,
  type ExtensionAPI,
  type Theme,
  type ThemeColor,
} from "@earendil-works/pi-coding-agent"
import { type Component, truncateToWidth } from "@earendil-works/pi-tui"

const BAR_WIDTH = 36
const CUSTOM_ENTRY_TYPE = "context-report"

export type ContextCategory = {
  id: string
  label: string
  tokens: number
}

export type ContextBreakdownInput = {
  systemPrompt: string
  contextFiles: ReadonlyArray<{ content: string }>
  skills: ReadonlyArray<{
    name: string
    description: string
    filePath: string
    disableModelInvocation?: boolean
  }>
  tools: ReadonlyArray<{ name: string; description: string; parameters: unknown }>
  messages: ReadonlyArray<{ role: string; tokens: number }>
  reportedTokens?: number
}

export type ContextBreakdown = {
  categories: ContextCategory[]
  estimatedTokens: number
}

export function textTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function buildContextBreakdown(input: ContextBreakdownInput): ContextBreakdown {
  const promptTokens = textTokens(input.systemPrompt)
  const memoryTokens = input.contextFiles.reduce(
    (total, file) => total + textTokens(file.content),
    0
  )
  const skillTokens = input.skills
    .filter((skill) => !skill.disableModelInvocation)
    .reduce(
      (total, skill) =>
        total + textTokens(`${skill.name}\n${skill.description}\n${skill.filePath}`),
      0
    )
  const systemTokens = Math.max(0, promptTokens - memoryTokens - skillTokens)
  const toolTokens = input.tools.reduce(
    (total, tool) =>
      total +
      textTokens(`${tool.name}\n${tool.description}\n${JSON.stringify(tool.parameters ?? {})}`),
    0
  )

  let userTokens = 0
  let assistantTokens = 0
  let toolResultTokens = 0
  let otherMessageTokens = 0
  for (const message of input.messages) {
    if (message.role === "user") userTokens += message.tokens
    else if (message.role === "assistant") assistantTokens += message.tokens
    else if (message.role === "toolResult") toolResultTokens += message.tokens
    else otherMessageTokens += message.tokens
  }

  const categories: ContextCategory[] = [
    { id: "system", label: "System prompt", tokens: systemTokens },
    { id: "memory", label: "Memory files", tokens: memoryTokens },
    { id: "skills", label: "Skills", tokens: skillTokens },
    { id: "tools", label: "Tool definitions", tokens: toolTokens },
    { id: "user", label: "User messages", tokens: userTokens },
    { id: "assistant", label: "Assistant", tokens: assistantTokens },
    { id: "results", label: "Tool results", tokens: toolResultTokens },
    { id: "other", label: "Other messages", tokens: otherMessageTokens },
  ].filter((category) => category.tokens > 0)

  const measuredTokens = categories.reduce((total, category) => total + category.tokens, 0)
  const unclassifiedTokens = Math.max(0, (input.reportedTokens ?? 0) - measuredTokens)
  if (unclassifiedTokens > 0) {
    categories.push({ id: "overhead", label: "Other / overhead", tokens: unclassifiedTokens })
  }

  return {
    categories,
    estimatedTokens: categories.reduce((total, category) => total + category.tokens, 0),
  }
}

type ContextReportData = {
  categories: ContextCategory[]
  usedTokens: number
  contextWindow?: number
  model?: string
  approximate: boolean
}

// The runtime is Pi 0.84, while this dotfiles package still carries Pi 0.80 types.
type EntryRendererAPI = {
  registerEntryRenderer<T>(
    customType: string,
    renderer: (entry: { data?: T }, options: unknown, theme: Theme) => Component | undefined
  ): void
}

export default function contextExtension(pi: ExtensionAPI): void {
  const entryRendererAPI = pi as ExtensionAPI & EntryRendererAPI
  entryRendererAPI.registerEntryRenderer<ContextReportData>(
    CUSTOM_ENTRY_TYPE,
    (entry, _options, theme) => {
      if (!entry.data) return undefined
      return new ContextReport(theme, entry.data)
    }
  )

  pi.registerCommand("context", {
    description: "Show a simple context usage breakdown",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        if (ctx.hasUI) ctx.ui.notify("/context requires TUI mode", "warning")
        return
      }

      await ctx.waitForIdle()

      const usage = ctx.getContextUsage()
      const options = ctx.getSystemPromptOptions()
      const activeTools = new Set(pi.getActiveTools())
      const messages = buildSessionContext(
        ctx.sessionManager.getEntries(),
        ctx.sessionManager.getLeafId()
      ).messages
      const breakdown = buildContextBreakdown({
        systemPrompt: ctx.getSystemPrompt(),
        contextFiles: options.contextFiles ?? [],
        skills: options.skills ?? [],
        tools: pi.getAllTools().filter((tool) => activeTools.has(tool.name)),
        messages: messages.map((message) => ({
          role: message.role,
          tokens: estimateTokens(message),
        })),
        reportedTokens: usage?.tokens ?? undefined,
      })

      pi.appendEntry(CUSTOM_ENTRY_TYPE, {
        categories: breakdown.categories,
        usedTokens: usage?.tokens ?? breakdown.estimatedTokens,
        contextWindow: usage?.contextWindow ?? ctx.model?.contextWindow,
        model: ctx.model?.id,
        approximate: usage?.tokens == null,
      } satisfies ContextReportData)
    },
  })
}

class ContextReport {
  private readonly theme: Theme
  private readonly data: ContextReportData

  constructor(theme: Theme, data: ContextReportData) {
    this.theme = theme
    this.data = data
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const { theme } = this
    const { usedTokens, contextWindow, approximate, model } = this.data
    const ratio = contextWindow && contextWindow > 0 ? usedTokens / contextWindow : undefined
    const usedPrefix = approximate ? "≈" : ""
    const summary = contextWindow
      ? `${usedPrefix}${formatTokens(usedTokens)} / ${formatTokens(contextWindow)}${
          ratio === undefined ? "" : ` · ${formatPercent(ratio)}`
        }`
      : `${usedPrefix}${formatTokens(usedTokens)} used`

    const lines = [
      theme.fg("accent", theme.bold("Context")),
      theme.fg("muted", [model, summary].filter(Boolean).join(" · ")),
      "",
      this.usageBar(Math.min(BAR_WIDTH, safeWidth), ratio),
      "",
      ...this.categoryLines(safeWidth),
      theme.fg("dim", "Estimated breakdown"),
    ]

    return lines.map((line) => truncateToWidth(line, safeWidth, ""))
  }

  invalidate(): void {}

  private usageBar(width: number, ratio: number | undefined): string {
    const clampedRatio = Math.max(0, Math.min(1, ratio ?? 0))
    const usedWidth = Math.round(width * clampedRatio)
    return (
      this.theme.fg("accent", "━".repeat(usedWidth)) +
      this.theme.fg("dim", "━".repeat(Math.max(0, width - usedWidth)))
    )
  }

  private categoryLines(width: number): string[] {
    const total = this.data.categories.reduce((sum, category) => sum + category.tokens, 0)
    const valueWidth = 14
    const labelWidth = Math.max(8, width - valueWidth)

    return this.data.categories.map((category) => {
      const color = categoryColor(category.id)
      const label = truncateToWidth(category.label, Math.max(1, labelWidth - 3), "…")
      const padding = " ".repeat(Math.max(1, labelWidth - label.length - 2))
      const percent = total > 0 ? formatPercent(category.tokens / total) : "0%"
      return `${this.theme.fg(color, "●")} ${label}${padding}${this.theme.fg(
        "muted",
        `${formatTokens(category.tokens).padStart(6)}  ${percent.padStart(4)}`
      )}`
    })
  }
}

function categoryColor(id: string): ThemeColor {
  switch (id) {
    case "system":
      return "mdHeading"
    case "memory":
      return "syntaxString"
    case "skills":
      return "customMessageLabel"
    case "tools":
      return "accent"
    case "user":
      return "success"
    case "assistant":
      return "syntaxFunction"
    case "results":
      return "toolOutput"
    default:
      return "muted"
  }
}

export function formatTokens(tokens: number): string {
  if (tokens < 1_000) return `${tokens}`
  if (tokens < 1_000_000) return `${trimZero((tokens / 1_000).toFixed(1))}k`
  return `${trimZero((tokens / 1_000_000).toFixed(1))}M`
}

export function formatPercent(ratio: number): string {
  const percent = Math.max(0, ratio) * 100
  return percent < 10 ? `${trimZero(percent.toFixed(1))}%` : `${Math.round(percent)}%`
}

function trimZero(value: string): string {
  return value.endsWith(".0") ? value.slice(0, -2) : value
}
