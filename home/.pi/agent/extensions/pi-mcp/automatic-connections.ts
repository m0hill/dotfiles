import type { McpConfig } from "./types.js"

/** Selects configured MCP servers eligible for automatic connection in the current startup mode. */
export function automaticConnectionServerNames(
  config: McpConfig,
  rememberedServerNames: ReadonlySet<string>
): string[] {
  const configuredNames = Object.keys(config.servers)
  if (config.startup === "eager") return configuredNames
  return configuredNames.filter((name) => rememberedServerNames.has(name))
}
