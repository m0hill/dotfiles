import {
  createLocalBashOperations,
  truncateTail,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent"
import { StringEnum } from "@earendil-works/pi-ai"
import { Text } from "@earendil-works/pi-tui"
import { stat } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"
import { type Static, Type } from "typebox"
import { BackgroundJobs, type JobSnapshot } from "./manager.ts"
import { sanitizeTerminalText } from "./output.ts"

const STATUS_KEY = "background-terminal"
const COMPLETION_MESSAGE_TYPE = "background-terminal-complete"
const MODEL_OUTPUT_BYTES = 16 * 1024
const MODEL_OUTPUT_LINES = 400
const COMMAND_OUTPUT_BYTES = 4 * 1024
const COMMAND_OUTPUT_LINES = 120
const MAX_TIMEOUT_SECONDS = 7 * 24 * 60 * 60

const backgroundToolSchema = Type.Object({
  action: Type.Optional(
    StringEnum(["start", "status", "list", "stop"] as const, {
      description: 'Operation to perform. Defaults to "start" when command is provided.',
    })
  ),
  command: Type.Optional(Type.String({ description: "Shell command required by start." })),
  id: Type.Optional(Type.String({ description: "Job ID required by status and stop." })),
  cwd: Type.Optional(
    Type.String({ description: "Working directory relative to the current session directory." })
  ),
  timeout_seconds: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: MAX_TIMEOUT_SECONDS,
      description: "Optional command timeout in seconds.",
    })
  ),
})

/** Input accepted by the background tool, exported for cross-extension safety policies. */
export type BackgroundToolInput = Static<typeof backgroundToolSchema>

type Action = "start" | "status" | "list" | "stop"

function safeLabel(command: string, maxLength = 80): string {
  const normalized = sanitizeTerminalText(command).replace(/\s+/gu, " ").trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`
}

function formatDuration(job: JobSnapshot): string {
  const end = job.endedAt ?? Date.now()
  const seconds = Math.max(0, Math.floor((end - job.startedAt) / 1_000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}m${remainder.toString().padStart(2, "0")}s`
}

function formatSummary(job: JobSnapshot): string {
  const exit = job.exitCode === undefined ? "" : ` · exit ${job.exitCode ?? "signal"}`
  return `${job.id} · ${job.state}${exit} · ${formatDuration(job)} · ${safeLabel(job.command)}`
}

function formatList(jobs: readonly JobSnapshot[]): string {
  if (jobs.length === 0) return "No background jobs in this session."
  return jobs.map(formatSummary).join("\n")
}

function formatStatus(job: JobSnapshot, maxBytes: number, maxLines: number): string {
  const lines = [formatSummary(job), `cwd: ${job.cwd}`]
  if (job.failure) lines.push(`note: ${job.failure}`)

  const tail = truncateTail(job.output, { maxBytes, maxLines })
  if (tail.content) {
    lines.push("", tail.content)
    if (job.outputTruncated || tail.truncated) {
      lines.push(
        "",
        `[Output shortened; ${job.observedBytes} bytes observed. Only a bounded tail is retained.]`
      )
    }
  } else {
    lines.push("", "(no output)")
  }

  return lines.join("\n")
}

function completionMessage(job: JobSnapshot): string {
  return [
    `Background job completed: ${formatSummary(job)}`,
    `Use the background tool with action "status" and id "${job.id}" if its output matters.`,
  ].join("\n")
}

async function resolveWorkingDirectory(
  sessionCwd: string,
  requested: string | undefined
): Promise<
  | { readonly _tag: "ok"; readonly path: string }
  | { readonly _tag: "err"; readonly message: string }
> {
  if (requested && isAbsolute(requested)) {
    return { _tag: "err", message: "cwd must be relative to the current session directory." }
  }

  const path = resolve(sessionCwd, requested || ".")
  const info = await stat(path).catch(() => undefined)
  if (!info?.isDirectory()) {
    return {
      _tag: "err",
      message: `Working directory does not exist or is not a directory: ${path}`,
    }
  }
  return { _tag: "ok", path }
}

function parseCommandArgs(args: string): readonly string[] {
  return args.trim().split(/\s+/u).filter(Boolean)
}

async function runHumanCommand(
  args: string,
  ctx: ExtensionCommandContext,
  jobs: BackgroundJobs
): Promise<void> {
  const parts = parseCommandArgs(args)
  const action = parts[0] ?? "list"

  if (action === "list") {
    ctx.ui.notify(formatList(jobs.list()), "info")
    return
  }

  if (action === "status") {
    const id = parts[1]
    if (!id) {
      ctx.ui.notify("Usage: /bg status <id>", "warning")
      return
    }
    const found = jobs.get(id)
    ctx.ui.notify(
      found._tag === "ok"
        ? formatStatus(found.value, COMMAND_OUTPUT_BYTES, COMMAND_OUTPUT_LINES)
        : found.error.message,
      found._tag === "ok" ? "info" : "error"
    )
    return
  }

  if (action === "stop") {
    const id = parts[1]
    if (!id) {
      ctx.ui.notify("Usage: /bg stop <id|all>", "warning")
      return
    }

    if (id === "all") {
      const running = jobs.list().filter((job) => job.state === "running")
      if (running.length === 0) {
        ctx.ui.notify("No background jobs are running.", "info")
        return
      }
      if (ctx.hasUI) {
        const confirmed = await ctx.ui.confirm(
          "Stop background jobs?",
          `Stop ${running.length} running job${running.length === 1 ? "" : "s"}?`
        )
        if (!confirmed) return
      }
      const results = await Promise.all(running.map((job) => jobs.stop(job.id)))
      const failures = results.filter((result) => result._tag === "err")
      ctx.ui.notify(
        failures.length === 0
          ? `Stopped ${running.length} background job${running.length === 1 ? "" : "s"}.`
          : `Requested ${running.length} stops; ${failures.length} did not settle promptly.`,
        failures.length === 0 ? "info" : "warning"
      )
      return
    }

    const stopped = await jobs.stop(id)
    ctx.ui.notify(
      stopped._tag === "ok" ? formatSummary(stopped.value) : stopped.error.message,
      stopped._tag === "ok" ? "info" : "error"
    )
    return
  }

  ctx.ui.notify("Usage: /bg [list | status <id> | stop <id|all>]", "warning")
}

/** Register the session-scoped background shell extension. */
export default function backgroundTerminalExtension(pi: ExtensionAPI): void {
  let currentContext: ExtensionContext | undefined

  const jobs = new BackgroundJobs(createLocalBashOperations(), (job) => {
    if (currentContext?.hasUI) {
      const running = jobs.runningCount()
      currentContext.ui.setStatus(STATUS_KEY, running > 0 ? `bg: ${running} running` : undefined)
    }
    pi.sendMessage(
      {
        customType: COMPLETION_MESSAGE_TYPE,
        content: completionMessage(job),
        display: true,
        details: { id: job.id, state: job.state, exitCode: job.exitCode },
      },
      { deliverAs: "followUp", triggerTurn: true }
    )
  })

  const updateStatus = () => {
    if (!currentContext?.hasUI) return
    const running = jobs.runningCount()
    currentContext.ui.setStatus(STATUS_KEY, running > 0 ? `bg: ${running} running` : undefined)
  }

  pi.on("session_start", (_event, ctx) => {
    currentContext = ctx
    updateStatus()
  })

  pi.on("session_shutdown", async () => {
    if (currentContext?.hasUI) currentContext.ui.setStatus(STATUS_KEY, undefined)
    await jobs.shutdown()
    currentContext = undefined
  })

  pi.registerTool({
    name: "background",
    label: "Background",
    description:
      "Start and manage non-interactive background shell jobs. Output is a bounded combined stdout/stderr tail. Jobs are stopped on Pi session shutdown or reload.",
    promptSnippet: "Start, inspect, list, or stop non-interactive background shell jobs",
    promptGuidelines: [
      "Use background for long-running non-interactive commands when useful work can continue concurrently.",
      "After background starts a job, continue useful work instead of polling; completion arrives automatically.",
      "Use background status only when output is needed now, such as checking whether a server became ready.",
    ],
    parameters: backgroundToolSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const action: Action = params.action ?? (params.command ? "start" : "list")

      if (action === "list") {
        const snapshots = jobs.list()
        return {
          content: [{ type: "text", text: formatList(snapshots) }],
          details: { action, jobs: snapshots.map(({ id, state }) => ({ id, state })) },
        }
      }

      if (action === "status") {
        if (!params.id) {
          return {
            content: [{ type: "text", text: 'background status requires "id".' }],
            details: { action },
          }
        }
        const found = jobs.get(params.id)
        return {
          content: [
            {
              type: "text",
              text:
                found._tag === "ok"
                  ? formatStatus(found.value, MODEL_OUTPUT_BYTES, MODEL_OUTPUT_LINES)
                  : found.error.message,
            },
          ],
          details: { action, id: params.id, found: found._tag === "ok" },
        }
      }

      if (action === "stop") {
        if (!params.id) {
          return {
            content: [{ type: "text", text: 'background stop requires "id".' }],
            details: { action },
          }
        }
        const stopped = await jobs.stop(params.id)
        updateStatus()
        return {
          content: [
            {
              type: "text",
              text: stopped._tag === "ok" ? formatSummary(stopped.value) : stopped.error.message,
            },
          ],
          details: { action, id: params.id, stopped: stopped._tag === "ok" },
        }
      }

      const command = params.command?.trim()
      if (!command) {
        return {
          content: [{ type: "text", text: 'background start requires "command".' }],
          details: { action },
        }
      }
      const cwd = await resolveWorkingDirectory(ctx.cwd, params.cwd)
      if (cwd._tag === "err") {
        return { content: [{ type: "text", text: cwd.message }], details: { action } }
      }

      const started = jobs.start({
        command,
        cwd: cwd.path,
        ...(params.timeout_seconds === undefined ? {} : { timeoutSeconds: params.timeout_seconds }),
      })
      updateStatus()
      return {
        content: [
          {
            type: "text",
            text:
              started._tag === "ok"
                ? `Started ${started.value.id}: ${safeLabel(command)}\nContinue useful work; completion will arrive automatically.`
                : started.error.message,
          },
        ],
        details: {
          action,
          ...(started._tag === "ok" ? { id: started.value.id, state: started.value.state } : {}),
        },
      }
    },
    renderCall(args, theme) {
      const action = args.action ?? (args.command ? "start" : "list")
      const subject = action === "start" ? safeLabel(args.command ?? "") : (args.id ?? "")
      const suffix = subject ? ` ${theme.fg("muted", subject)}` : ""
      return new Text(`${theme.fg("toolTitle", theme.bold("background"))} ${action}${suffix}`, 0, 0)
    },
  })

  pi.registerCommand("bg", {
    description: "List, inspect, or stop session-scoped background jobs.",
    getArgumentCompletions: (prefix) => {
      const options = [
        { value: "list", label: "list" },
        ...jobs.list().flatMap((job) => [
          {
            value: `status ${job.id}`,
            label: `status ${job.id}`,
            description: safeLabel(job.command, 50),
          },
          ...(job.state === "running"
            ? [
                {
                  value: `stop ${job.id}`,
                  label: `stop ${job.id}`,
                  description: safeLabel(job.command, 50),
                },
              ]
            : []),
        ]),
        ...(jobs.runningCount() > 0 ? [{ value: "stop all", label: "stop all" }] : []),
      ]
      const normalized = prefix.trimStart()
      return options.filter((option) => option.value.startsWith(normalized))
    },
    handler: async (args, ctx) => runHumanCommand(args, ctx, jobs),
  })
}
