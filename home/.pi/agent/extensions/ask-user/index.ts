import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Text } from "@earendil-works/pi-tui"
import { Type, type Static } from "typebox"

// Constants

const TOOL_NAME = "ask_user"
const CUSTOM_ANSWER_OPTION = "Custom answer..."

// Types

const questionParameters = Type.Object({
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
})

const askUserParameters = Type.Object({
  question: Type.Optional(Type.String({ description: "The focused question to ask the user" })),
  context: Type.Optional(
    Type.String({ description: "Short context summary to show before the question" })
  ),
  options: Type.Optional(
    Type.Array(Type.String(), { description: "Optional choices for the user to pick from" })
  ),
  defaultAnswer: Type.Optional(
    Type.String({ description: "Placeholder/default hint for freeform answers" })
  ),
  questions: Type.Optional(
    Type.Array(questionParameters, {
      description: "Optional list of questions to ask sequentially in one tool call",
    })
  ),
  timeout: Type.Optional(
    Type.Number({ description: "Optional timeout in milliseconds per question" })
  ),
})

type AskUserParams = Static<typeof askUserParameters>
type QuestionParams = Static<typeof questionParameters>

type AskUserAnswer = {
  question: string
  context?: string
  options: string[]
  answer: string | null
  cancelled: boolean
}

type AskUserDetails = AskUserAnswer & {
  answers?: AskUserAnswer[]
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

function normalizeQuestion(params: QuestionParams): QuestionParams {
  return {
    question: params.question.trim(),
    context: normalizeText(params.context),
    options: normalizeOptions(params.options),
    defaultAnswer: params.defaultAnswer,
  }
}

function normalizeQuestions(params: AskUserParams): QuestionParams[] {
  if (params.questions && params.questions.length > 0)
    return params.questions.map(normalizeQuestion)

  return [
    normalizeQuestion({
      question: params.question ?? "",
      context: params.context,
      options: params.options,
      defaultAnswer: params.defaultAnswer,
    }),
  ]
}

function toolDetails(answer: AskUserAnswer, answers?: AskUserAnswer[]): AskUserDetails {
  return answers ? { ...answer, answers } : answer
}

function formatAnswers(answers: AskUserAnswer[]): string {
  return answers.map((answer) => `${answer.question}: ${answer.answer ?? "cancelled"}`).join("\n")
}

// Extension entrypoint

export default function askUserExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: TOOL_NAME,
    label: "Ask User",
    description:
      "Ask the user one or more focused clarification questions and wait for their answers.",
    promptSnippet: "Ask the user focused clarification questions when explicit input is needed",
    promptGuidelines: [
      "Use ask_user when requirements are ambiguous or a user preference is needed before proceeding.",
      "Prefer one focused question; use ask_user questions only when several related answers are needed together.",
      "Prefer short options when there are clear choices; the tool always adds a custom-answer path.",
    ],
    parameters: askUserParameters,

    async execute(_toolCallId, params: AskUserParams, signal, _onUpdate, ctx) {
      const questions = normalizeQuestions(params).filter((item) => item.question.length > 0)
      const firstQuestion = questions[0]

      if (!firstQuestion) {
        throw new Error("ask_user requires question or questions")
      }

      if (signal?.aborted) {
        const cancelledAnswer = {
          question: firstQuestion.question,
          context: firstQuestion.context,
          options: firstQuestion.options ?? [],
          answer: null,
          cancelled: true,
        }
        return {
          content: [{ type: "text" as const, text: "User question cancelled" }],
          details: toolDetails(cancelledAnswer),
        }
      }

      if (!ctx.hasUI || !ctx.ui) {
        const prompts = questions
          .map((item, index) => {
            const options = item.options ?? []
            const optionText = options.length > 0 ? `\nOptions:\n${options.join("\n")}` : ""
            const contextText = item.context ? `\nContext:\n${item.context}` : ""
            return `${index + 1}. ${item.question}${contextText}${optionText}`
          })
          .join("\n\n")
        return {
          content: [
            {
              type: "text" as const,
              text: `Interactive UI is unavailable. Please answer:\n\n${prompts}`,
            },
          ],
          details: toolDetails({
            question: firstQuestion.question,
            context: firstQuestion.context,
            options: firstQuestion.options ?? [],
            answer: null,
            cancelled: true,
          }),
        }
      }

      const timeoutOptions = params.timeout ? { timeout: params.timeout } : undefined
      const answers: AskUserAnswer[] = []

      for (const item of questions) {
        const options = item.options ?? []
        const prompt = buildPrompt({ question: item.question, context: item.context })
        const rawAnswer = await askForAnswer({
          ctx,
          prompt,
          options,
          defaultAnswer: item.defaultAnswer,
          timeoutOptions,
        })
        const answer = normalizeText(rawAnswer)
        const result = {
          question: item.question,
          context: item.context,
          options,
          answer: answer ?? null,
          cancelled: !answer,
        }
        answers.push(result)

        if (!answer) {
          pi.events.emit("ask_user:cancelled", {
            question: item.question,
            context: item.context,
            options,
          })
          return {
            content: [{ type: "text" as const, text: "User cancelled the question" }],
            details: toolDetails(result, answers),
          }
        }
      }

      const firstAnswer = answers[0]
      if (!firstAnswer) throw new Error("ask_user produced no answers")

      pi.events.emit("ask_user:answered", { answers })
      return {
        content: [{ type: "text" as const, text: `User answered:\n${formatAnswers(answers)}` }],
        details: toolDetails(firstAnswer, answers),
      }
    },

    renderCall(args, theme) {
      const questionCount = Array.isArray(args.questions) ? args.questions.length : 0
      const question =
        typeof args.question === "string" ? args.question : `${questionCount} questions`
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

      if (details.answers && details.answers.length > 1) {
        return new Text(
          theme.fg("success", "✓ ") + theme.fg("accent", formatAnswers(details.answers)),
          0,
          0
        )
      }

      return new Text(theme.fg("success", "✓ ") + theme.fg("accent", details.answer), 0, 0)
    },
  })
}
