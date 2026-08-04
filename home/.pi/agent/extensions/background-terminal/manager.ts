import type { BashOperations } from "@earendil-works/pi-coding-agent"
import { OutputTail, sanitizeTerminalText } from "./output.ts"

const MAX_RUNNING_JOBS = 4
const MAX_SETTLED_JOBS = 20
const STOP_WAIT_MS = 2_000
const SHUTDOWN_WAIT_MS = 3_000

type TerminalState = "succeeded" | "failed" | "stopped" | "timed_out"

/** Public lifecycle state for one background job. */
export type JobState = "running" | TerminalState

/** Immutable view of a background job. */
export type JobSnapshot = {
  readonly id: string
  readonly command: string
  readonly cwd: string
  readonly state: JobState
  readonly startedAt: number
  readonly endedAt?: number
  readonly exitCode?: number | null
  readonly failure?: string
  readonly output: string
  readonly outputTruncated: boolean
  readonly observedBytes: number
}

/** Input required to launch a background job. */
export type StartJobInput = {
  readonly command: string
  readonly cwd: string
  readonly timeoutSeconds?: number
}

/** Expected failure returned when the session is shutting down. */
export class ManagerClosingError extends Error {
  readonly _tag = "ManagerClosingError" as const

  constructor() {
    super("Background jobs are shutting down; no new job can be started.")
  }
}

/** Expected failure returned when the concurrent-job cap is reached. */
export class ConcurrencyLimitError extends Error {
  readonly _tag = "ConcurrencyLimitError" as const
  readonly limit: number

  constructor(limit: number) {
    super(`At most ${limit} background jobs may run concurrently.`)
    this.limit = limit
  }
}

/** Expected failure returned when a job ID is unknown. */
export class JobNotFoundError extends Error {
  readonly _tag = "JobNotFoundError" as const
  readonly id: string

  constructor(id: string) {
    super(`Unknown background job: ${id}`)
    this.id = id
  }
}

/** Expected failure returned when a stopped process does not settle promptly. */
export class StopTimedOutError extends Error {
  readonly _tag = "StopTimedOutError" as const
  readonly id: string

  constructor(id: string) {
    super(`Background job ${id} did not settle within ${STOP_WAIT_MS}ms.`)
    this.id = id
  }
}

/** Result type used by background-job operations. */
export type JobResult<T, E extends Error> =
  | { readonly _tag: "ok"; readonly value: T }
  | { readonly _tag: "err"; readonly error: E }

type StopReason = "stopped" | "shutdown"

type RunningLifecycle = {
  readonly _tag: "running"
  readonly controller: AbortController
  readonly settled: Promise<JobSnapshot>
  resolveSettled(snapshot: JobSnapshot): void
  stopReason?: StopReason
}

type TerminalLifecycle = {
  readonly _tag: TerminalState
  readonly endedAt: number
  readonly exitCode?: number | null
  readonly failure?: string
}

type JobRecord = {
  readonly id: string
  readonly command: string
  readonly cwd: string
  readonly startedAt: number
  readonly output: OutputTail
  lifecycle: RunningLifecycle | TerminalLifecycle
}

/** Owns session-scoped background processes, output tails, and legal lifecycle transitions. */
export class BackgroundJobs {
  readonly #jobs = new Map<string, JobRecord>()
  readonly #operations: BashOperations
  readonly #onSettled: (snapshot: JobSnapshot) => void
  #nextId = 1
  #closing = false

  constructor(operations: BashOperations, onSettled: (snapshot: JobSnapshot) => void) {
    this.#operations = operations
    this.#onSettled = onSettled
  }

  /** Launch a job and return immediately after registering it. */
  start(input: StartJobInput): JobResult<JobSnapshot, ManagerClosingError | ConcurrencyLimitError> {
    if (this.#closing) return { _tag: "err", error: new ManagerClosingError() }
    if (this.runningCount() >= MAX_RUNNING_JOBS) {
      return { _tag: "err", error: new ConcurrencyLimitError(MAX_RUNNING_JOBS) }
    }

    const id = `bg-${this.#nextId++}`
    const controller = new AbortController()
    let resolveSettled: (snapshot: JobSnapshot) => void = () => undefined
    const settled = new Promise<JobSnapshot>((resolve) => {
      resolveSettled = resolve
    })
    const record: JobRecord = {
      id,
      command: input.command,
      cwd: input.cwd,
      startedAt: Date.now(),
      output: new OutputTail(),
      lifecycle: {
        _tag: "running",
        controller,
        settled,
        resolveSettled,
      },
    }

    this.#jobs.set(id, record)
    void this.#run(record, input.timeoutSeconds)
    return { _tag: "ok", value: this.#snapshot(record) }
  }

  /** Return one job by ID. */
  get(id: string): JobResult<JobSnapshot, JobNotFoundError> {
    const record = this.#jobs.get(id)
    return record
      ? { _tag: "ok", value: this.#snapshot(record) }
      : { _tag: "err", error: new JobNotFoundError(id) }
  }

  /** List jobs newest first, including a bounded settled history. */
  list(): readonly JobSnapshot[] {
    return [...this.#jobs.values()].reverse().map((record) => this.#snapshot(record))
  }

  /** Return the number of currently running jobs. */
  runningCount(): number {
    let count = 0
    for (const record of this.#jobs.values()) {
      if (record.lifecycle._tag === "running") count += 1
    }
    return count
  }

  /** Stop a running job and wait briefly for process-tree cleanup. */
  async stop(id: string): Promise<JobResult<JobSnapshot, JobNotFoundError | StopTimedOutError>> {
    const record = this.#jobs.get(id)
    if (!record) return { _tag: "err", error: new JobNotFoundError(id) }
    if (record.lifecycle._tag !== "running") {
      return { _tag: "ok", value: this.#snapshot(record) }
    }

    const lifecycle = record.lifecycle
    lifecycle.stopReason = "stopped"
    lifecycle.controller.abort()
    const snapshot = await waitFor(lifecycle.settled, STOP_WAIT_MS)
    return snapshot
      ? { _tag: "ok", value: snapshot }
      : { _tag: "err", error: new StopTimedOutError(id) }
  }

  /** Stop every running job, suppress completion messages, and release session state. */
  async shutdown(): Promise<void> {
    if (this.#closing) return
    this.#closing = true

    const pending: Promise<JobSnapshot>[] = []
    for (const record of this.#jobs.values()) {
      if (record.lifecycle._tag !== "running") continue
      record.lifecycle.stopReason = "shutdown"
      pending.push(record.lifecycle.settled)
      record.lifecycle.controller.abort()
    }

    await waitFor(Promise.all(pending), SHUTDOWN_WAIT_MS)
    this.#jobs.clear()
  }

  async #run(record: JobRecord, timeoutSeconds: number | undefined): Promise<void> {
    const running = record.lifecycle
    if (running._tag !== "running") return

    try {
      const options = {
        onData: (data: Buffer) => record.output.append(data),
        signal: running.controller.signal,
        ...(timeoutSeconds === undefined ? {} : { timeout: timeoutSeconds }),
      }
      const result = await this.#operations.exec(record.command, record.cwd, options)
      this.#settle(record, {
        _tag: result.exitCode === 0 ? "succeeded" : "failed",
        endedAt: Date.now(),
        exitCode: result.exitCode,
        ...(result.exitCode === 0
          ? {}
          : { failure: `Command exited with code ${result.exitCode}.` }),
      })
    } catch (cause: unknown) {
      const stopReason = running.stopReason
      if (stopReason) {
        this.#settle(record, {
          _tag: "stopped",
          endedAt: Date.now(),
          failure:
            stopReason === "shutdown" ? "Stopped during session shutdown." : "Stopped by request.",
        })
        return
      }

      const message = cause instanceof Error ? cause.message : String(cause)
      const timedOut = message.startsWith("timeout:")
      this.#settle(record, {
        _tag: timedOut ? "timed_out" : "failed",
        endedAt: Date.now(),
        failure: timedOut
          ? `Command timed out after ${message.slice("timeout:".length)} seconds.`
          : sanitizeTerminalText(message),
      })
    }
  }

  #settle(record: JobRecord, terminal: TerminalLifecycle): void {
    const running = record.lifecycle
    if (running._tag !== "running") return

    record.output.finish()
    record.lifecycle = terminal
    const snapshot = this.#snapshot(record)
    running.resolveSettled(snapshot)
    this.#pruneSettled()

    if (!this.#closing && running.stopReason === undefined) this.#onSettled(snapshot)
  }

  #pruneSettled(): void {
    const settled = [...this.#jobs.values()].filter((record) => record.lifecycle._tag !== "running")
    const removeCount = settled.length - MAX_SETTLED_JOBS
    if (removeCount <= 0) return

    for (const record of settled.slice(0, removeCount)) this.#jobs.delete(record.id)
  }

  #snapshot(record: JobRecord): JobSnapshot {
    const base = {
      id: record.id,
      command: record.command,
      cwd: record.cwd,
      startedAt: record.startedAt,
      output: record.output.content(),
      outputTruncated: record.output.wasTruncated(),
      observedBytes: record.output.observedBytes(),
    }
    const lifecycle = record.lifecycle
    if (lifecycle._tag === "running") return { ...base, state: "running" }

    return {
      ...base,
      state: lifecycle._tag,
      endedAt: lifecycle.endedAt,
      ...(lifecycle.exitCode === undefined ? {} : { exitCode: lifecycle.exitCode }),
      ...(lifecycle.failure === undefined ? {} : { failure: lifecycle.failure }),
    }
  }
}

async function waitFor<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
