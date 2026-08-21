import { CallToolResultSchema } from "@modelcontextprotocol/core"
import { Client } from "@modelcontextprotocol/client"
import type {
  CallToolResult,
  Prompt,
  ReadResourceResult,
  Resource,
  Tool,
} from "@modelcontextprotocol/client"
import type { ImageContent, TextContent } from "@earendil-works/pi-ai"
import type { AgentToolResult } from "@earendil-works/pi-coding-agent"
import {
  DEFAULT_TIMEOUT,
  MAX_RESOURCE_BLOB_BYTES,
  SUPPORTED_RESOURCE_IMAGE_MIMES,
} from "./request-limits.js"
import { base64Size, formatBytes } from "./resource-size.js"
import { normalizeToolSchema } from "./tool-schema.js"
import type { ToolArguments } from "./tool-args.js"
import type { CancellableOptions } from "./types.js"

interface McpToolResultDetails {
  readonly structuredContent?: CallToolResult["structuredContent"]
  readonly omitted?: readonly string[]
  readonly rawContent: CallToolResult["content"]
}

/** Lists tools from an MCP client. */
export async function listTools(
  client: Client,
  timeout = DEFAULT_TIMEOUT,
  signal: AbortSignal | undefined
): Promise<Tool[]> {
  return (await client.listTools(undefined, requestOptions(timeout, signal))).tools
}

/** Lists prompts from an MCP client when the server advertises prompt support. */
export async function listPrompts(
  client: Client,
  timeout = DEFAULT_TIMEOUT,
  signal: AbortSignal | undefined
): Promise<Prompt[]> {
  if (!client.getServerCapabilities()?.prompts) return []
  return (await client.listPrompts(undefined, requestOptions(timeout, signal))).prompts
}

/** Lists resources from an MCP client when the server advertises resource support. */
export async function listResources(
  client: Client,
  timeout = DEFAULT_TIMEOUT,
  signal: AbortSignal | undefined
): Promise<Resource[]> {
  if (!client.getServerCapabilities()?.resources) return []
  return (await client.listResources(undefined, requestOptions(timeout, signal))).resources
}

/** Returns Pi-compatible parameters for one MCP tool definition. */
export function toolParameters(tool: Tool) {
  return normalizeToolSchema(tool.inputSchema)
}

/** Calls one MCP tool and converts MCP content into Pi tool result content. */
export async function callMcpTool(input: {
  readonly client: Client
  readonly tool: Tool
  readonly args: ToolArguments
  readonly timeout?: number
  readonly signal: AbortSignal | undefined
}): Promise<AgentToolResult<McpToolResultDetails>> {
  const rawResult = await input.client.callTool(
    {
      name: input.tool.name,
      arguments: input.args,
    },
    requestOptions(input.timeout, input.signal)
  )
  const result = normalizeCallToolResult(rawResult)

  if (result.isError) {
    throw new Error(textFromCallResult(result) || "MCP tool returned an error")
  }

  if (result.structuredContent !== undefined && result.structuredContent !== null) {
    return {
      content: [{ type: "text", text: JSON.stringify(result.structuredContent) }],
      details: { structuredContent: result.structuredContent, rawContent: result.content },
    }
  }

  const converted = convertMcpContent(result.content)
  return {
    content: converted.content,
    details: {
      omitted: converted.omitted,
      rawContent: result.content,
    },
  }
}

/** Projects MCP resource metadata into the JSON shape returned by Pi's resource-list tool. */
export function formatResourceList(resources: Array<Resource & { client: string }>) {
  return resources.map((resource) => ({
    name: resource.name,
    uri: resource.uri,
    description: resource.description,
    mimeType: resource.mimeType,
    server: resource.client,
  }))
}

/** Converts MCP resource contents into text and supported image attachments for Pi. */
export function formatResourceContent(server: string, uri: string, content: ReadResourceResult) {
  const items = content.contents
  const text: string[] = []
  const images: ImageContent[] = []

  for (const item of items) {
    const itemUri = item.uri || uri
    const mime = item.mimeType ?? "application/octet-stream"
    if ("text" in item) {
      text.push(`Resource: ${itemUri}\nMIME: ${mime}\n${item.text}`)
      continue
    }
    if ("blob" in item) {
      const size = base64Size(item.blob)
      if (!SUPPORTED_RESOURCE_IMAGE_MIMES.has(mime)) {
        text.push(
          `[Binary MCP resource omitted: ${itemUri} (${mime}, ${formatBytes(size)}) is not a supported image type]`
        )
        continue
      }
      if (size > MAX_RESOURCE_BLOB_BYTES) {
        text.push(
          `[Binary MCP resource omitted: ${itemUri} (${mime}, ${formatBytes(size)}) exceeds ${formatBytes(MAX_RESOURCE_BLOB_BYTES)}]`
        )
        continue
      }
      text.push(`[Binary MCP resource attached: ${itemUri} (${mime})]`)
      images.push({ type: "image", mimeType: mime, data: item.blob })
      continue
    }
    text.push(`[MCP resource content without text or blob: ${itemUri}]`)
  }

  return {
    text: text.join("\n\n") || `MCP resource ${uri} from ${server} returned no contents.`,
    images,
    count: items.length,
  }
}

function convertMcpContent(content: CallToolResult["content"]) {
  const output: Array<TextContent | ImageContent> = []
  const omitted: string[] = []

  for (const item of content) {
    if (item.type === "text") {
      output.push({ type: "text", text: item.text })
      continue
    }

    if (item.type === "image") {
      output.push({ type: "image", mimeType: item.mimeType, data: item.data })
      continue
    }

    if (item.type === "resource") {
      const resource = item.resource
      if ("text" in resource) {
        output.push({ type: "text", text: resource.text })
        continue
      }
      if ("blob" in resource) {
        const mime = resource.mimeType ?? "application/octet-stream"
        const size = base64Size(resource.blob)
        if (SUPPORTED_RESOURCE_IMAGE_MIMES.has(mime) && size <= MAX_RESOURCE_BLOB_BYTES) {
          output.push({ type: "image", mimeType: mime, data: resource.blob })
        } else {
          omitted.push(`${resource.uri} (${mime}, ${formatBytes(size)})`)
        }
      }
    }
  }

  if (output.length === 0) {
    output.push({
      type: "text",
      text: omitted.length
        ? `MCP returned only unsupported binary content: ${omitted.join(", ")}`
        : "MCP tool returned no content.",
    })
  }

  return { content: output, omitted }
}

function textFromCallResult(result: CallToolResult) {
  return result.content
    .flatMap((item) => (item.type === "text" ? [item.text] : []))
    .filter((text) => text.trim())
    .join("\n\n")
}

function normalizeCallToolResult(value: Awaited<ReturnType<Client["callTool"]>>): CallToolResult {
  if ("toolResult" in value) {
    return {
      content: [{ type: "text", text: JSON.stringify(value.toolResult) }],
    }
  }
  const parsed = CallToolResultSchema.safeParse(value)
  if (parsed.success) return parsed.data
  return { content: [{ type: "text", text: "MCP tool returned no content." }] }
}

function requestOptions(timeout: number | undefined, signal: CancellableOptions["signal"]) {
  const options = {
    resetTimeoutOnProgress: true,
    timeout: timeout ?? DEFAULT_TIMEOUT,
    onprogress: () => {},
  }
  return signal ? { ...options, signal } : options
}
