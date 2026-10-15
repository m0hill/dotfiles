---
name: surfaces
description: Build surfaces, local React UIs (dashboards, boards, forms) whose reads and writes call this session's MCP tools, and open them in the browser. Use when the user asks for a dashboard, board, app, or UI over Notion, GitHub, Linear, or another connected MCP server, or asks to change or fix a surface.
---

# Pi surfaces

All surfaces form one local app. Each surface is one file, `~/.pi/agent/surfaces/<name>.tsx`, and a file can hold several pages. Pi keeps the MCP connections and sign-ins, and serves the app while this Pi session is open. The app's home page lists every surface.

There is nothing to install or build. React 19, TanStack Query 5, Zod 4, Tailwind 4, and the kit (`@surfaces/kit`) are already available. `surface_open` typechecks the file, bundles it, and serves it.

## Steps

1. **Check for an existing surface:** `ls ~/.pi/agent/surfaces`. To change one, edit its file; do not create a second one.
2. **Find the tools.** Use `codemode` (`searchTools`, `describeTool`, `describeNamespace("mcp__<server>")`) or `tool_search`, and read the server instructions. Names look like `mcp__notion__notion_search`.
3. **Probe read tools only.** Call each read tool with realistic, small arguments and study the real result: is the data in `structuredContent` or in text, and is the text JSON, markdown, or something else? Never call a create, update, or delete tool to see its output.
4. **Write `~/.pi/agent/surfaces/<name>.tsx`** (kebab-case name) with the kit, below.
5. **Open:** `surface_open` with the name. Fix any type or build errors it returns and call it again. After that the user only needs to refresh the page.

## A surface file

```tsx
import { useState } from "react"
import {
  Button,
  Card,
  Empty,
  Input,
  Link,
  Result,
  defineSurface,
  useParams,
  z,
} from "@surfaces/kit"

const SEARCH = "mcp__x__search"
const GET = "mcp__x__get"
const CREATE = "mcp__x__create"

// Every tool the surface calls. Pi refuses all others, and the hooks only accept these names.
const surface = defineSurface({
  title: "Tasks",
  description: "Open tasks grouped by status, with a detail page.",
  tools: [SEARCH, GET, CREATE],
})

// Zod schemas describe the JSON you saw while probing.
const Task = z.object({ id: z.string(), title: z.string(), status: z.string() })
const TaskList = z.object({ results: z.array(Task) })

function Board() {
  const tasks = surface.useTool(SEARCH, { query: "" }, TaskList)
  const create = surface.useToolMutation(CREATE, [SEARCH]) // refetches SEARCH after success
  const [title, setTitle] = useState("")
  return (
    <>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate({ title }, { onSuccess: () => setTitle("") })
        }}
      >
        <Input value={title} onChange={(event) => setTitle(event.target.value)} />
        <Button variant="primary" type="submit" disabled={!title.trim() || create.isPending}>
          {create.isPending ? "Adding…" : "Add"}
        </Button>
      </form>
      <Result query={tasks}>
        {({ results }) =>
          results.length === 0 ? (
            <Empty>No tasks</Empty>
          ) : (
            <div className="divide-y divide-border rounded-md border border-border">
              {results.map((task) => (
                <Link key={task.id} to={`/task/${task.id}`} className="block p-2">
                  {task.title}
                </Link>
              ))}
            </div>
          )
        }
      </Result>
    </>
  )
}

function TaskPage() {
  const { id } = useParams()
  const task = surface.useTool(GET, id === undefined ? null : { id }, Task) // null args wait
  return <Result query={task}>{(t) => <Card>{t.title}</Card>}</Result>
}

export default surface.pages({
  "/": { title: "Board", component: Board }, // pages with a title appear as tabs
  "/task/:id": { component: TaskPage },
})
```

- `surface.useTool(tool, args, parse)` calls a read tool through TanStack Query. `parse` is a Zod schema for the result's JSON (`structuredContent`, or the text parsed as JSON), or a function `(result) => value` for other results such as markdown. Use `resultText(result)` there, and throw an `Error` when the text is not what you saw.
- `<Result query={q}>` or `<Result queries={[a, b]}>` renders loading, errors, and parse failures. On a parse failure it shows the raw result and the problem, saves a sample, and offers "Ask Pi". Never fall back to fake data.
- `surface.useToolMutation(tool, refresh)` returns a TanStack mutation: `mutate(args, { onSuccess })`, `isPending`. Pi asks the user to approve every tool that is not read-only, so a mutation can wait; show `isPending`. Failures appear as notices automatically. Do not render write results: list the read tools to refresh instead.
- Pages: `Link to="/path"`, `navigate("/path")`, `useParams()`. Paths are relative to the surface.
- The frame already provides the title, page tabs, a tool call log, notices, and an error boundary.
- Other exports: `Button` (variants `primary`, `outline`, `ghost`, `destructive`), `Input`, `Textarea`, `Select`, `Field`, `Card`, `Badge`, `SectionLabel`, `Empty`, `Loading`, `ErrorView`, `notify(text)`, `useQueryClient`, `surface.callTool(tool, args)`.

## Style

- Tailwind classes only. Colors come from tokens that follow light and dark mode: `bg-background`, `bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`/`text-primary-foreground` for the one main action, `text-destructive` for errors. No hex values or palette classes like `text-gray-500`.
- Hairlines over shadows, grayscale over color. Use `SectionLabel` for group labels and `font-mono` for IDs, counts, and dates.
- Dense lists are bordered rows (`divide-y divide-border` in one bordered container), not a card per item. Use one `Card` per board column or panel.
- The frame pads the page. Make long lists scroll inside their container, so headers and filters stay visible.

## Fix a surface

Read `~/.pi/agent/surfaces/.samples/<name>/*.jsonl`. Each line holds a real `{ tool, args, result, problem }` the surface could not parse. Fix the schema or parser, then `surface_open`.
