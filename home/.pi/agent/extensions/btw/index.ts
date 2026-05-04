import {
  createAgentSession,
  createExtensionRuntime,
  SessionManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ResourceLoader,
} from "@mariozechner/pi-coding-agent"
const BTW_MESSAGE_TYPE = "btw-note"

const BTW_SYSTEM_PROMPT = [
  "You are answering a /btw side question for the user.",
  "This side question is intentionally isolated from the main conversation.",
  "Do not assume or reference prior chat context.",
  "The only prior-context-derived information you may use is the unique file path list included in the user's prompt.",
  "If you need file contents, inspect them yourself with read or safe bash commands.",
  "Do not modify files. Do not run commands that write, edit, delete, install, or mutate state.",
  "Keep the answer concise unless the user asks for detail.",
].join("\n")

type BtwDetails = {
  question: string
  answer: string
  paths: string[]
  timestamp: number
}

function createBtwResourceLoader(): ResourceLoader {
  const extensionsResult = { extensions: [], errors: [], runtime: createExtensionRuntime() }

  return {
    getExtensions: () => extensionsResult,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => BTW_SYSTEM_PROMPT,
    getAppendSystemPrompt: () => [],
    extendResources: () => {},
    reload: async () => {},
  }
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""

  return content
    .map((part) => {
      if (!part || typeof part !== "object") return ""
      const maybeText = part as { type?: unknown; text?: unknown; thinking?: unknown }
      if (maybeText.type === "text" && typeof maybeText.text === "string") return maybeText.text
      if (maybeText.type === "thinking" && typeof maybeText.thinking === "string")
        return maybeText.thinking
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

function addPathCandidate(paths: Set<string>, value: string): void {
  const cleaned = value
    .trim()
    .replace(/^['"`(<[]+/, "")
    .replace(/[,'"`)>\].:;]+$/, "")

  if (!cleaned || cleaned.length > 240) return
  if (/^(https?|mailto):/i.test(cleaned)) return
  if (!/[/.]/.test(cleaned)) return
  if (/\s/.test(cleaned)) return

  paths.add(cleaned)
}

function collectStrings(value: unknown, strings: string[], keyHint = ""): void {
  if (typeof value === "string") {
    if (/path|file|cwd|dir|name/i.test(keyHint)) strings.push(value)
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, strings, keyHint)
    return
  }

  if (!value || typeof value !== "object") return

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    collectStrings(child, strings, key)
  }
}

function extractUniquePaths(ctx: ExtensionCommandContext): string[] {
  const paths = new Set<string>()
  const branch = ctx.sessionManager.getBranch()

  for (const entry of branch) {
    const hintedStrings: string[] = []
    collectStrings(entry, hintedStrings)
    for (const value of hintedStrings) addPathCandidate(paths, value)

    const messageText = textFromContent((entry as { content?: unknown }).content)
    for (const match of messageText.matchAll(
      /(?:~|\.{1,2})?\/?[\w@.+-]+(?:\/[\w@.+-]+)+(?:\.[\w.+-]+)?|[\w@.+-]+\.[A-Za-z0-9][\w.+-]*/g
    )) {
      addPathCandidate(paths, match[0])
    }
  }

  return [...paths].sort().slice(0, 200)
}

function getLastAssistantText(session: {
  state: { messages: Array<{ role?: string; content?: unknown }> }
}): string {
  for (let i = session.state.messages.length - 1; i >= 0; i--) {
    const message = session.state.messages[i]
    if (message.role === "assistant") {
      const text = textFromContent(message.content).trim()
      return text || "(No text response)"
    }
  }
  return "(No response)"
}

function buildPrompt(question: string, paths: string[]): string {
  const pathSection = paths.length > 0 ? paths.map((path) => `- ${path}`).join("\n") : "(none)"

  return [
    "Answer this side question without using prior chat context.",
    "You may only use the unique file paths below as prior-context-derived hints.",
    "If file contents matter, inspect files yourself with read or safe bash.",
    "",
    "Unique file paths:",
    pathSection,
    "",
    "Question:",
    question,
  ].join("\n")
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("btw", {
    description:
      "Ask an isolated side question. Previous chat is not sent; only unique file paths are provided as hints.",
    handler: async (args, ctx) => {
      let question = args.trim()
      if (!question) {
        const input = await ctx.ui.input("BTW question", "Ask a side question...")
        question = input?.trim() ?? ""
        if (!question) return
      }

      if (!ctx.model) {
        ctx.ui.notify("No active model selected for /btw.", "error")
        return
      }

      const paths = extractUniquePaths(ctx)
      ctx.ui.notify("Running isolated /btw side question...", "info")

      let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined
      try {
        const created = await createAgentSession({
          cwd: ctx.cwd,
          sessionManager: SessionManager.inMemory(ctx.cwd),
          model: ctx.model,
          modelRegistry: ctx.modelRegistry as never,
          thinkingLevel: pi.getThinkingLevel(),
          tools: ["read", "bash"],
          resourceLoader: createBtwResourceLoader(),
        })
        session = created.session

        await session.prompt(buildPrompt(question, paths), { source: "extension" })
        const answer = getLastAssistantText(session)
        const content = `Q: ${question}\n\nA: ${answer}`
        const details: BtwDetails = { question, answer, paths, timestamp: Date.now() }

        pi.sendMessage({
          customType: BTW_MESSAGE_TYPE,
          content,
          display: true,
          details,
        })
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error")
      } finally {
        if (session) {
          try {
            await session.abort()
          } catch {
            // Ignore cleanup errors.
          }
          session.dispose()
        }
      }
    },
  })
}
