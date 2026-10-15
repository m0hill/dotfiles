import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { appendFile, mkdir, readFile, readdir, stat } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { serve } from "@hono/node-server"
import type { ExtensionAPI, ExtensionToolContext, ToolInfo } from "@earendil-works/pi-coding-agent"
import { build } from "esbuild"
import { bodyLimit } from "hono/body-limit"
import { Hono } from "hono/tiny"
import { Type, type Static } from "typebox"
import { Value } from "typebox/value"

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url))
/** Every surface is one file, `<SURFACES_DIR>/<name>.tsx`, sharing one kit and tsconfig. */
const SURFACES_DIR = resolve(EXTENSION_DIR, "../../surfaces")
const SKILL_PATH = join(EXTENSION_DIR, "SKILL.md")
const KIT_PATH = join(EXTENSION_DIR, "runtime", "index.tsx")
const TSC_PATH = resolve(EXTENSION_DIR, "../../../node_modules/.bin/tsc")
const TAILWIND_PATH = createRequire(import.meta.url).resolve("@tailwindcss/browser")
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/

/** What a surface file default-exports, as far as the bridge cares. */
const SurfaceInfo = Type.Object({
  title: Type.String({ minLength: 1 }),
  description: Type.String(),
  /** MCP tools (`mcp__<server>__<tool>`) the surface may call. */
  tools: Type.Array(Type.String({ pattern: "^mcp__" }), { minItems: 1 }),
})
type SurfaceInfo = Static<typeof SurfaceInfo>

const CallRequest = Type.Object({
  tool: Type.String(),
  args: Type.Record(Type.String(), Type.Unknown()),
})

const SampleRequest = Type.Object({
  tool: Type.String(),
  args: Type.Unknown(),
  result: Type.Unknown(),
  problem: Type.String(),
})

const AskRequest = Type.Object({
  tool: Type.Optional(Type.String()),
  args: Type.Optional(Type.Unknown()),
  result: Type.Optional(Type.Unknown()),
  problem: Type.Optional(Type.String()),
  message: Type.Optional(Type.String()),
})

interface LoadedSurface {
  name: string
  file: string
  info: SurfaceInfo
}

const ALLOW_ONCE = "Allow once"
const ALLOW_SURFACE = "Allow all writes from this surface until Pi exits"
const DENY = "Deny"

/** Colors as CSS variables so Tailwind utilities like `bg-card` follow light and dark mode. */
const THEME = `
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-border: var(--border);
  --color-ring: var(--ring);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-destructive: var(--destructive);
}
:root {
  color-scheme: light dark;
  --background: #fafaf9;
  --foreground: #1c1c1a;
  --card: #ffffff;
  --muted: #f1f1ef;
  --muted-foreground: #6b6b67;
  --border: #e4e4e1;
  --ring: #a1a19c;
  --primary: #1c1c1a;
  --primary-foreground: #fafaf9;
  --destructive: #dc2626;
}
@media (prefers-color-scheme: dark) {
  :root {
    --background: #141413;
    --foreground: #ececea;
    --card: #1c1c1b;
    --muted: #262625;
    --muted-foreground: #9b9b97;
    --border: #2f2f2d;
    --ring: #5c5c58;
    --primary: #ececea;
    --primary-foreground: #141413;
    --destructive: #f87171;
  }
}`

/** Moves the token from the URL fragment into sessionStorage, where the kit reads it. */
const TOKEN_SCRIPT = `<script>
  const token = new URLSearchParams(location.hash.slice(1)).get("token")
  if (token) {
    sessionStorage.setItem("pi-surfaces-token", token)
    history.replaceState(null, "", location.pathname + location.search)
  }
</script>`

let server: ReturnType<typeof serve> | undefined
let serverPort: number | undefined
let serverStart: Promise<number> | undefined
let token = ""
const trustedWriters = new Set<string>()
const loaded = new Map<string, { mtimeMs: number; surface: LoadedSurface }>()
let browserOpened = false
/**
 * Tool context captured from the latest `surface_open` call. Pi only offers `executeTool()`
 * inside a tool's `execute()`; the bridge keeps using it after that call returns so browser
 * requests can run MCP tools between turns. Pi does not document this use, so a reload or session
 * switch requires `surface_open` again.
 */
let bridge: ExtensionToolContext | undefined

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`)
}

/** Runs a command and resolves to its exit code and combined output. */
function run(
  command: string,
  args: string[],
  cwd: string,
  signal?: AbortSignal
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, signal, stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    child.stdout.on("data", (chunk) => (output += chunk))
    child.stderr.on("data", (chunk) => (output += chunk))
    child.on("error", reject)
    child.on("close", (code) => resolveRun({ code, output }))
  })
}

/**
 * Reads a surface's title, description, and tools by bundling the file for Node and importing
 * it. The kit is safe to import outside the browser; components are defined but never rendered.
 */
async function loadSurface(name: string): Promise<LoadedSurface> {
  if (!NAME_PATTERN.test(name)) throw new Error(`Invalid surface name: ${name}`)
  const file = join(SURFACES_DIR, `${name}.tsx`)
  const { mtimeMs } = await stat(file).catch(() => {
    throw new Error(`No surface named "${name}": ${file} does not exist.`)
  })
  const cached = loaded.get(name)
  if (cached?.mtimeMs === mtimeMs) return cached.surface
  const outfile = join(SURFACES_DIR, ".cache", `${name}.mjs`)
  await build({
    entryPoints: [file],
    outfile,
    alias: { "@surfaces/kit": KIT_PATH },
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    jsx: "automatic",
    logLevel: "silent",
  })
  const module: { default?: unknown } = await import(`${pathToFileURL(outfile).href}?v=${mtimeMs}`)
  if (!Value.Check(SurfaceInfo, module.default)) {
    const [error] = Value.Errors(SurfaceInfo, module.default)
    const where = `${error?.instancePath || "/"} ${error?.message ?? ""}`
    throw new Error(
      `${file} must default-export surface.pages(...) from defineSurface({ title, description, tools }): ${where}`
    )
  }
  const { title, description, tools } = module.default
  const surface = { name, file, info: { title, description, tools } }
  loaded.set(name, { mtimeMs, surface })
  return surface
}

async function listSurfaceNames(): Promise<string[]> {
  const entries = await readdir(SURFACES_DIR, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
    .map((entry) => entry.name.slice(0, -".tsx".length))
    .filter((name) => NAME_PATTERN.test(name))
    .sort()
}

/** Bundles the surface with the kit and React into one browser module. */
async function bundleSurface(surface: LoadedSurface): Promise<string> {
  const entry = [
    `import surface from ${JSON.stringify(`./${surface.name}.tsx`)}`,
    `import { mount } from "@surfaces/kit"`,
    `mount(surface)`,
  ].join("\n")
  const result = await build({
    stdin: { contents: entry, resolveDir: SURFACES_DIR, loader: "tsx", sourcefile: "entry.tsx" },
    alias: { "@surfaces/kit": KIT_PATH },
    bundle: true,
    write: false,
    format: "esm",
    target: "es2023",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    minify: true,
    sourcemap: "inline",
    logLevel: "silent",
  })
  return result.outputFiles[0]?.text ?? ""
}

/** Typechecks every surface and returns the errors that belong to this one or to the kit. */
async function typecheckSurface(name: string, signal?: AbortSignal): Promise<string[]> {
  const { output } = await run(
    TSC_PATH,
    ["--noEmit", "--pretty", "false", "-p", "tsconfig.json"],
    SURFACES_DIR,
    signal
  )
  return output
    .split("\n")
    .filter(
      (line) => line.startsWith(`${name}.tsx`) || line.includes("extensions/surfaces/runtime")
    )
}

function missingToolsError(
  tools: readonly string[],
  known: readonly ToolInfo[]
): string | undefined {
  const names = new Set(known.map((tool) => tool.name))
  const missing = tools.filter((name) => !names.has(name))
  if (missing.length === 0) return undefined
  const servers = new Set(missing.map((name) => name.split("__").slice(0, 2).join("__") + "__"))
  const available = known
    .map((tool) => tool.name)
    .filter((name) => [...servers].some((prefix) => name.startsWith(prefix)))
  return [
    `Unknown tools: ${missing.join(", ")}.`,
    available.length > 0
      ? `Tools of the same servers: ${available.join(", ")}`
      : "Their MCP servers are not connected; check /mcp.",
  ].join("\n")
}

/** Waits until the tools are registered; MCP servers connect in the background after startup. */
async function waitForTools(pi: ExtensionAPI, tools: readonly string[]): Promise<void> {
  const deadline = Date.now() + 20_000
  while (missingToolsError(tools, pi.getAllTools()) && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  const missing = missingToolsError(tools, pi.getAllTools())
  if (missing !== undefined) throw new Error(missing)
}

async function confirmWrite(name: string, tool: string, args: string): Promise<boolean> {
  if (trustedWriters.has(name)) return true
  if (bridge === undefined || !bridge.hasUI) return false
  const shownArgs = args.length > 600 ? `${args.slice(0, 600)}…` : args
  const choice = await bridge.ui.select(`Surface "${name}" wants to call ${tool}\n${shownArgs}`, [
    ALLOW_ONCE,
    ALLOW_SURFACE,
    DENY,
  ])
  if (choice === ALLOW_SURFACE) trustedWriters.add(name)
  return choice === ALLOW_ONCE || choice === ALLOW_SURFACE
}

function formatAsk(surface: LoadedSurface, body: Static<typeof AskRequest>): string {
  const lines = [
    `The surface "${surface.name}" (${surface.file}) hit a problem and asks for your help.`,
  ]
  if (body.problem !== undefined && body.tool !== undefined) {
    const result = JSON.stringify(body.result, null, 2)
    lines.push(
      `It could not parse the result of ${body.tool}:\n${body.problem}`,
      `Arguments:\n\`\`\`json\n${JSON.stringify(body.args, null, 2)}\n\`\`\``,
      `Result:\n\`\`\`json\n${result.length > 20_000 ? `${result.slice(0, 20_000)}\n…truncated` : result}\n\`\`\``,
      "Explain what the result means, and offer to fix the surface's parser."
    )
  } else {
    lines.push(
      `Error:\n\`\`\`\n${body.message ?? "Unknown error"}\n\`\`\``,
      "Diagnose it and offer a fix."
    )
  }
  return lines.join("\n\n")
}

function htmlPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    ${TOKEN_SCRIPT}
    <script src="/_/tailwind.js"></script>
    <style type="text/tailwindcss">${THEME}</style>
  </head>
  <body class="bg-background font-sans text-sm text-foreground antialiased">
    ${body}
  </body>
</html>`
}

async function homePage(): Promise<string> {
  const rows = await Promise.all(
    (await listSurfaceNames()).map(async (name) => {
      const surface = await loadSurface(name).catch((error: Error) => error)
      const detail =
        surface instanceof Error
          ? `<span class="text-destructive">${escapeHtml(surface.message)}</span>`
          : `<span class="font-medium">${escapeHtml(surface.info.title)}</span>
             <span class="text-muted-foreground">${escapeHtml(surface.info.description)}</span>`
      return `<a href="/${name}/" class="flex flex-col gap-0.5 p-3 hover:bg-muted">
        <span class="font-mono text-xs text-muted-foreground">${name}</span>${detail}</a>`
    })
  )
  const list =
    rows.length === 0
      ? `<p class="text-muted-foreground">No surfaces yet. Ask Pi to build one.</p>`
      : `<div class="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">${rows.join("")}</div>`
  return htmlPage(
    "Surfaces",
    `<main class="mx-auto flex max-w-2xl flex-col gap-4 p-8">
      <h1 class="text-xl font-semibold tracking-tight">Surfaces</h1>${list}</main>`
  )
}

/** Module that shows a build failure in the page instead of the surface. */
function buildErrorModule(message: string): string {
  return `const pre = document.createElement("pre")
pre.style.cssText = "margin:20px;padding:12px;white-space:pre-wrap;color:#dc2626;font:12px ui-monospace,monospace"
pre.textContent = ${JSON.stringify(`The surface failed to build:\n\n${message}`)}
document.getElementById("root").replaceWith(pre)`
}

function createBridgeApp(pi: ExtensionAPI): Hono {
  const app = new Hono()

  // Reject DNS-rebinding hosts and cross-origin callers before routing.
  app.use(async (context, next) => {
    if (context.req.header("host") !== `127.0.0.1:${serverPort}`) {
      return context.text("Forbidden", 403)
    }
    const origin = context.req.header("origin")
    if (origin !== undefined && origin !== `http://127.0.0.1:${serverPort}`) {
      return context.text("Forbidden", 403)
    }
    return next()
  })

  app.use("/_/api/*", bodyLimit({ maxSize: 2 * 1024 * 1024 }))
  app.use("/_/api/*", async (context, next) => {
    if (context.req.header("authorization") !== `Bearer ${token}`) {
      return context.json({ error: "Missing or invalid token. Reopen the surface from Pi." }, 401)
    }
    return next()
  })

  app.get("/_/tailwind.js", async () => {
    const script = await readFile(TAILWIND_PATH)
    return new Response(script, { headers: { "content-type": "text/javascript; charset=utf-8" } })
  })

  app.get("/_/app/:file", async (context) => {
    const name = context.req.param("file").replace(/\.js$/, "")
    const code = await loadSurface(name)
      .then(bundleSurface)
      .catch((error: Error) => buildErrorModule(error.message))
    return new Response(code, {
      headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" },
    })
  })

  app.post("/_/api/:name/call", async (context) => {
    const surface = await loadSurface(context.req.param("name"))
    const body: unknown = await context.req.json()
    if (!Value.Check(CallRequest, body)) {
      return context.json({ error: "Expected { tool, args }" }, 400)
    }
    if (!surface.info.tools.includes(body.tool)) {
      return context.json({ error: `${body.tool} is not in the surface's tools` }, 403)
    }
    if (bridge === undefined) {
      return context.json(
        { error: "Pi is not serving surfaces. Ask Pi to open this surface." },
        503
      )
    }
    const info = pi.getAllTools().find((tool) => tool.name === body.tool)
    if (info === undefined) {
      return context.json({ error: `${body.tool} is not available; check /mcp in Pi.` }, 503)
    }
    if (info.annotations?.readOnlyHint !== true) {
      const allowed = await confirmWrite(surface.name, body.tool, JSON.stringify(body.args))
      if (!allowed) return context.json({ error: "The call was denied in Pi." }, 403)
    }
    const outcome = await bridge.executeTool(body.tool, body.args, {
      signal: context.req.raw.signal,
    })
    // MCP tools return the server's complete CallToolResult as structuredContent. Failures that
    // never reached the server (blocked, invalid arguments, disconnected) only carry content.
    return Response.json(
      outcome.result.structuredContent ?? { content: outcome.result.content, isError: true }
    )
  })

  app.post("/_/api/:name/samples", async (context) => {
    const surface = await loadSurface(context.req.param("name"))
    const body: unknown = await context.req.json()
    if (!Value.Check(SampleRequest, body)) {
      return context.json({ error: "Expected { tool, args, result, problem }" }, 400)
    }
    if (!surface.info.tools.includes(body.tool)) {
      return context.json({ error: `${body.tool} is not in the surface's tools` }, 403)
    }
    const samples = join(SURFACES_DIR, ".samples", surface.name)
    await mkdir(samples, { recursive: true })
    const file = join(samples, `${body.tool}.jsonl`)
    await appendFile(file, `${JSON.stringify({ at: new Date().toISOString(), ...body })}\n`)
    return context.json({ saved: relative(SURFACES_DIR, file) })
  })

  app.post("/_/api/:name/ask", async (context) => {
    const surface = await loadSurface(context.req.param("name"))
    const body: unknown = await context.req.json()
    if (!Value.Check(AskRequest, body)) return context.json({ error: "Invalid request" }, 400)
    pi.sendUserMessage(formatAsk(surface, body), { deliverAs: "followUp" })
    return context.json({ sent: true })
  })

  app.get("/", async (context) => context.html(await homePage()))

  // Every other path is a page of a surface: /<name>/<page path>.
  app.get("*", async (context) => {
    const name = context.req.path.split("/")[1] ?? ""
    const surface = await loadSurface(name).catch(() => undefined)
    if (surface === undefined) return context.notFound()
    const script = `<script type="module" src="/_/app/${name}.js"></script>`
    return context.html(htmlPage(surface.info.title, `<div id="root"></div>${script}`))
  })

  app.notFound((context) => context.text("Not Found", 404))
  app.onError((error, context) => {
    console.error("Surfaces bridge request failed", error)
    return context.json({ error: error.message }, 500)
  })

  return app
}

function startServer(pi: ExtensionAPI): Promise<number> {
  if (serverPort !== undefined) return Promise.resolve(serverPort)
  if (serverStart !== undefined) return serverStart

  token = randomBytes(24).toString("base64url")
  const app = createBridgeApp(pi)
  serverStart = new Promise((resolvePort, reject) => {
    const httpServer = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (address) => {
      httpServer.off("error", fail)
      serverPort = address.port
      resolvePort(address.port)
    })
    const fail = (error: Error) => {
      server = undefined
      serverPort = undefined
      serverStart = undefined
      reject(error)
    }
    server = httpServer
    httpServer.once("error", fail)
  })
  return serverStart
}

function stopServer(): Promise<void> {
  const current = server
  server = undefined
  serverPort = undefined
  serverStart = undefined
  bridge = undefined
  browserOpened = false
  trustedWriters.clear()
  if (current === undefined) return Promise.resolve()
  return new Promise((resolveStop) => current.close(() => resolveStop()))
}

/** URL of a surface, or of the surfaces list when `name` is empty. */
function surfaceUrl(port: number, name: string): string {
  return `http://127.0.0.1:${port}/${name ? `${name}/` : ""}#token=${token}`
}

function openBrowser(url: string): void {
  browserOpened = true
  spawn("open", [url], { detached: true, stdio: "ignore" }).unref()
}

/** Serves agent-built React surfaces whose tool calls run through this session's MCP tools. */
export default function piSurfaces(pi: ExtensionAPI): void {
  pi.on("session_shutdown", stopServer)
  pi.on("resources_discover", () => ({ skillPaths: [SKILL_PATH] }))

  pi.registerTool({
    name: "surface_open",
    label: "Open surface",
    description: `Typecheck, bundle, and serve the surface ${SURFACES_DIR}/<name>.tsx at a local URL connected to this session's MCP tools. Call after every change to a surface; the browser opens the first time and otherwise only needs a refresh.`,
    promptGuidelines: ["Load the pi-surfaces skill before creating or changing a surface."],
    parameters: Type.Object({
      name: Type.String({ pattern: NAME_PATTERN.source, description: "File name without .tsx" }),
      open: Type.Optional(
        Type.Boolean({ description: "Open the browser (default: only the first time)" })
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const surface = await loadSurface(params.name)
      const typeErrors = await typecheckSurface(surface.name, signal)
      if (typeErrors.length > 0) throw new Error(`Type errors:\n${typeErrors.join("\n")}`)
      await bundleSurface(surface)
      await waitForTools(pi, surface.info.tools)
      bridge = ctx
      const port = await startServer(pi)
      const url = surfaceUrl(port, surface.name)
      if (params.open ?? !browserOpened) openBrowser(url)
      return {
        content: [{ type: "text", text: `Serving ${surface.info.title} at ${url}` }],
        details: { name: surface.name, url, file: surface.file, tools: surface.info.tools },
      }
    },
  })

  pi.registerCommand("surfaces", {
    description: "Open the list of surfaces in the browser",
    handler: async (_args, ctx) => {
      if (serverPort === undefined || bridge === undefined) {
        const names = await listSurfaceNames()
        const list = names.length > 0 ? names.join(", ") : "none yet"
        ctx.ui.notify(`Surfaces: ${list}. Ask Pi to open one to start the server.`, "info")
        return
      }
      openBrowser(surfaceUrl(serverPort, ""))
    },
  })
}
