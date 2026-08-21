import assert from "node:assert/strict"
import test from "node:test"
import { normalizeToolSchema, sanitizeJsonSchema } from "./tool-schema.js"

test("normalizes MCP tool schemas into Pi's conservative object subset", () => {
  assert.deepEqual(
    normalizeToolSchema({
      type: "object",
      properties: {
        query: { type: "string", description: "Search query", const: "fixed" },
        count: { minimum: 1 },
        nested: {
          type: "object",
          properties: { enabled: { type: "boolean" } },
        },
      },
      required: ["query"],
    }),
    {
      type: "object",
      properties: {
        query: { description: "Search query", enum: ["fixed"], type: "string" },
        count: { type: "number" },
        nested: {
          type: "object",
          properties: { enabled: { type: "boolean" } },
        },
      },
      required: ["query"],
      additionalProperties: false,
    }
  )
})

test("replaces unsupported boolean schemas and sanitizes nested compositions", () => {
  assert.deepEqual(sanitizeJsonSchema(true), { type: "string" })
  assert.deepEqual(sanitizeJsonSchema({ anyOf: [{ type: "string" }, false] }), {
    anyOf: [{ type: "string" }, { type: "string" }],
  })
})
