import { JSONObjectSchema } from "@modelcontextprotocol/core"
import { z } from "zod"

/** Parsed JSON object accepted as MCP tool arguments. */
export type ToolArguments = z.infer<typeof JSONObjectSchema>

const ExternalToolArgumentsSchema = z.unknown().pipe(JSONObjectSchema)

/** Parses an external value into MCP tool arguments. */
export function parseToolArguments(
  value: z.input<typeof ExternalToolArgumentsSchema>
): ToolArguments {
  const parsed = ExternalToolArgumentsSchema.safeParse(value)
  return parsed.success ? parsed.data : {}
}

/** Reads an optional non-empty string argument from parsed tool arguments. */
export function optionalString(args: ToolArguments, key: string) {
  const value = args[key]
  if (value === undefined || value === null || value === "") return undefined
  const parsed = z.string().safeParse(value)
  if (!parsed.success) throw new Error(`${key} must be a string`)
  return parsed.data
}

/** Reads a required non-empty string argument from parsed tool arguments. */
export function requiredString(args: ToolArguments, key: string) {
  const value = optionalString(args, key)
  if (value) return value
  throw new Error(`${key} is required`)
}
