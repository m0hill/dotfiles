import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"

export const CHAT_SYSTEM_PROMPT = `You are a helpful conversational assistant. Respond directly, naturally, and accurately to the user. Ask a concise clarifying question when needed.`

interface ChatModeState {
  enabled: boolean
}

function readPersistedState(ctx: ExtensionContext): boolean {
  const entry = ctx.sessionManager
    .getEntries()
    .filter(
      (candidate) => candidate.type === "custom" && candidate.customType === "chat-mode-state"
    )
    .at(-1)

  if (entry?.type !== "custom") return false
  return (entry.data as Partial<ChatModeState> | undefined)?.enabled === true
}

export default function chatMode(pi: ExtensionAPI): void {
  let enabled = false
  let previousTools: string[] | undefined

  pi.registerFlag("chat", {
    description: "Start as a simple chat assistant without tools or coding context",
    type: "boolean",
    default: false,
  })

  function updateStatus(ctx: ExtensionContext): void {
    ctx.ui.setStatus("chat-mode", enabled ? "chat" : undefined)
  }

  function apply(next: boolean, ctx: ExtensionContext, persist: boolean): void {
    if (next && !enabled) {
      previousTools = pi.getActiveTools()
      enabled = true
      pi.setActiveTools([])
    } else if (!next && enabled) {
      enabled = false
      pi.setActiveTools(previousTools ?? [])
      previousTools = undefined
    }

    if (persist) pi.appendEntry("chat-mode-state", { enabled })
    updateStatus(ctx)
  }

  pi.registerCommand("chat", {
    description: "Toggle simple chat mode (usage: /chat [on|off|status])",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase()

      if (action === "status") {
        ctx.ui.notify(`Chat mode is ${enabled ? "enabled" : "disabled"}`, "info")
        return
      }

      if (action && action !== "on" && action !== "off") {
        ctx.ui.notify("Usage: /chat [on|off|status]", "warning")
        return
      }

      const next = action === "on" ? true : action === "off" ? false : !enabled
      apply(next, ctx, true)
      ctx.ui.notify(`Chat mode ${next ? "enabled" : "disabled"}`, "info")
    },
  })

  pi.on("session_start", (_event, ctx) => {
    const startEnabled = pi.getFlag("chat") === true || readPersistedState(ctx)
    apply(startEnabled, ctx, false)
  })

  pi.on("before_agent_start", (_event, ctx) => {
    if (!enabled) return

    // Other extensions may activate tools after session_start. Enforce the empty
    // set immediately before every model turn.
    pi.setActiveTools([])
    updateStatus(ctx)
    return { systemPrompt: CHAT_SYSTEM_PROMPT }
  })

  pi.on("tool_call", () => {
    if (!enabled) return
    return {
      block: true,
      reason: "Tools are disabled in chat mode.",
      terminate: true,
    }
  })

  pi.on("input", (event, ctx) => {
    if (!enabled || !event.text.startsWith("/")) return

    const commandName = event.text.slice(1).split(/\s+/, 1)[0]
    const resourceCommand = pi
      .getCommands()
      .find(
        (command) =>
          command.name === commandName &&
          (command.source === "skill" || command.source === "prompt")
      )

    if (!resourceCommand) return
    ctx.ui.notify(`${resourceCommand.source} commands are disabled in chat mode`, "warning")
    return { action: "handled" as const }
  })
}
