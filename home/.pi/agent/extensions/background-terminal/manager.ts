import type { BashOperations } from "@earendil-works/pi-coding-agent"
import { OutputTail, sanitizeTerminalText } from "./output.ts"

const MAX_RUNNING_JOBS = 4
const MAX_SETTLED_JOBS = 20
const STOP_WAIT_MS = 2_000
const SHUTDOWN_WAIT_MS = 3_000
const TIMEOUT_PREFIX = "timeout:"

type TerminalState = "succeeded" | "failed" | "stopped" | "timed_out"

/** Public lifecycle state for one background job. */
export type JobState = "running" | TerminalState

/** How a process ended: its exit code, or `"signal"` when a signal ended it. */
export type ExitCode = number | "signal"

/** Immutable view of a background job. */
export type JobSnapshot = {
  readonly id: string
  readonly command: string
  readonly cwd: string
  readonly state: JobState
  readonly startedAt: number
  readonly endedAt?: number
  readonly exitCode?: ExitCode
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
export type ManagerClosingError = { readonly _tag: "ManagerClosingError" }

/** Expected failure returned when the concurrent-job cap is reached. */
export type ConcurrencyLimitError = {
  readonly _tag: "ConcurrencyLimitError"
  readonly limit: number
}

/** Expected failure returned when a job ID is unknown. */
export type JobNotFoundError = { readonly _tag: "JobNotFoundError"; readonly id: string }

/** Expected failure returned when a stopped process does not settle promptly. */
export type StopTimedOutError = { readonly _tag: "StopTimedOutError"; readonly id: string }

/** Every expected failure of a background-job operation. */
export type JobError =
  | ManagerClosingError
  | ConcurrencyLimitError
  | JobNotFoundError
  | StopTimedOutError

/** Result type used by background-job operations. */
export type JobResult<T, E extends JobError> =
  | { readonly _tag: "ok"; readonly value: T }
  | { readonly _tag: "err"; readonly error: E }

/** Describe an expected failure for people and agents. */
export function describeJobError(error: JobError): string {
  switch (error._tag) {
    case "ManagerClosingError":
      return "Background jobs are shutting down; no new job can be started."
    case "ConcurrencyLimitError":
      return `At most ${error.limit} background jobs may run concurrently.`
    case "JobNotFoundError":
      return `Unknown background job: ${error.id}`
    case "StopTimedOutError":
      return `Background job ${error.id} did not settle within ${STOP_WAIT_MS}ms.`
  }
}

/** Capabilities the manager takes from its host, so tests can supply their own. */
export type BackgroundJobsDeps = {
  readonly operations: BashOperations
  readonly now: () => number
  readonly withTimeout: <T>(promise: Promise<T>, timeoutMs: number) => Promise<T | undefined>
  readonly onSettled: (snapshot: JobSnapshot) => void
}

/** Session-scoped background processes, output tails, and legal lifecycle transitions. */
export type BackgroundJobs = {
  /** Launch a job and return immediately after registering it. */
  readonly start: (
    input: StartJobInput
  ) => JobResult<JobSnapshot, ManagerClosingError | ConcurrencyLimitError>
  /** Return one job by ID. */
  readonly get: (id: string) => JobResult<JobSnapshot, JobNotFoundError>
  /** List jobs newest first, including a bounded settled history. */
  readonly list: () => readonly JobSnapshot[]
  /** Return the number of currently running jobs. */
  readonly runningCount: () => number
  /** Stop a running job and wait briefly for process-tree cleanup. */
  readonly stop: (
    id: string
  ) => Promise<JobResult<JobSnapshot, JobNotFoundError | StopTimedOutError>>
  /** Stop every running job, suppress completion messages, and release session state. */
  readonly shutdown: () => Promise<void>
}

type StopReason = "stopped" | "shutdown"

type RunningLifecycle = {
  readonly _tag: "running"
  readonly controller: AbortController
  readonly settled: Promise<JobSnapshot>
  readonly stopReason: StopReason | undefined
}

type TerminalLifecycle = {
  readonly _tag: TerminalState
  readonly endedAt: number
  readonly exitCode: ExitCode | undefined
  readonly failure: string | undefined
}

type JobBase = {
  readonly id: string
  readonly command: string
  readonly cwd: string
  readonly startedAt: number
  readonly output: OutputTail
}

type JobRecord = JobBase & { readonly lifecycle: RunningLifecycle | TerminalLifecycle }

type RunningRecord = JobBase & { readonly lifecycle: RunningLifecycle }

type ExecOutcome =
  | { readonly _tag: "exited"; readonly exitCode: ExitCode }
  | { readonly _tag: "threw"; readonly message: string }

/** Create the manager for one session. */
export function createBackgroundJobs(deps: BackgroundJobsDeps): BackgroundJobs {
  // The manager owns this table and these counters. Records are immutable and replaced on each transition.
  const jobs = new Map<string, JobRecord>()
  const session = { nextId: 1, closing: false }

  const runningCount = (): number => [...jobs.values()].filter(isRunning).length

  const pruneSettled = (): void => {
    const settled = [...jobs.values()].filter((record) => !isRunning(record))
    const removeCount = Math.max(0, settled.length - MAX_SETTLED_JOBS)
    settled.slice(0, removeCount).forEach((record) => jobs.delete(record.id))
  }

  const settle = (base: JobBase, outcome: ExecOutcome): JobSnapshot => {
    const current = jobs.get(base.id)
    // A record missing here was released by shutdown before its process settled.
    const stopReason =
      current?.lifecycle._tag === "running" ? current.lifecycle.stopReason : "shutdown"
    base.output.finish()
    const settledRecord: JobRecord = {
      ...base,
      lifecycle: terminalFor(outcome, stopReason, deps.now()),
    }
    const snapshot = snapshotOf(settledRecord)
    if (current === undefined) return snapshot

    jobs.set(base.id, settledRecord)
    pruneSettled()
    if (!session.closing && stopReason === undefined) deps.onSettled(snapshot)
    return snapshot
  }

  const execute = async (
    base: JobBase,
    signal: AbortSignal,
    timeoutSeconds: number | undefined
  ): Promise<JobSnapshot> => {
    const onData = (data: Buffer) => base.output.append(data)
    const options =
      timeoutSeconds === undefined
        ? { onData, signal }
        : { onData, signal, timeout: timeoutSeconds }
    const outcome = await deps.operations.exec(base.command, base.cwd, options).then(
      (result): ExecOutcome => ({ _tag: "exited", exitCode: result.exitCode ?? "signal" }),
      (cause: unknown): ExecOutcome => ({
        _tag: "threw",
        message: cause instanceof Error ? cause.message : String(cause),
      })
    )
    return settle(base, outcome)
  }

  const requestStop = (record: RunningRecord, reason: StopReason): void => {
    jobs.set(record.id, { ...record, lifecycle: { ...record.lifecycle, stopReason: reason } })
    record.lifecycle.controller.abort()
  }

  return {
    start(input) {
      if (session.closing) return { _tag: "err", error: { _tag: "ManagerClosingError" } }
      if (runningCount() >= MAX_RUNNING_JOBS) {
        return { _tag: "err", error: { _tag: "ConcurrencyLimitError", limit: MAX_RUNNING_JOBS } }
      }

      const id = `bg-${session.nextId}`
      session.nextId += 1
      const base: JobBase = {
        id,
        command: input.command,
        cwd: input.cwd,
        startedAt: deps.now(),
        output: new OutputTail(),
      }
      const controller = new AbortController()
      // `execute` settles only after `exec` resolves, so the record below is registered first.
      const settled = execute(base, controller.signal, input.timeoutSeconds)
      const record: JobRecord = {
        ...base,
        lifecycle: { _tag: "running", controller, settled, stopReason: undefined },
      }
      jobs.set(id, record)
      return { _tag: "ok", value: snapshotOf(record) }
    },

    get(id) {
      const record = jobs.get(id)
      return record
        ? { _tag: "ok", value: snapshotOf(record) }
        : { _tag: "err", error: { _tag: "JobNotFoundError", id } }
    },

    list() {
      return [...jobs.values()].reverse().map(snapshotOf)
    },

    runningCount,

    async stop(id) {
      const record = jobs.get(id)
      if (!record) return { _tag: "err", error: { _tag: "JobNotFoundError", id } }
      if (!isRunning(record)) return { _tag: "ok", value: snapshotOf(record) }

      requestStop(record, "stopped")
      const snapshot = await deps.withTimeout(record.lifecycle.settled, STOP_WAIT_MS)
      return snapshot
        ? { _tag: "ok", value: snapshot }
        : { _tag: "err", error: { _tag: "StopTimedOutError", id } }
    },

    async shutdown() {
      if (session.closing) return
      session.closing = true

      const running = [...jobs.values()].filter(isRunning)
      running.forEach((record) => requestStop(record, "shutdown"))
      await deps.withTimeout(
        Promise.all(running.map((record) => record.lifecycle.settled)),
        SHUTDOWN_WAIT_MS
      )
      jobs.clear()
    },
  }
}

function isRunning(record: JobRecord): record is RunningRecord {
  return record.lifecycle._tag === "running"
}

function terminalFor(
  outcome: ExecOutcome,
  stopReason: StopReason | undefined,
  endedAt: number
): TerminalLifecycle {
  if (outcome._tag === "exited") {
    if (outcome.exitCode === 0) {
      return { _tag: "succeeded", endedAt, exitCode: 0, failure: undefined }
    }
    const failure =
      outcome.exitCode === "signal"
        ? "Command was ended by a signal."
        : `Command exited with code ${outcome.exitCode}.`
    return { _tag: "failed", endedAt, exitCode: outcome.exitCode, failure }
  }

  if (stopReason !== undefined) {
    const failure =
      stopReason === "shutdown" ? "Stopped during session shutdown." : "Stopped by request."
    return { _tag: "stopped", endedAt, exitCode: undefined, failure }
  }

  if (outcome.message.startsWith(TIMEOUT_PREFIX)) {
    const seconds = outcome.message.slice(TIMEOUT_PREFIX.length)
    const failure = `Command timed out after ${seconds} seconds.`
    return { _tag: "timed_out", endedAt, exitCode: undefined, failure }
  }

  return {
    _tag: "failed",
    endedAt,
    exitCode: undefined,
    failure: sanitizeTerminalText(outcome.message),
  }
}

function snapshotOf(record: JobRecord): JobSnapshot {
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
    exitCode: lifecycle.exitCode,
    failure: lifecycle.failure,
  }
}
