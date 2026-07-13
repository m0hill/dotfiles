import { openAICodexResponsesApi } from "@earendil-works/pi-ai/compat"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import type { Api, Model } from "@earendil-works/pi-ai"

const SUPPORTED_MODEL_IDS = new Set(["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"])
const STATUS_ID = "codex-fast-mode"

const codexResponsesApi = openAICodexResponsesApi()

let enabled = true

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
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

      return codexResponsesApi.streamSimple(model, context, {
        ...options,
        onPayload: async (payload, innerModel) => {
          const upstreamPayload =
            typeof options?.onPayload === "function"
              ? ((await options.onPayload(payload, innerModel)) ?? payload)
              : payload

          if (!enabled) return upstreamPayload
          if (!isRecord(upstreamPayload)) return upstreamPayload
          if (innerModel.provider !== "openai-codex" || !SUPPORTED_MODEL_IDS.has(innerModel.id)) {
            return upstreamPayload
          }

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

  pi.on("session_start", (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("accent", "⚡"))
  })

  pi.registerShortcut("ctrl+shift+f", {
    description: "Toggle Codex Fast Mode",
    handler: (ctx) => {
      enabled = !enabled

      if (!ctx.hasUI) return

      ctx.ui.setStatus(STATUS_ID, enabled ? ctx.ui.theme.fg("accent", "⚡") : undefined)
      ctx.ui.notify(`Codex Fast Mode ${enabled ? "enabled" : "disabled"}`, "info")
    },
  })
}
