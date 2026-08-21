import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { JSONObjectSchema, JSONValueSchema } from "@modelcontextprotocol/core"
import { parse as parseJsonc, type ParseError } from "jsonc-parser"
import { z } from "zod"
import { expandEnv, resolveHome } from "./config-values.js"
import type {
  McpConfig,
  McpServerConfig,
  McpStartupMode,
  McpToolMode,
  OAuthConfig,
} from "./types.js"

interface LoadOptions {
  cwd: string
}

type ConfigObject = z.infer<typeof JSONObjectSchema>
type JSONValue = z.infer<typeof JSONValueSchema>
type ServerEntryMode = "strict" | "discover"
type OAuthStringField =
  | "clientId"
  | "clientSecret"
  | "scope"
  | "redirectUri"
  | "clientName"
  | "clientUri"

const PositiveIntegerSchema = z.int().positive()
const ToolModeSchema = z.enum(["direct", "proxy"])
const StartupModeSchema = z.enum(["eager", "lazy"])
const StringRecordSchema = z.record(z.string(), z.string())
const CommandSchema = z.array(z.string().min(1)).min(1)
const OAuthSchema = z.object({
  clientId: z.string().optional(),
  client_id: z.string().optional(),
  clientSecret: z.string().optional(),
  client_secret: z.string().optional(),
  scope: z.string().optional(),
  callbackPort: PositiveIntegerSchema.optional(),
  callback_port: PositiveIntegerSchema.optional(),
  redirectUri: z.string().optional(),
  redirect_uri: z.string().optional(),
  clientName: z.string().optional(),
  client_name: z.string().optional(),
  clientUri: z.string().optional(),
  client_uri: z.string().optional(),
})
const LocalServerSchema = z.object({
  type: z.literal("local"),
  command: CommandSchema,
  cwd: z.string().min(1).optional(),
  environment: StringRecordSchema.optional(),
  enabled: z.boolean().optional(),
  disabled: z.boolean().optional(),
  timeout: PositiveIntegerSchema.optional(),
})
const RemoteServerSchema = z.object({
  type: z.literal("remote"),
  url: z.string().min(1),
  headers: StringRecordSchema.optional(),
  oauth: z.union([OAuthSchema, z.literal(false)]).optional(),
  enabled: z.boolean().optional(),
  disabled: z.boolean().optional(),
  timeout: PositiveIntegerSchema.optional(),
})
const ServerSchema = z.discriminatedUnion("type", [LocalServerSchema, RemoteServerSchema])

/** Loads the first Pi MCP configuration available for a Pi session. */
export async function loadMcpConfig(options: LoadOptions): Promise<McpConfig> {
  const envConfig = process.env.PI_MCP_CONFIG
  if (envConfig) {
    const expanded = resolveHome(expandEnv(envConfig, "PI_MCP_CONFIG"))
    if (existsSync(expanded)) return parseConfig(await readFile(expanded, "utf8"), expanded)
    return parseConfig(envConfig, "PI_MCP_CONFIG")
  }

  for (const file of candidateConfigFiles(options.cwd)) {
    if (!existsSync(file)) continue
    const parsed = parseConfig(await readFile(file, "utf8"), file)
    if (hasConfigContent(parsed)) return parsed
  }

  return { servers: {} }
}

function candidateConfigFiles(cwd: string) {
  return [
    path.join(cwd, ".pi", "mcp.json"),
    path.join(cwd, ".pi", "mcp.jsonc"),
    path.join(homedir(), ".pi", "agent", "mcp.json"),
    path.join(homedir(), ".pi", "agent", "mcp.jsonc"),
  ]
}

function parseConfig(text: string, source: string): McpConfig {
  const errors: ParseError[] = []
  const decoded = parseJsonc(text, errors, { allowTrailingComma: true })
  if (errors.length > 0) throw new Error(`Invalid MCP config JSONC in ${source}`)

  const parsed = JSONObjectSchema.safeParse(decoded)
  if (!parsed.success) return { servers: {}, source }

  if ("mcp" in parsed.data) {
    const section = JSONObjectSchema.safeParse(parsed.data.mcp)
    if (!section.success) {
      throw new Error(`Invalid MCP config in ${source}: mcp must be an object`)
    }
    return parseMcpSection(section.data, source, "mcp", "strict")
  }

  if (looksLikeFlatMcpSection(parsed.data)) {
    return parseMcpSection(parsed.data, source, "mcp", "discover")
  }

  return { servers: {}, source }
}

function parseMcpSection(
  section: ConfigObject,
  source: string,
  pathLabel: string,
  entryMode: ServerEntryMode
): McpConfig {
  const servers: Record<string, McpServerConfig> = {}
  const timeout = parseOptional(
    section.timeout,
    PositiveIntegerSchema,
    `${pathLabel}.timeout`,
    source
  )
  const toolMode = parseToolMode(section, pathLabel, source)
  const startup = parseOptional(section.startup, StartupModeSchema, `${pathLabel}.startup`, source)

  if ("servers" in section) {
    const serverEntries = JSONObjectSchema.safeParse(section.servers)
    if (!serverEntries.success) {
      throw new Error(`Invalid MCP config in ${source}: ${pathLabel}.servers must be an object`)
    }
    for (const [name, raw] of Object.entries(serverEntries.data)) {
      servers[name] = parseServer(raw, timeout, `${pathLabel}.servers.${name}`, source)
    }
    return makeConfig(source, servers, timeout, toolMode, startup)
  }

  for (const [name, raw] of Object.entries(section)) {
    if (["timeout", "toolMode", "mode", "proxy", "startup"].includes(name)) continue
    if (entryMode === "discover" && !looksLikeServerEntry(raw)) continue
    servers[name] = parseServer(raw, timeout, `${pathLabel}.${name}`, source)
  }

  return makeConfig(source, servers, timeout, toolMode, startup)
}

function parseToolMode(
  section: ConfigObject,
  pathLabel: string,
  source: string
): McpToolMode | undefined {
  const rawMode = section.toolMode ?? section.mode
  if (rawMode !== undefined) {
    return parseRequired(rawMode, ToolModeSchema, `${pathLabel}.toolMode`, source)
  }
  if (section.proxy === undefined) return undefined
  const proxy = parseRequired(section.proxy, z.boolean(), `${pathLabel}.proxy`, source)
  return proxy ? "proxy" : "direct"
}

function parseServer(
  value: JSONValue,
  defaultTimeout: number | undefined,
  pathLabel: string,
  source: string
): McpServerConfig {
  const parsed = ServerSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`Invalid MCP config in ${source}: ${pathLabel} is not a valid server entry`)
  }

  const timeout = parsed.data.timeout ?? defaultTimeout
  if (parsed.data.type === "local") {
    let server: McpServerConfig = {
      type: "local",
      command: parsed.data.command.map((item) => expandEnv(item, `${source} ${pathLabel}.command`)),
    }
    if (parsed.data.cwd !== undefined) {
      server = {
        ...server,
        cwd: expandEnv(parsed.data.cwd, `${source} ${pathLabel}.cwd`),
      }
    }
    if (parsed.data.environment !== undefined) {
      server = {
        ...server,
        environment: expandStringRecord(
          parsed.data.environment,
          source,
          `${pathLabel}.environment`
        ),
      }
    }
    return withServerOptions(server, parsed.data.enabled, parsed.data.disabled, timeout)
  }

  let server: McpServerConfig = {
    type: "remote",
    url: expandEnv(parsed.data.url, `${source} ${pathLabel}.url`),
  }
  if (parsed.data.headers !== undefined) {
    server = {
      ...server,
      headers: expandStringRecord(parsed.data.headers, source, `${pathLabel}.headers`),
    }
  }
  if (parsed.data.oauth !== undefined) {
    server = {
      ...server,
      oauth:
        parsed.data.oauth === false ? false : makeOAuthConfig(parsed.data.oauth, source, pathLabel),
    }
  }
  return withServerOptions(server, parsed.data.enabled, parsed.data.disabled, timeout)
}

function expandStringRecord(values: Record<string, string>, source: string, pathLabel: string) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      expandEnv(value, `${source} ${pathLabel}.${key}`),
    ])
  )
}

function makeOAuthConfig(value: z.infer<typeof OAuthSchema>, source: string, pathLabel: string) {
  let oauth: OAuthConfig = {}
  const clientId = expandOptional(value.clientId ?? value.client_id, "clientId", source, pathLabel)
  if (clientId !== undefined) oauth = { ...oauth, clientId }
  const clientSecret = expandOptional(
    value.clientSecret ?? value.client_secret,
    "clientSecret",
    source,
    pathLabel
  )
  if (clientSecret !== undefined) oauth = { ...oauth, clientSecret }
  const scope = expandOptional(value.scope, "scope", source, pathLabel)
  if (scope !== undefined) oauth = { ...oauth, scope }
  const callbackPort = value.callbackPort ?? value.callback_port
  if (callbackPort !== undefined) oauth = { ...oauth, callbackPort }
  const redirectUri = expandOptional(
    value.redirectUri ?? value.redirect_uri,
    "redirectUri",
    source,
    pathLabel
  )
  if (redirectUri !== undefined) oauth = { ...oauth, redirectUri }
  const clientName = expandOptional(
    value.clientName ?? value.client_name,
    "clientName",
    source,
    pathLabel
  )
  if (clientName !== undefined) oauth = { ...oauth, clientName }
  const clientUri = expandOptional(
    value.clientUri ?? value.client_uri,
    "clientUri",
    source,
    pathLabel
  )
  if (clientUri !== undefined) oauth = { ...oauth, clientUri }
  return oauth
}

function expandOptional(
  value: string | undefined,
  key: OAuthStringField,
  source: string,
  pathLabel: string
) {
  return value === undefined ? undefined : expandEnv(value, `${source} ${pathLabel}.${key}`)
}

function withServerOptions(
  server: McpServerConfig,
  enabled: boolean | undefined,
  disabled: boolean | undefined,
  timeout: number | undefined
) {
  let configured = server
  if (enabled !== undefined) configured = { ...configured, enabled }
  if (disabled !== undefined) configured = { ...configured, disabled }
  if (timeout !== undefined) configured = { ...configured, timeout }
  return configured
}

function parseOptional<Schema extends z.ZodType>(
  value: JSONValue | undefined,
  schema: Schema,
  pathLabel: string,
  source: string
): z.output<Schema> | undefined {
  if (value === undefined) return undefined
  return parseRequired(value, schema, pathLabel, source)
}

function parseRequired<Schema extends z.ZodType>(
  value: JSONValue,
  schema: Schema,
  pathLabel: string,
  source: string
): z.output<Schema> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new Error(`Invalid MCP config in ${source}: ${pathLabel}`)
  return parsed.data
}

function makeConfig(
  source: string,
  servers: Record<string, McpServerConfig>,
  timeout: number | undefined,
  toolMode: McpToolMode | undefined,
  startup: McpStartupMode | undefined
): McpConfig {
  let config: McpConfig = { servers, source }
  if (timeout !== undefined) config = { ...config, timeout }
  if (toolMode !== undefined) config = { ...config, toolMode }
  if (startup !== undefined) config = { ...config, startup }
  return config
}

function hasConfigContent(config: McpConfig) {
  return (
    Object.keys(config.servers).length > 0 ||
    config.timeout !== undefined ||
    config.toolMode !== undefined ||
    config.startup !== undefined
  )
}

function looksLikeFlatMcpSection(section: ConfigObject) {
  if ("timeout" in section || "servers" in section) return true
  return Object.values(section).some(looksLikeServerEntry)
}

function looksLikeServerEntry(value: JSONValue) {
  const entry = JSONObjectSchema.safeParse(value)
  return entry.success && "type" in entry.data
}
