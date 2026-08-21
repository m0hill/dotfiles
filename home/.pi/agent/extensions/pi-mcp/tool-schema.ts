import type { Tool } from "@modelcontextprotocol/client"
import { JSONArraySchema, JSONObjectSchema, JSONValueSchema } from "@modelcontextprotocol/core"
import { z } from "zod"

type JSONObject = z.infer<typeof JSONObjectSchema>
type JSONValue = z.infer<typeof JSONValueSchema>

const StringSchema = z.string()
const BooleanSchema = z.boolean()
const StringArraySchema = z.array(z.string())
const SchemaType = z.enum(["null", "boolean", "number", "integer", "string", "array", "object"])
const SchemaTypeList = z.array(SchemaType)
const COMPOSITION_KEYS = ["anyOf", "oneOf", "allOf"] as const
const DEFINITION_KEYS = ["$defs", "definitions"] as const

/** Converts an MCP input schema into the conservative object schema Pi expects for tools. */
export function normalizeToolSchema(inputSchema: Tool["inputSchema"]): JSONObject {
  const schema = structuredClone(inputSchema)
  const properties = JSONObjectSchema.safeParse(schema.properties)
  return sanitizeJsonSchema({
    ...schema,
    type: "object",
    properties: properties.success ? properties.data : {},
    additionalProperties: false,
  })
}

/** Sanitizes JSON Schema fragments into the subset accepted by Pi's TypeBox bridge. */
export function sanitizeJsonSchema(value: JSONValue): JSONObject {
  if (BooleanSchema.safeParse(value).success) return { type: "string" }
  if (JSONArraySchema.safeParse(value).success) return {}

  const object = JSONObjectSchema.safeParse(value)
  if (!object.success) return {}
  const schema = object.data
  const result: JSONObject = {}

  assignParsedProperty(result, "$ref", schema.$ref, StringSchema)
  assignParsedProperty(result, "description", schema.description, StringSchema)
  if ("const" in schema) result.enum = [schema.const]
  else {
    const enumValues = JSONArraySchema.safeParse(schema.enum)
    if (enumValues.success) result.enum = enumValues.data
  }

  const properties = JSONObjectSchema.safeParse(schema.properties)
  if (properties.success) {
    result.properties = Object.fromEntries(
      Object.entries(properties.data).map(([key, item]) => [key, sanitizeJsonSchema(item)])
    )
  }

  assignParsedProperty(result, "required", schema.required, StringArraySchema)
  if ("items" in schema) result.items = sanitizeJsonSchema(schema.items)

  if ("additionalProperties" in schema) {
    const additionalProperties = BooleanSchema.safeParse(schema.additionalProperties)
    result.additionalProperties = additionalProperties.success
      ? additionalProperties.data
      : sanitizeJsonSchema(schema.additionalProperties)
  }

  for (const key of COMPOSITION_KEYS) {
    const variants = JSONArraySchema.safeParse(schema[key])
    if (variants.success) result[key] = variants.data.map(sanitizeJsonSchema)
  }

  for (const key of DEFINITION_KEYS) {
    const definitions = JSONObjectSchema.safeParse(schema[key])
    if (definitions.success) {
      result[key] = Object.fromEntries(
        Object.entries(definitions.data).map(([name, item]) => [name, sanitizeJsonSchema(item)])
      )
    }
  }

  const schemaTypes = parseSchemaTypes(schema.type)
  if (
    schemaTypes.length === 0 &&
    (StringSchema.safeParse(result.$ref).success || hasComposition(result))
  ) {
    return result
  }

  const inferredTypes = schemaTypes.length > 0 ? schemaTypes : inferSchemaTypes(schema, result)
  if (inferredTypes.length === 0) return {}

  if (inferredTypes.length === 1) {
    const [schemaType] = inferredTypes
    if (schemaType !== undefined) result.type = schemaType
  } else {
    result.type = inferredTypes
  }
  if (inferredTypes.includes("object") && !("properties" in result)) result.properties = {}
  if (inferredTypes.includes("array") && !("items" in result)) result.items = { type: "string" }
  return result
}

function assignParsedProperty<Schema extends z.ZodType<JSONValue>>(
  target: JSONObject,
  key: string,
  value: JSONValue | undefined,
  schema: Schema
) {
  const parsed = schema.safeParse(value)
  if (parsed.success) target[key] = parsed.data
}

function parseSchemaTypes(value: JSONValue | undefined) {
  const single = SchemaType.safeParse(value)
  if (single.success) return [single.data]
  const multiple = SchemaTypeList.safeParse(value)
  return multiple.success ? multiple.data : []
}

function hasComposition(schema: JSONObject) {
  return COMPOSITION_KEYS.some((key) => key in schema)
}

function inferSchemaTypes(schema: JSONObject, result: JSONObject) {
  if (["properties", "required", "additionalProperties"].some((key) => key in schema)) {
    return ["object"]
  }
  if (["items", "prefixItems"].some((key) => key in schema)) return ["array"]
  if ("enum" in result || "format" in schema) return ["string"]
  if (
    ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"].some(
      (key) => key in schema
    )
  ) {
    return ["number"]
  }
  return []
}
