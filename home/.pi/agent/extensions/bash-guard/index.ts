import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent"
import type { BackgroundToolInput } from "../background-terminal/index.ts"

// Constants

const ALLOW_ONCE = "Allow Once"
const ALLOW_FOR_SESSION = "Allow for Session"
const ASK_WHY = "Ask Why"
const REJECT = "Reject"
const PHONE_MODE_EVENT = "phone:mode"

// Types

type SensitiveRule = {
  id: string
  reason: string
  pattern: RegExp
}

type SensitiveMatch = {
  id: string
  reason: string
}

type ApprovalAnswer = "yes" | "no"

type PendingApproval = {
  command: string
}

// State

let phoneModeActive = false
let pendingApproval: PendingApproval | null = null
let approvedCommand: string | null = null
const sessionApprovedCommands = new Set<string>()

// Sensitive command rules

function commandPattern(command: string): RegExp {
  return new RegExp(
    String.raw`(?:^|[;&|()\n])\s*(?:env\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)*(?:command\s+)?${command}(?:\s|$)`,
    "i"
  )
}

const SENSITIVE_RULES: SensitiveRule[] = [
  {
    id: "aws",
    reason: "AWS CLI command; may access or mutate cloud resources and credentials",
    pattern: commandPattern("aws"),
  },
  {
    id: "assume",
    reason: "AWS assume wrapper command; may run commands with assumed cloud credentials",
    pattern: commandPattern("assume"),
  },
  {
    id: "psql",
    reason: "Postgres command; may access or mutate database data",
    pattern: commandPattern("psql"),
  },
  {
    id: "pg-dump",
    reason: "Postgres export command; may extract sensitive database data",
    pattern: commandPattern("pg_dump"),
  },
  {
    id: "pg-restore",
    reason: "Postgres restore command; may mutate database state",
    pattern: commandPattern("pg_restore"),
  },
]

// Generic helpers

function phoneModeEventActive(value: unknown): boolean | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const active = Object.getOwnPropertyDescriptor(value, "active")?.value
  return typeof active === "boolean" ? active : undefined
}

function approvalAnswer(text: string): ApprovalAnswer | undefined {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "")

  if (
    /^(y|yes|yeah|yep|ok|okay|approve|approved|run it|go ahead|do it|proceed|sure)(\s|$)/.test(
      normalized
    )
  ) {
    return "yes"
  }

  if (/^(n|no|nope|deny|denied|block|stop|cancel|don't|dont|do not)(\s|$)/.test(normalized)) {
    return "no"
  }

  return undefined
}

function resetApprovals(): void {
  pendingApproval = null
  approvedCommand = null
}

// Matching / prompt construction

function getSensitiveMatches(command: string): SensitiveMatch[] {
  return SENSITIVE_RULES.filter((rule) => rule.pattern.test(command)).map((rule) => ({
    id: rule.id,
    reason: rule.reason,
  }))
}

function buildApprovalPrompt(command: string, matches: SensitiveMatch[]): string {
  const reasons = matches.map((match) => match.reason).join("\n")
  return [command, "", reasons].join("\n")
}

export function conversationalApprovalReason(command: string, askWhy: boolean): string {
  const instruction = askWhy
    ? "Briefly explain why this command is needed, then retry the exact same tool call so the approval dialog is shown again. Do not ask the user to approve in chat."
    : "Ask the user whether to run it, then wait for approval."
  return [`Sensitive command requires approval: ${command}`, instruction].join("\n")
}

// Extension entrypoint

export default function bashGuardExtension(pi: ExtensionAPI): void {
  pi.on("session_start", (event) => {
    if (event.reason !== "reload") sessionApprovedCommands.clear()
    resetApprovals()
  })

  pi.events.on(PHONE_MODE_EVENT, (value) => {
    const active = phoneModeEventActive(value)
    if (active === undefined) return

    phoneModeActive = active
    if (!active) resetApprovals()
  })

  pi.on("input", (event) => {
    if (!pendingApproval) return

    const answer = approvalAnswer(event.text)
    if (answer === "yes") {
      approvedCommand = pendingApproval.command
      pendingApproval = null
      return
    }

    if (answer === "no") resetApprovals()
  })

  pi.on("tool_call", async (event, ctx) => {
    let command: string
    if (isToolCallEventType("bash", event)) {
      command = event.input.command
    } else if (
      isToolCallEventType<"background", BackgroundToolInput>("background", event) &&
      (event.input.action === "start" ||
        (event.input.action === undefined && event.input.command !== undefined)) &&
      event.input.command !== undefined
    ) {
      command = event.input.command
    } else {
      return
    }

    const matches = getSensitiveMatches(command)
    if (matches.length === 0 || sessionApprovedCommands.has(command)) return

    if (approvedCommand === command) {
      resetApprovals()
      return
    }

    if (phoneModeActive) {
      pendingApproval = { command }
      return { block: true, reason: conversationalApprovalReason(command, false) }
    }

    if (!ctx.hasUI) {
      return {
        block: true,
        reason: "Sensitive bash command requires approval, but interactive UI is unavailable.",
      }
    }

    const dialogOptions = ctx.signal ? { signal: ctx.signal } : undefined
    const choice = await ctx.ui.select(
      buildApprovalPrompt(command, matches),
      [ALLOW_ONCE, ALLOW_FOR_SESSION, ASK_WHY, REJECT],
      dialogOptions
    )

    if (choice === ALLOW_ONCE) {
      resetApprovals()
      return
    }

    if (choice === ALLOW_FOR_SESSION) {
      sessionApprovedCommands.add(command)
      resetApprovals()
      return
    }

    if (choice === ASK_WHY) {
      pendingApproval = { command }
      return { block: true, reason: conversationalApprovalReason(command, true) }
    }

    resetApprovals()
    return { block: true, reason: "Blocked by user." }
  })
}
