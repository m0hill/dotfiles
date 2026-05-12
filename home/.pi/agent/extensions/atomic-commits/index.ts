import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { createHash, randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const TOOL_NAME = "atomic_commit_plan_set"
const MAX_UNTRACKED_TEXT_BYTES = 200 * 1024

type DiffLine = {
  kind: "context" | "add" | "delete" | "note"
  raw: string
}

type AtomicChange = {
  key: string
  file: string
  header: string
  kind: "addition" | "deletion" | "replacement"
  addedLines: number
  deletedLines: number
  preview: string
  lines: DiffLine[]
}

type DiffFile = {
  path: string
  headerLines: string[]
  changes: AtomicChange[]
}

type Snapshot = {
  snapshotId: string
  files: DiffFile[]
  unsupported: string[]
}

type CommitPlan = {
  message: string
  body?: string
  rationale: string
  changeKeys: string[]
}

type AtomicPlan = {
  sessionId: string
  snapshotId: string
  commits: CommitPlan[]
}

type AtomicSession = {
  id: string
  createdAt: number
  title: string
  snapshotPath: string
  planPath: string
}

type NewAtomicSession = {
  title: string
  snapshot: Snapshot
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16)
}

function atomicWriteJson(path: string, value: unknown): void {
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8")
  renameSync(tempPath, path)
}

function readJsonFile<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T
  } catch {
    return undefined
  }
}

function projectDirForCwd(cwd: string): string {
  return join(cwd, ".pi-cache", "atomic-commits", "sessions")
}

function sessionPathFor(cwd: string, id: string): string {
  return join(projectDirForCwd(cwd), `${id}.json`)
}

function snapshotPathFor(cwd: string, id: string): string {
  return join(projectDirForCwd(cwd), `${id}.snapshot.json`)
}

function planPathFor(cwd: string, id: string): string {
  return join(projectDirForCwd(cwd), `${id}.plan.json`)
}

function writeSession(cwd: string, opts: NewAtomicSession): AtomicSession {
  const dir = projectDirForCwd(cwd)
  mkdirSync(dir, { recursive: true })
  const id = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const session: AtomicSession = {
    id,
    createdAt: Date.now(),
    title: opts.title,
    snapshotPath: snapshotPathFor(cwd, id),
    planPath: planPathFor(cwd, id),
  }
  atomicWriteJson(sessionPathFor(cwd, id), session)
  atomicWriteJson(session.snapshotPath, opts.snapshot)
  return session
}

function readSession(cwd: string, id: string): AtomicSession | undefined {
  return readJsonFile<AtomicSession>(sessionPathFor(cwd, id))
}

function writePlan(cwd: string, plan: AtomicPlan): void {
  const session = readSession(cwd, plan.sessionId)
  if (!session) throw new Error(`Unknown atomic commit session: ${plan.sessionId}`)
  atomicWriteJson(session.planPath, plan)
}

function readPlan(cwd: string, sessionId: string): AtomicPlan | undefined {
  const session = readSession(cwd, sessionId)
  if (!session) return undefined
  return readJsonFile<AtomicPlan>(session.planPath)
}

function readSnapshotForPlan(cwd: string, plan: AtomicPlan): Snapshot {
  const session = readSession(cwd, plan.sessionId)
  if (!session) throw new Error(`Unknown atomic commit session: ${plan.sessionId}`)
  const snapshot = readJsonFile<Snapshot>(session.snapshotPath)
  if (!snapshot) throw new Error(`Could not read atomic commit snapshot: ${session.snapshotPath}`)
  return snapshot
}

function changeKeysFor(snapshot: Snapshot): string[] {
  return snapshot.files.flatMap((file) => file.changes.map((change) => change.key))
}

function validatePlanCoverage(snapshot: Snapshot, plan: AtomicPlan): string | undefined {
  const expected = new Set(changeKeysFor(snapshot))
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  const unknown = new Set<string>()

  for (const commit of plan.commits) {
    for (const key of commit.changeKeys) {
      if (!expected.has(key)) unknown.add(key)
      if (seen.has(key)) duplicates.add(key)
      seen.add(key)
    }
  }

  const missing = [...expected].filter((key) => !seen.has(key))
  const problems = []
  if (unknown.size) problems.push(`Unknown change keys: ${[...unknown].join(", ")}`)
  if (duplicates.size) problems.push(`Duplicate change keys: ${[...duplicates].join(", ")}`)
  if (missing.length) problems.push(`Missing change keys: ${missing.join(", ")}`)
  if (!problems.length) return undefined
  return `${problems.join("\n")}\n\nEvery supported change key from the snapshot must appear exactly once in the plan. Unsupported files may be omitted.`
}

function formatPlan(plan: AtomicPlan): string {
  const lines = [`Atomic commit plan ${plan.sessionId}`, ""]
  plan.commits.forEach((commit, index) => {
    lines.push(`${index + 1}. ${commit.message}`)
    lines.push(`   Changes: ${commit.changeKeys.length}`)
    lines.push("")
  })
  lines.push("If this looks good, run /atomic-proceed. Otherwise tell me what to change.")
  return lines.join("\n").trim()
}

function parseDiff(diff: string): Snapshot {
  const files: DiffFile[] = []
  const unsupported: string[] = []
  let currentFile: DiffFile | undefined
  let currentHunk: { header: string; lines: DiffLine[] } | undefined

  function finishHunk(): void {
    if (!currentFile || !currentHunk) return
    const changedLines = currentHunk.lines.filter(
      (line) => line.kind === "add" || line.kind === "delete"
    )
    if (changedLines.length === 0) {
      currentHunk = undefined
      return
    }
    const addedLines = changedLines.filter((line) => line.kind === "add").length
    const deletedLines = changedLines.filter((line) => line.kind === "delete").length
    const kind =
      addedLines > 0 && deletedLines > 0 ? "replacement" : addedLines > 0 ? "addition" : "deletion"
    const preview = changedLines
      .slice(0, 3)
      .map((line) => line.raw)
      .join(" | ")
      .slice(0, 180)
    const key = `ck_${hash(`${currentFile.path}\n${currentHunk.header}\n${changedLines.map((line) => line.raw).join("\n")}`)}`
    currentFile.changes.push({
      key,
      file: currentFile.path,
      header: currentHunk.header,
      kind,
      addedLines,
      deletedLines,
      preview,
      lines: currentHunk.lines,
    })
    currentHunk = undefined
  }

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      finishHunk()
      currentFile = {
        path: line.replace(/^diff --git a\//, "").replace(/ b\/.*$/, ""),
        headerLines: [line],
        changes: [],
      }
      files.push(currentFile)
      continue
    }
    if (!currentFile) continue
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      unsupported.push(`${currentFile.path}: binary diff`)
      continue
    }
    if (line.startsWith("rename ") || line.startsWith("copy ")) {
      unsupported.push(`${currentFile.path}: rename/copy diff`)
      continue
    }
    if (line.startsWith("@@ ")) {
      finishHunk()
      currentHunk = { header: line, lines: [] }
      continue
    }
    if (currentHunk) {
      const kind = line.startsWith("+")
        ? "add"
        : line.startsWith("-")
          ? "delete"
          : line.startsWith("\\")
            ? "note"
            : "context"
      currentHunk.lines.push({ kind, raw: line })
    } else {
      currentFile.headerLines.push(line)
    }
  }
  finishHunk()

  const nonEmptyFiles = files.filter((file) => file.changes.length > 0)
  return {
    snapshotId: `s_${hash(nonEmptyFiles.flatMap((file) => [file.path, ...file.changes.map((change) => change.key)]).join("\n"))}`,
    files: nonEmptyFiles,
    unsupported,
  }
}

function compactSnapshot(snapshot: Snapshot): unknown {
  return {
    snapshotId: snapshot.snapshotId,
    changes: snapshot.files.flatMap((file) =>
      file.changes.map((change) => ({
        key: change.key,
        file: file.path,
        header: change.header,
        kind: change.kind,
        addedLines: change.addedLines,
        deletedLines: change.deletedLines,
        preview: change.preview,
      }))
    ),
    unsupported: snapshot.unsupported,
  }
}

function diffFileForUntracked(path: string): DiffFile | { unsupported: string } {
  const stat = statSync(path)
  if (!stat.isFile()) return { unsupported: `${path}: not a regular file` }
  if (stat.size > MAX_UNTRACKED_TEXT_BYTES)
    return { unsupported: `${path}: untracked file is too large` }

  const buffer = readFileSync(path)
  if (buffer.includes(0)) return { unsupported: `${path}: binary untracked file` }

  const text = buffer.toString("utf8")
  const lines = text.length ? text.replace(/\n$/, "").split("\n") : []
  const diffLines: DiffLine[] = lines.map((line) => ({ kind: "add", raw: `+${line}` }))
  const header = `@@ -0,0 +1,${lines.length} @@`
  const key = `ck_${hash(`${path}\n${header}\n${diffLines.map((line) => line.raw).join("\n")}`)}`
  return {
    path,
    headerLines: [
      "diff --git a/" + path + " b/" + path,
      "new file mode 100644",
      "index 0000000..0000000",
      "--- /dev/null",
      "+++ b/" + path,
    ],
    changes: [
      {
        key,
        file: path,
        header,
        kind: "addition",
        addedLines: lines.length,
        deletedLines: 0,
        preview: diffLines
          .slice(0, 3)
          .map((line) => line.raw)
          .join(" | ")
          .slice(0, 180),
        lines: diffLines,
      },
    ],
  }
}

function buildPatch(snapshot: Snapshot, keys: readonly string[]): string {
  const wanted = new Set(keys)
  const chunks: string[] = []
  for (const file of snapshot.files) {
    const changes = file.changes.filter((change) => wanted.has(change.key))
    if (changes.length === 0) continue
    chunks.push(...file.headerLines.filter(Boolean))
    for (const change of changes)
      chunks.push(change.header, ...change.lines.map((line) => line.raw))
  }
  return `${chunks.join("\n")}\n`
}

async function scanWorktree(pi: ExtensionAPI): Promise<Snapshot> {
  const diff = await pi.exec("git", ["diff", "--no-ext-diff", "--unified=0", "--diff-filter=ADM"])
  const snapshot = parseDiff(diff.stdout)
  const untracked = await pi.exec("git", ["ls-files", "--others", "--exclude-standard"])
  const untrackedPaths = untracked.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  for (const path of untrackedPaths) {
    try {
      const file = diffFileForUntracked(path)
      if ("unsupported" in file) snapshot.unsupported.push(file.unsupported)
      else snapshot.files.push(file)
    } catch {
      snapshot.unsupported.push(`${path}: could not read untracked file`)
    }
  }
  snapshot.snapshotId = `s_${hash(snapshot.files.flatMap((file) => [file.path, ...file.changes.map((change) => change.key)]).join("\n"))}`
  return snapshot
}

async function requireCleanIndex(pi: ExtensionAPI): Promise<boolean> {
  const staged = await pi.exec("git", ["diff", "--cached", "--quiet", "--exit-code"])
  return staged.code === 0
}

async function applyPatchToIndex(
  pi: ExtensionAPI,
  patch: string,
  dryRun: boolean
): Promise<{ ok: boolean; output: string }> {
  const dir = await mkdtemp(join(tmpdir(), "pi-atomic-"))
  const patchFile = join(dir, "selected.patch")
  try {
    await writeFile(patchFile, patch, "utf8")
    const check = await pi.exec("git", [
      "apply",
      "--cached",
      "--unidiff-zero",
      "--check",
      patchFile,
    ])
    if (check.code !== 0) return { ok: false, output: check.stderr || check.stdout }
    if (!dryRun) {
      const applied = await pi.exec("git", ["apply", "--cached", "--unidiff-zero", patchFile])
      return { ok: applied.code === 0, output: applied.stderr || applied.stdout }
    }
    return { ok: true, output: "Patch applies cleanly." }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function planPrompt(session: AtomicSession, snapshot: Snapshot): string {
  return `Create an atomic commit plan for the current git diff.

Atomic commit session id: ${session.id}
Plan artifact path: ${session.planPath}

Rules:
- Use the ${TOOL_NAME} tool whenever you create or revise the plan.
- Preserve user feedback when revising the plan in later turns.
- Group changes into reviewable commits.
- Use only the provided change keys.
- Every supported change key from the snapshot must appear exactly once in the plan.
- Prefer small semantic commits over broad file-based commits.
- Put tests with the behavior they validate unless they are a separate test-only cleanup.
- Every commit must leave the repository in a coherent state.
- Never place a usage/import of a symbol, helper, type, or file before the commit that adds it.
- If changes depend on a new helper/file/type, include that dependency in the same commit as the first usage.
- Prefer combining dependent changes over creating smaller commits that break intermediate states.
- If atomic splitting does not make sense, or safe coherent splitting is not possible, use a single commit.
- Commit messages must be concise, single-line messages.
- Use simple conventional prefixes like fix:, feat:, or chore:.
- Do not use scopes like fix(ui):; write fix: instead.
- Do not write commit bodies unless the user explicitly asks for them.
- Keep rationale short; it is only internal planning context and will not be committed or shown by default.
- After you save the plan, the user can run /atomic-proceed or ask you to revise it.

Snapshot:
${JSON.stringify(compactSnapshot(snapshot), null, 2)}`
}

async function applyPlan(
  pi: ExtensionAPI,
  ctx: {
    cwd: string
    hasUI: boolean
    ui: {
      notify: (message: string, level: "info" | "warning" | "error") => void
      select: (title: string, options: string[]) => Promise<string | undefined>
      input: (title: string, placeholder?: string) => Promise<string | undefined>
    }
  },
  plan: AtomicPlan
): Promise<void> {
  if (!(await requireCleanIndex(pi))) {
    ctx.ui.notify(
      "Atomic commits require a clean index. Commit, stash, or reset staged changes first.",
      "warning"
    )
    return
  }

  let confirmAll = false
  for (const [index, commit] of plan.commits.entries()) {
    const snapshot = await scanWorktree(pi)
    const available = new Set(
      snapshot.files.flatMap((file) => file.changes.map((change) => change.key))
    )
    const keys = commit.changeKeys.filter((key) => available.has(key))
    if (keys.length === 0) continue

    const patch = buildPatch(snapshot, keys)
    const dryRun = await applyPatchToIndex(pi, patch, true)
    if (!dryRun.ok) {
      ctx.ui.notify(`Could not apply ${commit.message}: ${dryRun.output}`, "error")
      return
    }

    const applied = await applyPatchToIndex(pi, patch, false)
    if (!applied.ok) {
      ctx.ui.notify(`Failed to stage ${commit.message}: ${applied.output}`, "error")
      return
    }

    const stat = await pi.exec("git", ["diff", "--cached", "--stat"])
    let message = commit.message
    let body = commit.body?.trim()

    if (!confirmAll) {
      const choice = ctx.hasUI
        ? await ctx.ui.select(
            `Commit ${index + 1}/${plan.commits.length}: ${message}\n\n${stat.stdout.trim()}`,
            ["Confirm", "Edit message", "Skip", "Abort", "Confirm all"]
          )
        : undefined

      if (choice === "Abort" || !choice) {
        await pi.exec("git", ["reset"])
        ctx.ui.notify("Atomic commits aborted; index reset.", "warning")
        return
      }
      if (choice === "Skip") {
        await pi.exec("git", ["reset"])
        continue
      }
      if (choice === "Confirm all") confirmAll = true
      if (choice === "Edit message") {
        const edited = await ctx.ui.input("Commit message", message)
        if (!edited?.trim()) {
          await pi.exec("git", ["reset"])
          ctx.ui.notify("Atomic commits aborted; empty commit message.", "warning")
          return
        }
        message = edited.trim()
        const editedBody = await ctx.ui.input("Commit body (optional)", body ?? "")
        body = editedBody?.trim() || undefined
      }
    }

    const args = ["commit", "-m", message]
    if (body) args.push("-m", body)
    const committed = await pi.exec("git", args)
    if (committed.code !== 0) {
      ctx.ui.notify(`Commit failed: ${committed.stderr || committed.stdout}`, "error")
      return
    }
    ctx.ui.notify(`Committed: ${message}`, "info")
  }
}

export default function atomicCommits(pi: ExtensionAPI): void {
  let activeSessionId: string | undefined

  pi.registerTool({
    name: TOOL_NAME,
    label: "Atomic Commit Plan",
    description:
      "Create or update the persisted atomic commit plan for an active atomic commit session.",
    parameters: Type.Object({
      sessionId: Type.String(),
      snapshotId: Type.String(),
      commits: Type.Array(
        Type.Object({
          message: Type.String({
            description:
              "Concise single-line commit message using simple prefixes like fix:, feat:, or chore:. Do not use scoped forms like fix(ui):.",
          }),
          body: Type.Optional(
            Type.String({
              description:
                "Usually omit. Only include if the user explicitly asks for commit bodies.",
            })
          ),
          rationale: Type.String({
            description: "Brief internal reason for grouping. Keep this short.",
          }),
          changeKeys: Type.Array(Type.String()),
        })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const plan: AtomicPlan = params
      const snapshot = readSnapshotForPlan(ctx.cwd, plan)
      const coverageError = validatePlanCoverage(snapshot, plan)
      if (coverageError) throw new Error(coverageError)

      writePlan(ctx.cwd, plan)
      activeSessionId = plan.sessionId

      return {
        content: [{ type: "text", text: formatPlan(plan) }],
        details: plan,
        terminate: true,
      }
    },
  })

  pi.registerCommand("atomic-commits", {
    description: "Create a new persisted atomic commit plan for the current git diff",
    handler: async (_args, ctx) => {
      await ctx.waitForIdle()
      if (!(await requireCleanIndex(pi))) {
        ctx.ui.notify(
          "Atomic commits require a clean index. Commit, stash, or reset staged changes first.",
          "warning"
        )
        return
      }
      const snapshot = await scanWorktree(pi)
      if (snapshot.files.length === 0) {
        ctx.ui.notify("No unstaged text changes found.", "info")
        return
      }
      const session = writeSession(ctx.cwd, { title: "Atomic commit plan", snapshot })
      activeSessionId = session.id
      pi.sendUserMessage(planPrompt(session, snapshot))
    },
  })

  pi.registerCommand("atomic-proceed", {
    description: "Apply the latest persisted atomic commit plan one commit at a time",
    handler: async (_args, ctx) => {
      await ctx.waitForIdle()
      if (!activeSessionId) {
        ctx.ui.notify("No active atomic commit plan. Run /atomic-commits first.", "warning")
        return
      }
      const plan = readPlan(ctx.cwd, activeSessionId)
      if (!plan) {
        ctx.ui.notify(
          "No persisted atomic commit plan found. Ask the planner to create one first.",
          "warning"
        )
        return
      }
      await applyPlan(pi, ctx, plan)
    },
  })
}
