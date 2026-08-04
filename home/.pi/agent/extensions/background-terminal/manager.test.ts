import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createLocalBashOperations, type BashOperations } from "@earendil-works/pi-coding-agent"
import { BackgroundJobs, ConcurrencyLimitError } from "./manager.ts"
import { OutputTail, sanitizeTerminalText } from "./output.ts"

type PendingRun = {
  readonly signal: AbortSignal | undefined
  resolve(exitCode: number | null): void
  reject(error: Error): void
}

class ControlledOperations implements BashOperations {
  readonly runs: PendingRun[] = []

  exec(
    _command: string,
    _cwd: string,
    options: {
      onData: (data: Buffer) => void
      signal?: AbortSignal
      timeout?: number
      env?: NodeJS.ProcessEnv
    }
  ): Promise<{ exitCode: number | null }> {
    options.onData(Buffer.from("started\n"))
    return new Promise((resolve, reject) => {
      const run: PendingRun = {
        signal: options.signal,
        resolve: (exitCode) => resolve({ exitCode }),
        reject,
      }
      options.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
      this.runs.push(run)
    })
  }
}

async function nextTask(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("Condition did not become true before timeout")
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

test("output tail decodes split UTF-8 and strips terminal controls", () => {
  const tail = new OutputTail()
  const bytes = Buffer.from("before \u001b[31mred\u001b[0m café\u0000\n")
  tail.append(bytes.subarray(0, bytes.length - 2))
  tail.append(bytes.subarray(bytes.length - 2))
  tail.finish()

  assert.equal(tail.content(), "before red café\n")
  assert.equal(tail.observedBytes(), bytes.length)
  assert.equal(tail.wasTruncated(), false)
  assert.equal(sanitizeTerminalText("a\u0007b\t\nc"), "ab\t\nc")
})

test("output tail retains only bounded recent output", () => {
  const tail = new OutputTail()
  tail.append(Buffer.from(`oldest\n${"recent\n".repeat(2_100)}latest\n`))
  tail.finish()

  assert.equal(tail.wasTruncated(), true)
  assert.match(tail.content(), /latest$/u)
  assert.doesNotMatch(tail.content(), /oldest/u)
})

test("jobs settle successfully and notify once", async () => {
  const operations = new ControlledOperations()
  const notifications: string[] = []
  const jobs = new BackgroundJobs(operations, (job) => notifications.push(job.id))

  const started = jobs.start({ command: "build", cwd: "/tmp" })
  if (started._tag === "err") throw started.error
  assert.equal(started._tag, "ok")

  operations.runs[0]?.resolve(0)
  await nextTask()

  const completed = jobs.get(started.value.id)
  if (completed._tag === "err") throw completed.error
  assert.equal(completed._tag, "ok")
  assert.equal(completed.value.state, "succeeded")
  assert.equal(completed.value.output, "started\n")
  assert.deepEqual(notifications, [started.value.id])
})

test("non-zero exits and runner failures become terminal values", async () => {
  const operations = new ControlledOperations()
  const jobs = new BackgroundJobs(operations, () => undefined)

  const failedExit = jobs.start({ command: "false", cwd: "/tmp" })
  operations.runs[0]?.resolve(7)
  await nextTask()
  assert.equal(failedExit._tag === "ok" ? jobs.get(failedExit.value.id)._tag : "err", "ok")
  if (failedExit._tag === "ok") {
    const snapshot = jobs.get(failedExit.value.id)
    assert.equal(snapshot._tag === "ok" ? snapshot.value.state : undefined, "failed")
    assert.equal(snapshot._tag === "ok" ? snapshot.value.exitCode : undefined, 7)
  }

  const timedOut = jobs.start({ command: "sleep", cwd: "/tmp", timeoutSeconds: 1 })
  operations.runs[1]?.reject(new Error("timeout:1"))
  await nextTask()
  if (timedOut._tag === "ok") {
    const snapshot = jobs.get(timedOut.value.id)
    assert.equal(snapshot._tag === "ok" ? snapshot.value.state : undefined, "timed_out")
  }
})

test("explicit stop aborts work and suppresses completion notification", async () => {
  const operations = new ControlledOperations()
  const notifications: string[] = []
  const jobs = new BackgroundJobs(operations, (job) => notifications.push(job.id))
  const started = jobs.start({ command: "server", cwd: "/tmp" })
  if (started._tag === "err") throw started.error
  assert.equal(started._tag, "ok")

  const stopped = await jobs.stop(started.value.id)
  if (stopped._tag === "err") throw stopped.error
  assert.equal(stopped._tag, "ok")
  assert.equal(stopped.value.state, "stopped")
  assert.equal(operations.runs[0]?.signal?.aborted, true)
  assert.deepEqual(notifications, [])
})

test("manager enforces the running-job cap", () => {
  const operations = new ControlledOperations()
  const jobs = new BackgroundJobs(operations, () => undefined)

  for (let index = 0; index < 4; index += 1) {
    assert.equal(jobs.start({ command: `job-${index}`, cwd: "/tmp" })._tag, "ok")
  }
  const rejected = jobs.start({ command: "too-many", cwd: "/tmp" })
  if (rejected._tag === "ok") assert.fail("Expected the fifth concurrent job to be rejected")
  assert.equal(rejected._tag, "err")
  assert.ok(rejected.error instanceof ConcurrencyLimitError)
})

test("shutdown aborts all jobs without notifications and rejects later starts", async () => {
  const operations = new ControlledOperations()
  const notifications: string[] = []
  const jobs = new BackgroundJobs(operations, (job) => notifications.push(job.id))
  jobs.start({ command: "one", cwd: "/tmp" })
  jobs.start({ command: "two", cwd: "/tmp" })

  await jobs.shutdown()

  assert.equal(
    operations.runs.every((run) => run.signal?.aborted),
    true
  )
  assert.deepEqual(notifications, [])
  assert.equal(jobs.list().length, 0)
  assert.equal(jobs.start({ command: "late", cwd: "/tmp" })._tag, "err")
})

test("local operations stop a descendant process tree", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-bg-test-"))
  const pidFile = join(directory, "child.pid")
  const jobs = new BackgroundJobs(createLocalBashOperations(), () => undefined)

  try {
    const started = jobs.start({
      command: `sleep 30 & echo $! > ${JSON.stringify(pidFile)}; wait`,
      cwd: directory,
    })
    if (started._tag === "err") throw started.error
    assert.equal(started._tag, "ok")

    let childPid = 0
    await waitUntil(async () => {
      const value = await readFile(pidFile, "utf8").catch(() => undefined)
      childPid = value ? Number(value.trim()) : 0
      return childPid > 0
    })

    const stopped = await jobs.stop(started.value.id)
    assert.equal(stopped._tag, "ok")
    await waitUntil(() => {
      try {
        process.kill(childPid, 0)
        return false
      } catch {
        return true
      }
    })
  } finally {
    await jobs.shutdown()
    await rm(directory, { recursive: true, force: true })
  }
})
