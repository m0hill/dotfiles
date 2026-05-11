import type { AgentMessage } from "@mariozechner/pi-agent-core"
import {
  getMarkdownTheme,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent"
import { Markdown } from "@mariozechner/pi-tui"
import { Type, type Static, type TUnsafe } from "typebox"
import { readOnlyBashBlockReason, runTrackedAgent } from "../shared/subagent"

// Constants

const INTERROGATE_MESSAGE_TYPE = "interrogate-report"
const MAX_DEFENSE_ROUNDS = 2
const MESSAGE_TRUNCATE_CHARS = 1_200
const TOTAL_HISTORY_CHARS = 30_000
const MAX_HISTORY_ENTRIES = 120
const CHILD_TOOLS = ["read", "grep", "find", "ls", "bash"] as const

// Types

type InterrogateState =
  | { status: "idle" }
  | {
      status: "awaiting_defense"
      round: number
      historyContext: string
      turns: DebateTurn[]
      pendingQuestion: string
    }
  | {
      status: "evaluating"
      round: number
      historyContext: string
      turns: DebateTurn[]
    }

type DebateTurn = {
  round: number
  question: string
  defense: string
}

type TextPart = { type?: unknown; text?: unknown; thinking?: unknown }
type ToolCallPart = { type?: unknown; name?: unknown; arguments?: unknown }
type MessageLike = { role?: unknown; content?: unknown; toolName?: unknown; isError?: unknown }
type MessageEntryLike = { type?: unknown; message?: unknown }

type HistorySummary = {
  lines: string[]
  filesRead: Set<string>
  filesEdited: Set<string>
  commandsRun: string[]
}

// State

let state: InterrogateState = { status: "idle" }

// Schemas

function stringEnum<T extends readonly string[]>(
  values: T,
  options?: { description?: string }
): TUnsafe<T[number]> {
  return Type.Unsafe<T[number]>({ type: "string", enum: [...values], ...options })
}

const chargeSheetSchema = Type.Object({
  questions: Type.String({
    minLength: 1,
    description: "Concise charge sheet of hard questions to send to the main agent.",
  }),
  rootConcerns: Type.Array(Type.String(), {
    description: "Root architectural/design concerns behind the questions.",
  }),
  skippedDetailsReason: Type.Optional(
    Type.String({ description: "Why lower-level review details were intentionally skipped." })
  ),
})

const decisionSchema = Type.Object({
  action: stringEnum(["follow_up", "final_report"] as const, {
    description: "Whether to continue debate with one follow-up or stop with the final report.",
  }),
  content: Type.String({
    minLength: 1,
    description: "Follow-up question for the main agent, or final Markdown report for the human.",
  }),
  reason: Type.String({
    minLength: 1,
    description: "Short internal reason for this control decision.",
  }),
})

type ChargeSheet = Static<typeof chargeSheetSchema>
type InterrogateDecision = Static<typeof decisionSchema>

// Generic helpers

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function truncate(input: string, maxLength = MESSAGE_TRUNCATE_CHARS): string {
  const cleaned = input.trim()
  if (cleaned.length <= maxLength) return cleaned
  return `${cleaned.slice(0, maxLength - 1).trimEnd()}…`
}

function truncateMiddle(input: string, maxLength: number): string {
  const cleaned = input.trim()
  if (cleaned.length <= maxLength) return cleaned
  const half = Math.floor((maxLength - 20) / 2)
  return `${cleaned.slice(0, half).trimEnd()} … ${cleaned.slice(-half).trimStart()}`
}

function stripLargePayloads(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (block) => `\n[code/diff block omitted: ${block.length} chars]\n`)
    .replace(/<diff>[\s\S]*?<\/diff>/gi, (block) => `\n[diff omitted: ${block.length} chars]\n`)
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""

  return content
    .map((part) => {
      if (!isRecord(part)) return ""
      const textPart = part as TextPart
      if (textPart.type === "text" && typeof textPart.text === "string") return textPart.text
      if (textPart.type === "thinking" && typeof textPart.thinking === "string")
        return textPart.thinking
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

function assistantText(message: MessageLike): string {
  return truncate(stripLargePayloads(textFromContent(message.content)))
}

function getMessageFromEntry(entry: unknown): MessageLike | undefined {
  if (!isRecord(entry)) return undefined
  const maybeEntry = entry as MessageEntryLike
  if (maybeEntry.type === "message" && isRecord(maybeEntry.message)) {
    return maybeEntry.message as MessageLike
  }
  if ("role" in entry) return entry as MessageLike
  return undefined
}

function extractAssistantToolCalls(message: MessageLike): ToolCallPart[] {
  if (!Array.isArray(message.content)) return []
  return message.content.filter((part): part is ToolCallPart => {
    if (!isRecord(part)) return false
    return part.type === "toolCall" && typeof part.name === "string"
  })
}

function argString(args: unknown, key: string): string | undefined {
  if (!isRecord(args)) return undefined
  return stringValue(args[key])
}

function summarizeToolCall(toolName: string, args: unknown, summary: HistorySummary): string {
  switch (toolName) {
    case "read": {
      const path = argString(args, "path") ?? argString(args, "file_path") ?? "(unknown path)"
      summary.filesRead.add(path)
      return `TOOL: read ${path}`
    }
    case "edit": {
      const path = argString(args, "path") ?? argString(args, "file_path") ?? "(unknown path)"
      summary.filesEdited.add(path)
      return `TOOL: edit ${path}`
    }
    case "write": {
      const path = argString(args, "path") ?? argString(args, "file_path") ?? "(unknown path)"
      summary.filesEdited.add(path)
      return `TOOL: write ${path}`
    }
    case "bash": {
      const command = truncateMiddle(argString(args, "command") ?? "(unknown command)", 240)
      summary.commandsRun.push(command)
      return `TOOL: bash ${command}`
    }
    case "grep": {
      const pattern = argString(args, "pattern") ?? "(pattern)"
      const path = argString(args, "path") ?? "."
      return `TOOL: grep ${pattern} in ${path}`
    }
    case "find": {
      const pattern = argString(args, "pattern") ?? "(pattern)"
      const path = argString(args, "path") ?? "."
      return `TOOL: find ${pattern} in ${path}`
    }
    case "ls": {
      const path = argString(args, "path") ?? "."
      return `TOOL: ls ${path}`
    }
    default:
      return `TOOL: ${toolName} ${truncateMiddle(JSON.stringify(args ?? {}), 200)}`
  }
}

function appendWithinLimit(lines: string[], line: string, totalLimit: number): void {
  const currentLength = lines.join("\n").length
  if (currentLength >= totalLimit) return
  const remaining = totalLimit - currentLength
  lines.push(line.length > remaining ? truncate(line, remaining) : line)
}

// Session/message helpers

function collectHistoryContext(ctx: ExtensionCommandContext | ExtensionContext): string {
  const branch = ctx.sessionManager.getBranch().slice(-MAX_HISTORY_ENTRIES)
  const summary: HistorySummary = {
    lines: [],
    filesRead: new Set(),
    filesEdited: new Set(),
    commandsRun: [],
  }

  for (const entry of branch) {
    const message = getMessageFromEntry(entry)
    if (!message) continue

    if (message.role === "user") {
      const text = truncate(stripLargePayloads(textFromContent(message.content)))
      if (text) appendWithinLimit(summary.lines, `USER: ${text}`, TOTAL_HISTORY_CHARS)
      continue
    }

    if (message.role === "assistant") {
      const text = assistantText(message)
      if (text) appendWithinLimit(summary.lines, `ASSISTANT: ${text}`, TOTAL_HISTORY_CHARS)

      for (const toolCall of extractAssistantToolCalls(message)) {
        const name = typeof toolCall.name === "string" ? toolCall.name : "tool"
        appendWithinLimit(
          summary.lines,
          summarizeToolCall(name, toolCall.arguments, summary),
          TOTAL_HISTORY_CHARS
        )
      }
      continue
    }

    if (message.role === "toolResult") {
      const toolName = typeof message.toolName === "string" ? message.toolName : "tool"
      const status = message.isError === true ? "error" : "ok"
      appendWithinLimit(summary.lines, `TOOL_RESULT: ${toolName} ${status}`, TOTAL_HISTORY_CHARS)
    }
  }

  const sections = [
    "## Prior Session Context",
    "This is a compact summary for intent and implementation-memory only. Tool result bodies and large code/diff payloads are intentionally omitted.",
    "",
    "### Conversation and Tool Activity",
    summary.lines.join("\n") || "(No prior session context available.)",
    "",
    "### Files Read",
    [...summary.filesRead]
      .sort()
      .map((path) => `- ${path}`)
      .join("\n") || "- none observed",
    "",
    "### Files Edited/Written",
    [...summary.filesEdited]
      .sort()
      .map((path) => `- ${path}`)
      .join("\n") || "- none observed",
    "",
    "### Commands Run",
    summary.commandsRun
      .slice(-40)
      .map((command) => `- ${command}`)
      .join("\n") || "- none observed",
  ]

  return sections.join("\n")
}

function lastAssistantText(messages: AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== "assistant") continue
    const text = textFromContent(message.content).trim()
    if (text) return text
  }
  return "(No assistant defense text was produced.)"
}

// Prompt construction

const READ_ONLY_RULES = [
  "You are running in read-only interrogation mode.",
  "You may inspect files with read, grep, find, ls, and read-only bash.",
  "Do not edit files.",
  "Do not write files.",
  "Bash is limited to a strict read-only allowlist.",
  "Your job is analysis and debate only.",
].join("\n")

const QUALITY_BAR = [
  "Hold the implementation against these standards:",
  "- No hacks, monkey patches, duct tape, or fragile local workarounds.",
  "- Do not accept partial solutions that could break later.",
  "- Absolute code quality over speed of delivery.",
  "- Correctness over convenience.",
  "- Clarity over cleverness.",
  "- Maintainability over short-term productivity.",
  "- Robust design over quick fixes.",
  "- Simplicity over complexity.",
  "- Honesty above everything.",
  "- Backward compatibility is not sacred here; challenge preserving bad APIs or flawed designs.",
].join("\n")

const INTERROGATOR_SYSTEM_PROMPT = [
  READ_ONLY_RULES,
  "",
  "You are the Interrogator: a hard-hitting professional architecture cross-examiner.",
  "This is not normal code review. Your job is to find when code is locally working but globally wrong.",
  "Be adversarial in process, not biased in outcome. Accept-as-is is valid if the design survives.",
  "During debate, ask questions instead of declaring conclusions too early. Force the main agent to justify decisions.",
  "Do not use personal insults. Be sharp, direct, and professionally impatient with weak reasoning.",
  "",
  QUALITY_BAR,
  "",
  "Priority order:",
  "1. requirement sanity",
  "2. core architecture",
  "3. layer/module boundary",
  "4. existing repo patterns",
  "5. policy ownership",
  "6. duplication / two sources of truth",
  "7. unnecessary complexity",
  "8. hacks/workarounds/duct tape",
  "9. local code details only if the root shape survives",
].join("\n")

const DEFENDER_SYSTEM_PROMPT = [
  "You are now defending your implementation in a read-only interrogation.",
  "Do not edit files. Do not write files. Bash is limited to read-only inspection commands.",
  "You may inspect files with read, grep, find, ls, and read-only bash.",
  "Do not automatically agree with the interrogator.",
  "If your decision was intentional, defend it with concrete repo evidence.",
  "If you missed an existing pattern, boundary, or simpler design, admit it directly.",
  "If the original user request was ambiguous, say so.",
  "Answer naturally. Do not use a rigid template. But do not dodge direct questions.",
].join("\n")

function buildChargePrompt(historyContext: string): string {
  return [
    "Investigate the current uncommitted changes in this repository.",
    "Inspect the repository yourself with read, grep, find, ls, and read-only bash; no prebuilt diff snapshot is being handed to you.",
    "Use the prior session context only to infer the original task and what the main agent looked at/changed.",
    "",
    historyContext,
    "",
    "Produce a concise charge sheet for the main agent.",
    "Ask only questions that matter if the root design changes.",
    "Do not waste questions on local details if the architecture may need redo/refactor.",
    "You must finish by calling interrogate_charge_sheet.",
  ].join("\n")
}

function buildDefensePrompt(question: string, round: number): string {
  return [
    `Interrogation defense round ${round}/${MAX_DEFENSE_ROUNDS}.`,
    "The interrogator reviewed the current uncommitted changes and has questions.",
    "Defend your implementation honestly in read-only mode.",
    "",
    question,
  ].join("\n")
}

function buildEvaluationPrompt(params: {
  historyContext: string
  turns: DebateTurn[]
  round: number
}): string {
  const debate = params.turns
    .map((turn) =>
      [
        `## Round ${turn.round}`,
        "",
        "### Interrogator Questions",
        turn.question,
        "",
        "### Main Agent Defense",
        turn.defense,
      ].join("\n")
    )
    .join("\n\n")

  return [
    "Evaluate the main agent's defense.",
    "You may inspect the repository again with read, grep, find, ls, and read-only bash if needed, but do not mutate anything.",
    "",
    params.historyContext,
    "",
    "# Debate So Far",
    debate,
    "",
    "Decision rules:",
    "- If the defense resolves root concerns, call interrogate_decision with action final_report.",
    "- If one focused follow-up is necessary and rounds remain, call interrogate_decision with action follow_up.",
    "- If the implementation shape is clearly wrong, stop and call final_report.",
    "- If human intent is required, stop and call final_report with human questions.",
    "- If max rounds are reached, stop and call final_report.",
    `Current completed defense rounds: ${params.round}. Maximum defense rounds: ${MAX_DEFENSE_ROUNDS}.`,
    "",
    "Final report content must be concise Markdown for the human only, with this shape:",
    "# Interrogation Result",
    "## Bottom Line",
    "## Core Issue",
    "## What Survived Challenge",
    "## What Did Not Survive Challenge",
    "## Human Decisions Needed",
    "## Recommended Next Step",
    "",
    "No full transcript. No generic praise. No clanker garbage.",
    "You must finish by calling interrogate_decision.",
  ].join("\n")
}

function buildHistoryContextMessage(historyContext: string): {
  role: "user"
  content: string
  timestamp: number
} {
  return {
    role: "user",
    content: [
      "Additional context for this interrogation defense turn:",
      "Use this to remember the original task, files inspected, and files changed. Do not treat omitted tool outputs as absent evidence; inspect repo yourself if needed.",
      "",
      historyContext,
    ].join("\n"),
    timestamp: Date.now(),
  }
}

// Child agent helpers

function createChargeTool(capture: (sheet: ChargeSheet) => void): ToolDefinition {
  return {
    name: "interrogate_charge_sheet",
    label: "Interrogate Charge Sheet",
    description: "Submit the charge sheet of hard questions for the main agent.",
    parameters: chargeSheetSchema,
    async execute(_toolCallId, params: ChargeSheet) {
      const sheet = {
        questions: params.questions.trim(),
        rootConcerns: params.rootConcerns.map((item) => item.trim()).filter(Boolean),
        skippedDetailsReason: stringValue(params.skippedDetailsReason),
      }
      capture(sheet)
      return {
        content: [{ type: "text" as const, text: "Submitted interrogation charge sheet." }],
        details: sheet,
        terminate: true,
      }
    },
  }
}

function createDecisionTool(capture: (decision: InterrogateDecision) => void): ToolDefinition {
  return {
    name: "interrogate_decision",
    label: "Interrogate Decision",
    description: "Submit either a follow-up question or the final Markdown interrogation report.",
    parameters: decisionSchema,
    async execute(_toolCallId, params: InterrogateDecision) {
      const decision = {
        action: params.action,
        content: params.content.trim(),
        reason: params.reason.trim(),
      }
      capture(decision)
      return {
        content: [{ type: "text" as const, text: `Submitted interrogation ${decision.action}.` }],
        details: decision,
        terminate: true,
      }
    },
  }
}

async function runChildAgent(params: {
  ctx: ExtensionCommandContext | ExtensionContext
  label: string
  prompt: string
  customTools: ToolDefinition[]
}): Promise<void> {
  await runTrackedAgent({
    ctx: params.ctx,
    label: params.label,
    prompt: params.prompt,
    systemPrompt: INTERROGATOR_SYSTEM_PROMPT,
    tools: [...CHILD_TOOLS],
    customTools: params.customTools,
    thinkingLevel: "high",
    readOnly: true,
  })
}

async function runChargeSheet(
  ctx: ExtensionCommandContext,
  historyContext: string
): Promise<ChargeSheet> {
  let captured: ChargeSheet | undefined
  await runChildAgent({
    ctx,
    label: "Interrogate charge sheet",
    prompt: buildChargePrompt(historyContext),
    customTools: [createChargeTool((sheet) => (captured = sheet))],
  })

  const sheet = captured
  if (!sheet?.questions.trim()) {
    throw new Error("Interrogator did not submit a charge sheet.")
  }
  return sheet
}

async function runEvaluation(
  ctx: ExtensionContext,
  historyContext: string,
  turns: DebateTurn[],
  round: number
): Promise<InterrogateDecision> {
  let captured: InterrogateDecision | undefined
  await runChildAgent({
    ctx,
    label: "Interrogate evaluation",
    prompt: buildEvaluationPrompt({ historyContext, turns, round }),
    customTools: [createDecisionTool((decision) => (captured = decision))],
  })

  const decision = captured
  if (!decision?.content.trim()) {
    throw new Error("Interrogator did not submit a decision.")
  }
  return decision
}

// Main-session orchestration

function notify(
  ctx: ExtensionCommandContext | ExtensionContext,
  message: string,
  level: "info" | "warning" | "error" | "success"
): void {
  if (ctx.hasUI) ctx.ui.notify(message, level)
  else if (level === "error") console.error(message)
  else console.log(message)
}

function emitReport(pi: ExtensionAPI, ctx: ExtensionContext, markdown: string): void {
  if (!ctx.hasUI) {
    console.log(markdown)
    return
  }

  pi.sendMessage(
    {
      customType: INTERROGATE_MESSAGE_TYPE,
      display: true,
      content: markdown,
      details: { timestamp: Date.now() },
    },
    { deliverAs: "followUp" }
  )
}

function resetState(): void {
  state = { status: "idle" }
}

function defenseToolBlockReason(toolName: string, input: unknown): string | undefined {
  if (toolName === "edit" || toolName === "write") {
    return "/interrogate defense is read-only; mutation tools are blocked."
  }
  if (toolName !== "bash") return undefined
  const command = isRecord(input) && typeof input.command === "string" ? input.command : ""
  const reason = readOnlyBashBlockReason(command)
  return reason ? `/interrogate defense read-only bash blocked this command: ${reason}` : undefined
}

async function startInterrogation(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  await ctx.waitForIdle()

  if (state.status !== "idle") {
    notify(ctx, "/interrogate is already running.", "warning")
    return
  }

  const historyContext = collectHistoryContext(ctx)
  notify(ctx, "Interrogator is inspecting the uncommitted changes...", "info")

  const chargeSheet = await runChargeSheet(ctx, historyContext)
  const question = buildDefensePrompt(chargeSheet.questions, 1)
  state = {
    status: "awaiting_defense",
    round: 1,
    historyContext,
    turns: [],
    pendingQuestion: question,
  }

  pi.sendUserMessage(question, { deliverAs: "followUp" })
}

async function handleDefenseComplete(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  defense: string
): Promise<void> {
  if (state.status !== "awaiting_defense") return

  const current = state
  const turns = [
    ...current.turns,
    { round: current.round, question: current.pendingQuestion, defense },
  ]

  state = {
    status: "evaluating",
    round: current.round,
    historyContext: current.historyContext,
    turns,
  }

  notify(ctx, "Interrogator is evaluating the defense...", "info")

  try {
    const decision = await runEvaluation(ctx, current.historyContext, turns, current.round)
    const canFollowUp = decision.action === "follow_up" && current.round < MAX_DEFENSE_ROUNDS

    if (canFollowUp) {
      const nextRound = current.round + 1
      const question = buildDefensePrompt(decision.content, nextRound)
      state = {
        status: "awaiting_defense",
        round: nextRound,
        historyContext: current.historyContext,
        turns,
        pendingQuestion: question,
      }
      pi.sendUserMessage(question, { deliverAs: "followUp" })
      return
    }

    resetState()
    emitReport(pi, ctx, decision.content)
  } catch (error) {
    resetState()
    emitReport(
      pi,
      ctx,
      [
        "# Interrogation Result",
        "",
        "## Bottom Line",
        "Interrogation failed before producing a final report.",
        "",
        "## Error",
        errorMessage(error),
      ].join("\n")
    )
  }
}

// Extension entrypoint

export default function interrogateExtension(pi: ExtensionAPI): void {
  pi.registerMessageRenderer(INTERROGATE_MESSAGE_TYPE, (message) => {
    return new Markdown(String(message.content), 0, 0, getMarkdownTheme())
  })

  pi.on("session_shutdown", async () => {
    resetState()
  })

  pi.on("before_agent_start", async (event) => {
    if (state.status !== "awaiting_defense") return undefined
    return {
      systemPrompt: `${event.systemPrompt}\n\n${DEFENDER_SYSTEM_PROMPT}`,
    }
  })

  pi.on("context", async (event) => {
    if (state.status !== "awaiting_defense") return undefined
    const messages = [...event.messages]
    const contextMessage = buildHistoryContextMessage(state.historyContext)
    const insertAt = Math.max(0, messages.length - 1)
    messages.splice(insertAt, 0, contextMessage)
    return { messages }
  })

  pi.on("tool_call", async (event) => {
    if (state.status !== "awaiting_defense") return undefined
    const reason = defenseToolBlockReason(event.toolName, event.input)
    return reason ? { block: true, reason } : undefined
  })

  pi.on("agent_end", async (event, ctx) => {
    if (state.status !== "awaiting_defense") return
    await handleDefenseComplete(pi, ctx, lastAssistantText(event.messages))
  })

  pi.registerCommand("interrogate", {
    description: "Run an adversarial architecture interrogation on uncommitted changes",
    handler: async (_args, ctx) => {
      try {
        await startInterrogation(pi, ctx)
      } catch (error) {
        resetState()
        notify(ctx, errorMessage(error), "error")
      }
    },
  })
}
