import { streamSimple } from "@earendil-works/pi-ai/api/openai-codex-responses"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import type { Api, Model } from "@earendil-works/pi-ai"

export const SUPPORTED_MODEL_ID = "gpt-5.5"

let enabled = false

export function isCodexFastModeEnabled(): boolean {
  return enabled
}

export function shouldUseCodexFastBadge(
  provider: string | undefined,
  modelId: string | undefined
): boolean {
  return provider === "openai-codex" && modelId === SUPPORTED_MODEL_ID && enabled
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseCommandArg(args: string): "on" | "off" | "status" | "help" {
  const arg = args.trim().toLowerCase()
  if (arg === "on" || arg === "off" || arg === "status") return arg
  return arg ? "help" : "status"
}

function isOpenAICodexResponsesModel(model: Model<Api>): model is Model<"openai-codex-responses"> {
  return model.api === "openai-codex-responses"
}

export default function codexFastMode(pi: ExtensionAPI) {
  pi.registerProvider("openai-codex", {
    api: "openai-codex-responses",
    streamSimple(model, context, options) {
      if (!isOpenAICodexResponsesModel(model)) {
        throw new Error(`Expected openai-codex-responses model, got ${model.api}`)
      }

      return streamSimple(model, context, {
        ...options,
        onPayload: async (payload, innerModel) => {
          const upstreamPayload =
            typeof options?.onPayload === "function"
              ? ((await options.onPayload(payload, innerModel)) ?? payload)
              : payload

          if (!enabled) return upstreamPayload
          if (!isRecord(upstreamPayload)) return upstreamPayload
          if (innerModel.provider !== "openai-codex" || innerModel.id !== SUPPORTED_MODEL_ID)
            return upstreamPayload

          return {
            ...upstreamPayload,
            text: {
              ...(isRecord(upstreamPayload.text) ? upstreamPayload.text : {}),
              verbosity: "low",
            },
            service_tier: "priority",
          }
        },
      })
    },
  })

  pi.registerCommand("codex-fast", {
    description: "Toggle Codex Fast Mode for openai-codex/gpt-5.5 in this session",
    getArgumentCompletions: (prefix) => {
      const options = ["on", "off", "status"]
      const filtered = options.filter((o) => o.startsWith(prefix.trim().toLowerCase()))
      return filtered.length > 0 ? filtered.map((o) => ({ value: o, label: o })) : null
    },
    handler: async (args, ctx) => {
      const action = parseCommandArg(args)

      if (action === "help") {
        if (ctx.hasUI) ctx.ui.notify("Usage: /codex-fast [on|off|status]", "info")
        return
      }

      if (action !== "status") {
        enabled = action === "on"
      }

      if (ctx.hasUI) {
        ctx.ui.notify(
          `Codex Fast Mode: ${enabled ? "ON" : "OFF"} (session only; openai-codex/${SUPPORTED_MODEL_ID})`,
          "info"
        )
      }
    },
  })
}
