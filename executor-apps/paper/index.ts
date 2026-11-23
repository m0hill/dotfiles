import { defineApp, toolAnnotations, withApprovals } from "apps";
import { mcpRouter } from "apps/mcp";
import { always } from "apps/operations/approval";

// Paper Desktop's local MCP endpoint (Streamable HTTP). It only answers while
// Paper Desktop is running with a file open; Executor apps can't start Paper's
// stdio CLI, so this uses the HTTP endpoint Desktop serves.
const url = "http://127.0.0.1:29979/mcp";

export default defineApp({}, async ({ signal }) => ({
  // Ask before every tool Paper doesn't mark read-only (edits to the open file).
  tools: withApprovals(await mcpRouter({ url, signal }), (tool) =>
    toolAnnotations(tool)?.readOnlyHint === true ? undefined : always(),
  ),
}));
