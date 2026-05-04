import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { Text } from "@mariozechner/pi-tui"
import { Type, type Static } from "typebox"

// Constants

const TOOL_NAME = "ask_user"
const CUSTOM_ANSWER_OPTION = "Custom answer..."

// Types

const askUserParameters = Type.Object({
  question: Type.String({ description: "The focused question to ask the user" }),
  context: Type.Optional(
    Type.String({ description: "Short context summary to show before the question" })
  ),
  options: Type.Optional(
    Type.Array(Type.String(), { description: "Optional choices for the user to pick from" })
  ),
  defaultAnswer: Type.Optional(
    Type.String({ description: "Placeholder/default hint for freeform answers" })
  ),
  timeout: Type.Optional(Type.Number({ description: "Optional timeout in milliseconds" })),
})

type AskUserParams = Static<typeof askUserParameters>

type AskUserDetails = {
  question: string
  context?: string
  options: string[]
  answer: string | null
  cancelled: boolean
}

// Generic helpers

function normalizeText(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function normalizeOptions(options: string[] | undefined): string[] {
  return (options ?? []).map((option) => option.trim()).filter(Boolean)
}

function buildPrompt(params: { question: string; context?: string }): string {
  return params.context ? `${params.question}\n\nContext:\n${params.context}` : params.question
}

function optionsWithCustomAnswer(options: string[]): string[] {
  if (!options.includes(CUSTOM_ANSWER_OPTION)) return [...options, CUSTOM_ANSWER_OPTION]

  return [...options, `${CUSTOM_ANSWER_OPTION} `]
}

async function askForAnswer(params: {
  ctx: Parameters<Parameters<ExtensionAPI["registerTool"]>[0]["execute"]>[4]
  prompt: string
  options: string[]
  defaultAnswer?: string
  timeoutOptions?: { timeout: number }
}): Promise<string | undefined> {
  if (params.options.length === 0) {
    return params.ctx.ui.input(
      params.prompt,
      params.defaultAnswer ?? "Type your answer...",
      params.timeoutOptions
    )
  }

  const selectableOptions = optionsWithCustomAnswer(params.options)
  const selected = await params.ctx.ui.select(
    params.prompt,
    selectableOptions,
    params.timeoutOptions
  )
  if (selected !== CUSTOM_ANSWER_OPTION && selected !== `${CUSTOM_ANSWER_OPTION} `) return selected

  return params.ctx.ui.input(
    params.prompt,
    params.defaultAnswer ?? "Type custom answer...",
    params.timeoutOptions
  )
}

function toolDetails(params: {
  question: string
  context?: string
  options: string[]
  answer: string | null
  cancelled: boolean
}): AskUserDetails {
  return {
    question: params.question,
    context: params.context,
    options: params.options,
    answer: params.answer,
    cancelled: params.cancelled,
  }
}

// Extension entrypoint

export default function askUserExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: TOOL_NAME,
    label: "Ask User",
    description: "Ask the user one focused clarification question and wait for their answer.",
    promptSnippet: "Ask the user one focused clarification question when explicit input is needed",
    promptGuidelines: [
      "Use ask_user when requirements are ambiguous or a user preference is needed before proceeding.",
      "Ask exactly one focused question per ask_user call.",
      "Prefer short options when there are clear choices; otherwise ask for a freeform answer.",
    ],
    parameters: askUserParameters,

    async execute(_toolCallId, params: AskUserParams, signal, _onUpdate, ctx) {
      const question = params.question.trim()
      const context = normalizeText(params.context)
      const options = normalizeOptions(params.options)

      if (signal?.aborted) {
        return {
          content: [{ type: "text" as const, text: "User question cancelled" }],
          details: toolDetails({ question, context, options, answer: null, cancelled: true }),
        }
      }

      if (!ctx.hasUI || !ctx.ui) {
        const optionText = options.length > 0 ? `\n\nOptions:\n${options.join("\n")}` : ""
        const contextText = context ? `\n\nContext:\n${context}` : ""
        return {
          content: [
            {
              type: "text" as const,
              text: `Interactive UI is unavailable. Please answer:\n\n${question}${contextText}${optionText}`,
            },
          ],
          details: toolDetails({ question, context, options, answer: null, cancelled: true }),
        }
      }

      const prompt = buildPrompt({ question, context })
      const timeoutOptions = params.timeout ? { timeout: params.timeout } : undefined
      const rawAnswer = await askForAnswer({
        ctx,
        prompt,
        options,
        defaultAnswer: params.defaultAnswer,
        timeoutOptions,
      })
      const answer = normalizeText(rawAnswer)

      if (!answer) {
        pi.events.emit("ask_user:cancelled", { question, context, options })
        return {
          content: [{ type: "text" as const, text: "User cancelled the question" }],
          details: toolDetails({ question, context, options, answer: null, cancelled: true }),
        }
      }

      pi.events.emit("ask_user:answered", { question, context, options, answer })
      return {
        content: [{ type: "text" as const, text: `User answered: ${answer}` }],
        details: toolDetails({ question, context, options, answer, cancelled: false }),
      }
    },

    renderCall(args, theme) {
      const question = typeof args.question === "string" ? args.question : ""
      const options = Array.isArray(args.options)
        ? args.options.filter((option) => typeof option === "string")
        : []
      const suffix = options.length > 0 ? theme.fg("dim", ` (${options.length} options)`) : ""
      return new Text(
        theme.fg("toolTitle", theme.bold(`${TOOL_NAME} `)) + theme.fg("muted", question) + suffix,
        0,
        0
      )
    },

    renderResult(result, _options, theme) {
      const details = result.details as AskUserDetails | undefined

      if (!details || details.cancelled || !details.answer) {
        return new Text(theme.fg("warning", "Cancelled"), 0, 0)
      }

      return new Text(theme.fg("success", "✓ ") + theme.fg("accent", details.answer), 0, 0)
    },
  })
}
