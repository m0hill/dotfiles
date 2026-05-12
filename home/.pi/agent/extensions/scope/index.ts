import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, realpathSync, type Dirent } from "node:fs"
import { readdir, realpath, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { delimiter, dirname, isAbsolute, relative, resolve, sep } from "node:path"
import type {
  BashOperations,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent"
import { createBashTool } from "@earendil-works/pi-coding-agent"

const SCOPE_STATE_TYPE = "scope-state"
const CUSTOM_PATH_CHOICE = "Custom path…"
const MAX_PICKER_DIRS = 250
const MAX_PICKER_DEPTH = 5
const IGNORED_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  ".pnpm",
  ".yarn",
  ".cache",
  ".next",
  "dist",
  "build",
  "target",
  "coverage",
])

const SYSTEM_READ_SUBPATHS = [
  "/bin",
  "/sbin",
  "/usr",
  "/System",
  "/Library",
  "/Applications",
  "/private/etc",
  "/etc",
  "/dev",
  "/opt",
  "/nix",
  "/var/select",
  "/private/var/select",
]

type ScopeState =
  | { status: "inactive" }
  | {
      status: "active"
      root: string
      rootReal: string
    }

type PersistedScopeState =
  | { active: false; timestamp: number }
  | { active: true; root: string; timestamp: number }

let state: ScopeState = { status: "inactive" }

function expandUserPath(path: string): string {
  const withoutAt = path.startsWith("@") ? path.slice(1) : path
  if (withoutAt === "~") return homedir()
  if (withoutAt.startsWith("~/")) return homedir() + withoutAt.slice(1)
  return withoutAt
}

function isInsidePath(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

async function nearestExistingRealpath(path: string): Promise<string> {
  let current = path
  while (true) {
    try {
      return await realpath(current)
    } catch {
      const parent = dirname(current)
      if (parent === current) return resolve(path)
      current = parent
    }
  }
}

async function resolveAllowedRoot(
  ctx: ExtensionCommandContext,
  selectedPath: string
): Promise<ScopeState> {
  const expanded = expandUserPath(selectedPath.trim())
  const absolute = isAbsolute(expanded) ? resolve(expanded) : resolve(ctx.cwd, expanded)
  const cwdReal = await realpath(ctx.cwd)
  const rootReal = await realpath(absolute)

  if (!isInsidePath(cwdReal, rootReal)) {
    throw new Error(`/scope root must be the current cwd or a nested directory: ${selectedPath}`)
  }

  const info = await stat(rootReal)
  if (!info.isDirectory()) {
    throw new Error(`/scope root must be a directory: ${selectedPath}`)
  }

  return { status: "active", root: absolute, rootReal }
}

async function resolveToolPathWithinScope(path: string | undefined): Promise<string> {
  if (state.status !== "active") throw new Error("/scope is not active")

  const rawPath = path?.trim() ? path : "."
  const expanded = expandUserPath(rawPath)
  const absolute = isAbsolute(expanded) ? resolve(expanded) : resolve(state.rootReal, expanded)
  const targetReal = await nearestExistingRealpath(absolute)

  if (!isInsidePath(state.rootReal, targetReal)) {
    throw new Error(`Path outside /scope root blocked: ${rawPath}`)
  }

  return absolute
}

function getPathInput(input: unknown): string | undefined {
  if (!input || typeof input !== "object" || !("path" in input)) return undefined
  const value = (input as { path?: unknown }).path
  return typeof value === "string" ? value : undefined
}

function setPathInput(input: unknown, path: string): void {
  if (!input || typeof input !== "object") return
  ;(input as { path?: string }).path = path
}

function shellString(value: string): string {
  return JSON.stringify(value)
}

function ensureTrailingSeparator(path: string): string {
  return path.endsWith(sep) ? path : `${path}${sep}`
}

function cacheTmpDirFor(cwd: string, rootReal: string): string {
  const rootHash = createHash("sha256").update(rootReal).digest("hex").slice(0, 16)
  return resolve(cwd, ".pi-cache", "scope", "tmp", rootHash)
}

function prepareCacheTmpDir(cwd: string, rootReal: string): string {
  const tmpDir = cacheTmpDirFor(cwd, rootReal)
  mkdirSync(tmpDir, { recursive: true, mode: 0o700 })

  const cwdReal = realpathSync(cwd)
  const tmpReal = realpathSync(tmpDir)
  if (!isInsidePath(cwdReal, tmpReal)) {
    throw new Error(`/scope temp directory resolved outside cwd: ${tmpDir}`)
  }
  return tmpReal
}

function getToolchainReadSubpaths(): string[] {
  const home = homedir()
  const paths = new Set<string>()
  const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean)

  for (const entry of pathEntries) {
    try {
      const realEntry = realpathSync(entry)
      paths.add(realEntry)

      if (isInsidePath(home, realEntry)) {
        const rel = relative(home, realEntry)
        const topLevelToolDirs = [
          ".local/share/mise",
          ".local/bin",
          ".cargo",
          ".rustup",
          ".bun",
          ".nvm",
          ".volta",
          ".deno",
        ]
        for (const toolDir of topLevelToolDirs) {
          if (rel === toolDir || rel.startsWith(`${toolDir}/`)) {
            paths.add(resolve(home, toolDir))
          }
        }
      }
    } catch {
      // Ignore PATH entries that do not exist or cannot be resolved.
    }
  }

  return [...paths]
}

function buildSandboxProfile(rootReal: string, tmpReal?: string): string {
  const readSubpaths = [
    ...SYSTEM_READ_SUBPATHS,
    ...getToolchainReadSubpaths(),
    rootReal,
    ...(tmpReal ? [tmpReal] : []),
  ]
  const readRules = [
    `(literal ${shellString("/")})`,
    ...[...new Set(readSubpaths)].map((path) => `(subpath ${shellString(path)})`),
  ].join("\n  ")

  const writeRules = [
    `(subpath ${shellString(rootReal)})`,
    ...(tmpReal ? [`(subpath ${shellString(tmpReal)})`] : []),
    `(literal ${shellString("/dev/null")})`,
    `(literal ${shellString("/dev/stdout")})`,
    `(literal ${shellString("/dev/stderr")})`,
    `(subpath ${shellString("/dev/fd")})`,
  ].join("\n  ")

  return [
    "(version 1)",
    "(allow default)",
    "(deny file-read*)",
    `(allow file-read*\n  ${readRules}\n)`,
    "(deny file-write*)",
    `(allow file-write* file-write-create\n  ${writeRules}\n)`,
  ].join("\n")
}

function createRestrictedEnv(
  baseEnv: NodeJS.ProcessEnv | undefined,
  rootReal: string,
  tmpReal?: string
): NodeJS.ProcessEnv {
  const pathValue =
    baseEnv?.PATH ?? process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"
  const env: NodeJS.ProcessEnv = {
    PATH: pathValue,
    HOME: rootReal,
    PWD: rootReal,
    TMPDIR: ensureTrailingSeparator(tmpReal ?? rootReal),
    TMP: tmpReal ?? rootReal,
    TEMP: tmpReal ?? rootReal,
    SHELL: "/bin/bash",
    USER: baseEnv?.USER ?? process.env.USER,
    LOGNAME: baseEnv?.LOGNAME ?? process.env.LOGNAME,
    TERM: baseEnv?.TERM ?? process.env.TERM ?? "xterm-256color",
    LANG: baseEnv?.LANG ?? process.env.LANG ?? "en_US.UTF-8",
    LC_ALL: baseEnv?.LC_ALL,
    XDG_CONFIG_HOME: resolve(rootReal, ".config"),
    XDG_CACHE_HOME: resolve(rootReal, ".cache"),
    XDG_DATA_HOME: resolve(rootReal, ".local", "share"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  }

  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined))
}

function createSandboxedBashOperations(rootReal: string, cwd?: string): BashOperations {
  return {
    async exec(command, _cwd, { onData, signal, timeout, env }) {
      if (process.platform !== "darwin") {
        throw new Error("/scope bash sandbox is macOS-only")
      }

      if (!existsSync(rootReal)) {
        throw new Error(`/scope root does not exist: ${rootReal}`)
      }

      const tmpReal = cwd ? prepareCacheTmpDir(cwd, rootReal) : undefined
      const profile = buildSandboxProfile(rootReal, tmpReal)

      return new Promise((resolvePromise, reject) => {
        const child = spawn("/usr/bin/sandbox-exec", ["-p", profile, "/bin/bash", "-c", command], {
          cwd: rootReal,
          detached: true,
          env: createRestrictedEnv(env, rootReal, tmpReal),
          stdio: ["ignore", "pipe", "pipe"],
        })

        let timedOut = false
        let timeoutHandle: NodeJS.Timeout | undefined

        if (timeout !== undefined && timeout > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true
            if (child.pid) {
              try {
                process.kill(-child.pid, "SIGKILL")
              } catch {
                child.kill("SIGKILL")
              }
            }
          }, timeout * 1000)
        }

        child.stdout?.on("data", onData)
        child.stderr?.on("data", onData)

        const onAbort = () => {
          if (!child.pid) return
          try {
            process.kill(-child.pid, "SIGKILL")
          } catch {
            child.kill("SIGKILL")
          }
        }

        signal?.addEventListener("abort", onAbort, { once: true })

        child.on("error", (error) => {
          if (timeoutHandle) clearTimeout(timeoutHandle)
          signal?.removeEventListener("abort", onAbort)
          reject(error)
        })

        child.on("close", (code) => {
          if (timeoutHandle) clearTimeout(timeoutHandle)
          signal?.removeEventListener("abort", onAbort)

          if (signal?.aborted) {
            reject(new Error("aborted"))
          } else if (timedOut) {
            reject(new Error(`timeout:${timeout}`))
          } else {
            resolvePromise({ exitCode: code })
          }
        })
      })
    },
  }
}

async function collectPickerDirs(cwd: string): Promise<string[]> {
  const cwdReal = await realpath(cwd)
  const results: string[] = ["."]

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth >= MAX_PICKER_DEPTH || results.length >= MAX_PICKER_DIRS) return

    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (results.length >= MAX_PICKER_DIRS) return
      if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name)) continue

      const absolute = resolve(dir, entry.name)
      let entryReal: string
      try {
        entryReal = await realpath(absolute)
      } catch {
        continue
      }
      if (!isInsidePath(cwdReal, entryReal)) continue

      results.push(relative(cwdReal, entryReal) || ".")
      await walk(absolute, depth + 1)
    }
  }

  await walk(cwdReal, 0)
  return [...new Set(results)].sort((a, b) => (a === "." ? -1 : b === "." ? 1 : a.localeCompare(b)))
}

function summarizeRoot(ctx: ExtensionContext, rootReal: string): string {
  const rel = relative(ctx.cwd, rootReal)
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? `./${rel}` : rootReal
}

function updateStatus(ctx: ExtensionContext): void {
  if (state.status === "active") {
    ctx.ui.setStatus("scope", ctx.ui.theme.fg("accent", `› ${summarizeRoot(ctx, state.rootReal)}`))
  } else {
    ctx.ui.setStatus("scope", undefined)
  }
}

function persistState(pi: ExtensionAPI): void {
  const entry: PersistedScopeState =
    state.status === "active"
      ? { active: true, root: state.rootReal, timestamp: Date.now() }
      : { active: false, timestamp: Date.now() }
  pi.appendEntry(SCOPE_STATE_TYPE, entry)
}

function restoreState(ctx: ExtensionContext): void {
  state = { status: "inactive" }

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== SCOPE_STATE_TYPE) continue
    const data = entry.data
    if (!data || typeof data !== "object") continue

    if ((data as { active?: unknown }).active === false) {
      state = { status: "inactive" }
      continue
    }

    const root = (data as { root?: unknown }).root
    if ((data as { active?: unknown }).active === true && typeof root === "string") {
      try {
        if (!existsSync(root)) {
          state = { status: "inactive" }
          continue
        }
        const cwdReal = realpathSync(ctx.cwd)
        const rootReal = realpathSync(root)
        state = isInsidePath(cwdReal, rootReal)
          ? { status: "active", root, rootReal }
          : { status: "inactive" }
      } catch {
        state = { status: "inactive" }
      }
    }
  }
}

async function activateScope(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  rootChoice: string
): Promise<void> {
  state = await resolveAllowedRoot(ctx, rootChoice)
  persistState(pi)
  updateStatus(ctx)
  if (state.status === "active") {
    ctx.ui.notify(`/scope active: ${summarizeRoot(ctx, state.rootReal)}`, "info")
  }
}

async function runScopePicker(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("/scope requires interactive UI to choose a directory.", "error")
    return
  }

  const dirs = await collectPickerDirs(ctx.cwd)
  const choices = [...dirs, CUSTOM_PATH_CHOICE]
  const selected = await ctx.ui.select("Choose /scope root", choices)
  if (!selected) return

  if (selected === CUSTOM_PATH_CHOICE) {
    const custom = await ctx.ui.input("/scope custom path", "Directory inside current cwd…")
    const trimmed = custom?.trim()
    if (!trimmed) return
    await activateScope(pi, ctx, trimmed)
    return
  }

  await activateScope(pi, ctx, selected)
}

export default function scopeExtension(pi: ExtensionAPI): void {
  const fallbackBash = createBashTool(process.cwd())

  pi.registerTool({
    ...fallbackBash,
    label: "bash (/scope-aware)",
    async execute(id, params, signal, onUpdate, _ctx) {
      if (state.status !== "active") {
        return fallbackBash.execute(id, params, signal, onUpdate)
      }

      const restrictedBash = createBashTool(state.rootReal, {
        operations: createSandboxedBashOperations(state.rootReal, _ctx.cwd),
      })
      return restrictedBash.execute(id, params, signal, onUpdate)
    },
  })

  pi.on("session_start", async (_event, ctx) => {
    restoreState(ctx)
    updateStatus(ctx)
  })

  pi.on("before_agent_start", async (event) => {
    if (state.status !== "active") return undefined
    return {
      systemPrompt: `${event.systemPrompt}\n\n/scope mode is active. Treat ${state.rootReal} as the workspace root. Use relative file paths from that root. Do not try to read, write, search, list, or run bash commands outside that root; they will be blocked.`,
    }
  })

  pi.on("tool_call", async (event) => {
    if (state.status !== "active") return undefined
    if (!["read", "write", "edit", "grep", "find", "ls"].includes(event.toolName)) return undefined

    try {
      const nextPath = await resolveToolPathWithinScope(getPathInput(event.input))
      setPathInput(event.input, nextPath)
      return undefined
    } catch (error) {
      return { block: true, reason: error instanceof Error ? error.message : String(error) }
    }
  })

  pi.on("user_bash", (_event, ctx) => {
    if (state.status !== "active") return undefined
    return { operations: createSandboxedBashOperations(state.rootReal, ctx.cwd) }
  })

  pi.registerCommand("scope", {
    description: "Restrict Pi tools and bash to a selected directory inside the current cwd",
    handler: async (_args, ctx) => {
      try {
        await runScopePicker(pi, ctx)
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error")
      }
    },
  })

  pi.registerCommand("scope-stop", {
    description: "Disable the active /scope restriction",
    handler: async (_args, ctx) => {
      state = { status: "inactive" }
      persistState(pi)
      updateStatus(ctx)
      ctx.ui.notify("/scope disabled", "info")
    },
  })
}
