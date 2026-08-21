import type { ElicitRequest, ElicitResult } from "@modelcontextprotocol/client"
import {
  ElicitRequestFormParamsSchema,
  ElicitResultSchema,
  JSONObjectSchema,
  JSONValueSchema,
  PrimitiveSchemaDefinitionSchema,
} from "@modelcontextprotocol/core"
import type { ExtensionContext } from "@earendil-works/pi-coding-agent"
import open from "open"
import { z } from "zod"

type PiElicitationContext = Pick<ExtensionContext, "hasUI" | "ui">
type ElicitationContent = NonNullable<ElicitResult["content"]>
type FormElicitationParams = z.infer<typeof ElicitRequestFormParamsSchema>
type PrimitiveSchema = z.infer<typeof PrimitiveSchemaDefinitionSchema>

const StringSchema = z.string()
const NumberSchema = z.number().finite()
const StringArraySchema = z.array(z.string())
const StringConstVariantsSchema = z.array(
  z.object({ const: z.string(), title: z.string().optional() })
)

const CANCEL = Symbol("cancel")

/** Handles MCP elicitation requests using Pi UI primitives or deterministic environment input. */
export async function handlePiElicitation(
  server: string,
  request: ElicitRequest,
  ctx: PiElicitationContext | undefined
): Promise<ElicitResult> {
  const envResponse = responseFromEnv()
  if (envResponse) return envResponse

  if (isUrlElicitation(request.params)) return handleUrlElicitation(server, request.params, ctx)
  if (isFormElicitation(request.params)) return handleFormElicitation(server, request.params, ctx)
  return { action: "decline" }
}

async function handleUrlElicitation(
  server: string,
  params: Extract<ElicitRequest["params"], { mode: "url" }>,
  ctx: PiElicitationContext | undefined
): Promise<ElicitResult> {
  if (!ctx?.hasUI) return { action: "decline" }

  const ok = await ctx.ui.confirm(`MCP ${server} URL request`, `${params.message}\n\n${params.url}`)
  if (!ok) return { action: "decline" }

  try {
    await open(params.url)
    return { action: "accept" }
  } catch (error) {
    ctx.ui.notify(
      `Could not open MCP URL: ${error instanceof Error ? error.message : String(error)}`,
      "error"
    )
    return { action: "decline" }
  }
}

async function handleFormElicitation(
  server: string,
  params: FormElicitationParams,
  ctx: PiElicitationContext | undefined
): Promise<ElicitResult> {
  if (!ctx?.hasUI) return { action: "decline" }

  ctx.ui.notify(`MCP ${server}: ${params.message}`, "info")
  const required = new Set(params.requestedSchema.required ?? [])
  const content: ElicitationContent = {}

  for (const [name, schema] of Object.entries(params.requestedSchema.properties)) {
    const value = await askForField(ctx, name, schema, required.has(name))
    if (value === CANCEL) return { action: "cancel" }
    if (value !== undefined) content[name] = value
  }

  return { action: "accept", content }
}

async function askForField(
  ctx: PiElicitationContext,
  name: string,
  schema: PrimitiveSchema,
  required: boolean
): Promise<ElicitationContent[string] | typeof CANCEL | undefined> {
  const title = fieldTitle(name, schema, required)
  const description = stringProperty(schema, "description") ?? ""
  const defaultValue = schema.default

  const enumValues = stringEnumValues(schema)
  if (enumValues.length > 0) {
    const selected = await ctx.ui.select(title, enumValues)
    return selected ?? (required ? CANCEL : undefined)
  }

  if (schema.type === "boolean") {
    return ctx.ui.confirm(title, description)
  }

  if (schema.type === "number" || schema.type === "integer") {
    const input = await ctx.ui.input(
      title,
      NumberSchema.safeParse(defaultValue).success ? String(defaultValue) : description
    )
    if (input === undefined) return CANCEL
    if (!input.trim()) {
      const parsedDefault = NumberSchema.safeParse(defaultValue)
      if (parsedDefault.success) return parsedDefault.data
      return required ? CANCEL : undefined
    }
    const value = Number(input)
    if (!Number.isFinite(value) || (schema.type === "integer" && !Number.isInteger(value))) {
      ctx.ui.notify(`${title} must be a ${schema.type}.`, "error")
      return CANCEL
    }
    return value
  }

  if (schema.type === "array") {
    const input = await ctx.ui.input(
      title,
      Array.isArray(defaultValue) ? defaultValue.join(", ") : arrayPlaceholder(schema, description)
    )
    if (input === undefined) return CANCEL
    if (!input.trim()) {
      const parsedDefault = StringArraySchema.safeParse(defaultValue)
      if (parsedDefault.success) return parsedDefault.data
      return required ? CANCEL : undefined
    }
    return input
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  }

  const input = await ctx.ui.input(
    title,
    StringSchema.safeParse(defaultValue).success ? String(defaultValue) : description
  )
  if (input === undefined) return CANCEL
  const parsedDefault = StringSchema.safeParse(defaultValue)
  if (!input && parsedDefault.success) return parsedDefault.data
  if (!input && !required) return undefined
  return input
}

function responseFromEnv(): ElicitResult | undefined {
  const raw = process.env.PI_MCP_ELICITATION_RESPONSE?.trim()
  if (!raw) return undefined
  if (raw === "accept" || raw === "decline" || raw === "cancel") return { action: raw }

  const parsed = JSONValueSchema.parse(JSON.parse(raw))
  const parsedObject = JSONObjectSchema.safeParse(parsed)
  const hasAction = parsedObject.success && StringSchema.safeParse(parsedObject.data.action).success
  const result = hasAction ? parsedObject.data : { action: "accept", content: parsed }
  const elicitation = ElicitResultSchema.safeParse(result)
  if (elicitation.success) return elicitation.data
  throw new Error(
    "PI_MCP_ELICITATION_RESPONSE must be an elicitation result object or content object"
  )
}

function isUrlElicitation(
  params: ElicitRequest["params"]
): params is Extract<ElicitRequest["params"], { mode: "url" }> {
  return params.mode === "url"
}

function isFormElicitation(params: ElicitRequest["params"]): params is FormElicitationParams {
  return "requestedSchema" in params
}

function fieldTitle(name: string, schema: PrimitiveSchema, required: boolean) {
  const title = stringProperty(schema, "title") ?? name
  return required ? `${title} (required)` : title
}

function stringProperty(schema: PrimitiveSchema, key: string) {
  const value = JSONObjectSchema.parse(schema)[key]
  const parsed = StringSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

function stringEnumValues(schema: PrimitiveSchema) {
  const properties = JSONObjectSchema.parse(schema)
  const enumValues = StringArraySchema.safeParse(properties.enum)
  if (enumValues.success) return enumValues.data
  const variants = StringConstVariantsSchema.safeParse(properties.oneOf)
  return variants.success ? variants.data.map((item) => item.const) : []
}

function arrayPlaceholder(schema: PrimitiveSchema, fallback: string) {
  const items = PrimitiveSchemaDefinitionSchema.safeParse(JSONObjectSchema.parse(schema).items)
  if (!items.success) return fallback
  const values = stringEnumValues(items.data)
  return values.length > 0 ? `Comma-separated: ${values.join(", ")}` : fallback
}
