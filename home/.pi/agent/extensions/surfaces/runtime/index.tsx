/**
 * The surface kit: everything a surface imports from "@surfaces/kit". It talks to the Pi bridge,
 * wraps tool calls in TanStack Query and Zod, routes between a surface's pages, and renders the
 * frame, loading, error, and fallback states.
 */
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query"
import {
  Component,
  StrictMode,
  useEffect,
  useState,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ComponentType,
  type ErrorInfo,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react"
import { createRoot } from "react-dom/client"
import { z } from "zod"

export { z } from "zod"
export { useQueryClient } from "@tanstack/react-query"

// Tool results

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

/** Tool arguments, matching the tool's input schema. */
export interface ToolArgs {
  [key: string]: JsonValue
}

export interface TextBlock {
  type: "text"
  text: string
}

export interface OtherBlock {
  type: "image" | "audio" | "resource" | "resource_link"
}

/** An MCP `CallToolResult`, exactly as the server returned it. */
export interface CallToolResult {
  content: (TextBlock | OtherBlock)[]
  structuredContent?: { [key: string]: JsonValue }
  isError?: boolean
}

/** A tool result the surface could not parse. `Result` renders it raw and saves a sample. */
export class UnreadableResult extends Error {
  readonly tool: string
  readonly args: ToolArgs
  readonly result: CallToolResult

  constructor(tool: string, args: ToolArgs, result: CallToolResult, problem: string) {
    super(problem)
    this.name = "UnreadableResult"
    this.tool = tool
    this.args = args
    this.result = result
  }
}

/** Joins the text blocks of a result. */
export function resultText(result: CallToolResult): string {
  return result.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n")
}

/** The result as JSON: `structuredContent`, or the text parsed as JSON. Throws when neither. */
export function resultJson(result: CallToolResult): JsonValue {
  if (result.structuredContent !== undefined) return result.structuredContent
  const text = resultText(result)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Expected JSON text, got: ${text.slice(0, 200)}`)
  }
}

/**
 * How a surface reads a tool result: a Zod schema for the result's JSON (`resultJson`), or a
 * function for anything else, such as text. Both throw when the result has another shape.
 */
export type Parser<T> = z.ZodType<T> | ((result: CallToolResult) => T)

function parseResult<T>(result: CallToolResult, parser: Parser<T>): T {
  if (!(parser instanceof z.ZodType)) return parser(result)
  const parsed = parser.safeParse(resultJson(result))
  if (!parsed.success) throw new Error(z.prettifyError(parsed.error))
  return parsed.data
}

// Bridge

interface BridgeRequest {
  tool?: string
  args?: ToolArgs
  result?: CallToolResult
  problem?: string
  message?: string
}

export interface ToolCallRecord {
  id: number
  tool: string
  args: ToolArgs
  startedAt: number
  durationMs?: number
  result?: CallToolResult
  error?: string
}

let calls: readonly ToolCallRecord[] = []
let nextCallId = 1
const callListeners = new Set<() => void>()

function surfaceName(): string {
  return location.pathname.split("/")[1] ?? ""
}

async function post<T>(path: string, body: BridgeRequest): Promise<T> {
  // The page shell moves the token from the URL fragment into sessionStorage.
  const token = sessionStorage.getItem("pi-surfaces-token") ?? ""
  const response = await fetch(`/_/api/${surfaceName()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const json = await response.json()
  if (!response.ok) throw new Error(json.error ?? `${response.status} ${response.statusText}`)
  return json
}

function updateCall(record: ToolCallRecord): void {
  calls = [...calls.filter((call) => call.id !== record.id), record].slice(-100)
  callListeners.forEach((listener) => listener())
}

async function callTool(tool: string, args: ToolArgs): Promise<CallToolResult> {
  const startedAt = Date.now()
  const record: ToolCallRecord = { id: nextCallId++, tool, args, startedAt }
  updateCall(record)
  try {
    const result = await post<CallToolResult>("/call", { tool, args })
    updateCall({ ...record, result, durationMs: Date.now() - startedAt })
    if (result.isError) throw new Error(resultText(result) || `${tool} failed`)
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    updateCall({ ...record, error: message, durationMs: Date.now() - startedAt })
    throw error
  }
}

/** Sends a problem to the Pi session so the agent can explain or fix it. */
export function askPi(request: BridgeRequest): Promise<{ sent: boolean }> {
  return post("/ask", request)
}

function reportSample(error: UnreadableResult): Promise<{ saved: string }> {
  return post("/samples", {
    tool: error.tool,
    args: error.args,
    result: error.result,
    problem: error.message,
  })
}

// Notices

interface Notice {
  id: number
  text: string
}

let notices: readonly Notice[] = []
let nextNoticeId = 1
const noticeListeners = new Set<() => void>()

/** Shows a message in the corner of the surface for a few seconds. */
export function notify(text: string): void {
  const id = nextNoticeId++
  notices = [...notices, { id, text }]
  noticeListeners.forEach((listener) => listener())
  setTimeout(() => {
    notices = notices.filter((notice) => notice.id !== id)
    noticeListeners.forEach((listener) => listener())
  }, 8000)
}

// Surfaces

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  mutationCache: new MutationCache({ onError: (error) => notify(error.message) }),
})

export interface SurfaceInfo<Tool extends string> {
  /** Shown in the header and on the surfaces list. */
  title: string
  /** What the surface shows, to find it again later. */
  description: string
  /** Every MCP tool (`mcp__<server>__<tool>`) the surface calls. Pi refuses all others. */
  tools: readonly Tool[]
}

export interface Page {
  /** Pages with a title appear as tabs in the header. */
  title?: string
  component: ComponentType
}

/** Pages by path, such as "/" and "/task/:id". "/" is the surface's first page. */
export interface Pages {
  [path: string]: Page
}

/** What a surface file default-exports. */
export interface SurfaceModule extends SurfaceInfo<string> {
  pages: Pages
}

export interface Surface<Tool extends string> {
  /**
   * Calls a read tool and parses its result. Refetches when the args change; pass `null` args to
   * wait, for example until another query has produced an ID.
   */
  useTool<T>(tool: Tool, args: ToolArgs | null, parse: Parser<T>): UseQueryResult<T, Error>
  /**
   * Calls a write tool with `mutate(args)`. Pi asks the user to approve it, so it can take a
   * while: show `isPending`. Failures appear as notices. After a success, the `refresh` tools'
   * queries fetch again.
   */
  useToolMutation(
    tool: Tool,
    refresh?: readonly Tool[]
  ): UseMutationResult<CallToolResult, Error, ToolArgs>
  /** Calls a tool outside React. Throws when Pi refuses it or the tool reports an error. */
  callTool(tool: Tool, args: ToolArgs): Promise<CallToolResult>
  /** Finishes the surface: `export default surface.pages({ "/": { title, component } })`. */
  pages(pages: Pages): SurfaceModule
}

/** Declares a surface. Its hooks only accept the tools listed here. */
export function defineSurface<const Tool extends string>(info: SurfaceInfo<Tool>): Surface<Tool> {
  return {
    useTool<T>(tool: Tool, args: ToolArgs | null, parse: Parser<T>) {
      return useQuery<T, Error>({
        queryKey: ["tool", tool, args],
        enabled: args !== null,
        queryFn: async () => {
          const callArgs = args ?? {}
          const result = await callTool(tool, callArgs)
          try {
            return parseResult(result, parse)
          } catch (error) {
            const problem = error instanceof Error ? error.message : String(error)
            throw new UnreadableResult(tool, callArgs, result, problem)
          }
        },
      })
    },
    useToolMutation(tool: Tool, refresh: readonly Tool[] = []) {
      return useMutation({
        mutationKey: ["tool", tool],
        mutationFn: (args: ToolArgs) => callTool(tool, args),
        onSuccess: () =>
          Promise.all(
            refresh.map((read) => queryClient.invalidateQueries({ queryKey: ["tool", read] }))
          ),
      })
    },
    callTool,
    pages: (pages) => ({ ...info, pages }),
  }
}

// Routing

const routeListeners = new Set<() => void>()
// Pi also imports surfaces in Node to read their info, where there is no window.
globalThis.addEventListener?.("popstate", () => routeListeners.forEach((listener) => listener()))

/** The current page path within the surface, such as "/task/42". */
function currentPath(): string {
  const rest = location.pathname.slice(surfaceName().length + 1)
  return rest === "" ? "/" : rest
}

function matchPath(pattern: string, path: string): { [name: string]: string } | undefined {
  const patternParts = pattern.split("/").filter(Boolean)
  const pathParts = path.split("/").filter(Boolean)
  if (patternParts.length !== pathParts.length) return undefined
  const params: { [name: string]: string } = {}
  for (const [index, part] of patternParts.entries()) {
    const value = pathParts[index] ?? ""
    if (part.startsWith(":")) params[part.slice(1)] = decodeURIComponent(value)
    else if (part !== value) return undefined
  }
  return params
}

function usePath(): string {
  return useSyncExternalStore((listener) => {
    routeListeners.add(listener)
    return () => routeListeners.delete(listener)
  }, currentPath)
}

/** Goes to another page of this surface, e.g. `navigate("/task/42")`. */
export function navigate(to: string): void {
  history.pushState(null, "", `/${surfaceName()}${to}`)
  routeListeners.forEach((listener) => listener())
}

/** Link to another page of this surface, e.g. `<Link to="/task/42">`. */
export function Link(props: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }): ReactNode {
  const { to, className, ...rest } = props
  return (
    <a
      {...rest}
      href={`/${surfaceName()}${to}`}
      className={cx("underline-offset-2 hover:underline", className)}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return
        event.preventDefault()
        navigate(to)
      }}
    />
  )
}

let currentParams: { [name: string]: string } = {}

/** The current page's path parameters, e.g. `useParams().id` on "/task/:id". */
export function useParams(): { [name: string]: string | undefined } {
  usePath()
  return currentParams
}

// Components

function cx(...classes: (string | false | undefined)[]): string {
  return classes.filter(Boolean).join(" ")
}

const BUTTON_VARIANTS = {
  primary: "bg-primary text-primary-foreground border-primary hover:opacity-90",
  outline: "bg-card border-border hover:bg-muted",
  ghost: "border-transparent hover:bg-muted",
  destructive: "bg-destructive text-white border-destructive hover:opacity-90",
}

export function Button(
  props: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON_VARIANTS }
): ReactNode {
  const { variant = "outline", className, ...rest } = props
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium whitespace-nowrap disabled:pointer-events-none disabled:opacity-50",
        BUTTON_VARIANTS[variant],
        className
      )}
    />
  )
}

const FIELD_CLASS =
  "rounded-md border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus:border-ring"

export function Input(props: InputHTMLAttributes<HTMLInputElement>): ReactNode {
  return <input {...props} className={cx(FIELD_CLASS, "h-8 w-full", props.className)} />
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>): ReactNode {
  return <textarea {...props} className={cx(FIELD_CLASS, "min-h-20 w-full", props.className)} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>): ReactNode {
  return <select {...props} className={cx(FIELD_CLASS, "h-8", props.className)} />
}

/** A labelled form control. */
export function Field(props: { label: string; children: ReactNode }): ReactNode {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {props.label}
      {props.children}
    </label>
  )
}

export function Card(props: HTMLAttributes<HTMLDivElement>): ReactNode {
  return (
    <div
      {...props}
      className={cx(
        "flex flex-col gap-3 rounded-lg border border-border bg-card p-4",
        props.className
      )}
    />
  )
}

export function Badge(props: HTMLAttributes<HTMLSpanElement>): ReactNode {
  return (
    <span
      {...props}
      className={cx(
        "inline-flex items-center rounded-full border border-border px-2 text-xs text-muted-foreground",
        props.className
      )}
    />
  )
}

/** Mono uppercase label for a group, used instead of a bold heading. */
export function SectionLabel(props: { children: ReactNode }): ReactNode {
  return (
    <div className="font-mono text-[11px] tracking-[0.08em] text-muted-foreground uppercase">
      {props.children}
    </div>
  )
}

export function Loading(): ReactNode {
  return (
    <div className="flex flex-col gap-2">
      <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
      <div className="h-16 animate-pulse rounded bg-muted" />
      <div className="h-16 animate-pulse rounded bg-muted" />
    </div>
  )
}

export function Empty(props: { children: ReactNode }): ReactNode {
  return (
    <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
      {props.children}
    </div>
  )
}

function AskPiButton(props: { request: BridgeRequest }): ReactNode {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle")
  return (
    <Button
      disabled={state !== "idle"}
      onClick={() => {
        setState("sending")
        askPi(props.request).then(
          () => setState("sent"),
          (error: Error) => {
            setState("idle")
            notify(error.message)
          }
        )
      }}
    >
      {state === "sent" ? "Sent to Pi" : "Ask Pi"}
    </Button>
  )
}

const reported = new Set<string>()

function UnreadableView(props: { error: UnreadableResult; retry: () => void }): ReactNode {
  const { error } = props
  useEffect(() => {
    const key = `${error.tool}\n${error.message}`
    if (reported.has(key)) return
    reported.add(key)
    reportSample(error).catch(() => reported.delete(key))
  }, [error])
  const raw =
    error.result.structuredContent !== undefined
      ? JSON.stringify(error.result.structuredContent, null, 2)
      : resultText(error.result)
  return (
    <Card>
      <p className="text-sm text-muted-foreground">
        This surface could not read the result of <code>{error.tool}</code>. Pi saved it as a sample
        so the surface can be fixed.
      </p>
      <pre className="text-xs whitespace-pre-wrap text-destructive">{error.message}</pre>
      <div className="flex gap-2">
        <AskPiButton
          request={{
            tool: error.tool,
            args: error.args,
            result: error.result,
            problem: error.message,
          }}
        />
        <Button onClick={props.retry}>Retry</Button>
      </div>
      <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
        {raw}
      </pre>
    </Card>
  )
}

/** An error with Retry and Ask Pi buttons. */
export function ErrorView(props: { error: Error; retry?: () => void }): ReactNode {
  return (
    <Card className="border-destructive/40">
      <p className="text-sm whitespace-pre-wrap text-destructive">{props.error.message}</p>
      <div className="flex gap-2">
        <AskPiButton request={{ message: props.error.stack ?? props.error.message }} />
        {props.retry && <Button onClick={props.retry}>Retry</Button>}
      </div>
    </Card>
  )
}

function QueryState(props: { query: UseQueryResult<unknown, Error> }): ReactNode {
  const { query } = props
  const retry = () => void query.refetch()
  if (query.error instanceof UnreadableResult) {
    return <UnreadableView error={query.error} retry={retry} />
  }
  if (query.error !== null) return <ErrorView error={query.error} retry={retry} />
  return <Loading />
}

type QueryData<Queries extends readonly UseQueryResult<unknown, Error>[]> = {
  [Index in keyof Queries]: Queries[Index] extends UseQueryResult<infer Data, Error> ? Data : never
}

/**
 * Renders queries: `Loading` while any loads, the raw result when a parser failed, the error when
 * a call failed, and `children(data)` once all succeeded. Pass one query or several:
 * `<Result query={tasks}>{(list) => …}</Result>`,
 * `<Result queries={[tasks, people]}>{([list, team]) => …}</Result>`.
 */
export function Result<T>(props: {
  query: UseQueryResult<T, Error>
  children: (data: T) => ReactNode
}): ReactNode
export function Result<const Queries extends readonly UseQueryResult<unknown, Error>[]>(props: {
  queries: Queries
  children: (data: QueryData<Queries>) => ReactNode
}): ReactNode
export function Result(props: {
  query?: UseQueryResult<unknown, Error>
  queries?: readonly UseQueryResult<unknown, Error>[]
  children: (data: never) => ReactNode
}): ReactNode {
  const queries = props.queries ?? (props.query === undefined ? [] : [props.query])
  const blocking =
    queries.find((query) => query.isError) ?? queries.find((query) => query.isPending)
  if (blocking !== undefined) return <QueryState query={blocking} />
  const data = queries.map((query) => query.data)
  // The overloads tie `children` to the shape of `query` or `queries`.
  return props.children((props.queries === undefined ? data[0] : data) as never)
}

// Frame

interface ErrorBoundaryState {
  error?: Error
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = {}

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error, info.componentStack)
  }

  override render(): ReactNode {
    if (this.state.error === undefined) return this.props.children
    return <ErrorView error={this.state.error} retry={() => this.setState({ error: undefined })} />
  }
}

function CallLog(props: { onClose: () => void }): ReactNode {
  const current = useSyncExternalStore(
    (listener) => {
      callListeners.add(listener)
      return () => callListeners.delete(listener)
    },
    () => calls
  )
  return (
    <aside className="fixed inset-y-0 right-0 flex w-[min(480px,100vw)] flex-col gap-2 overflow-auto border-l border-border bg-card p-3 shadow-lg">
      <div className="flex items-center justify-between">
        <SectionLabel>Tool calls</SectionLabel>
        <Button variant="ghost" onClick={props.onClose}>
          Close
        </Button>
      </div>
      {current.toReversed().map((call) => (
        <details key={call.id} className="rounded-md border border-border p-2">
          <summary
            className={cx(
              "cursor-pointer font-mono text-xs",
              (call.error !== undefined || call.result?.isError) && "text-destructive"
            )}
          >
            {call.tool}{" "}
            <span className="text-muted-foreground">
              {call.durationMs === undefined ? "running" : `${call.durationMs} ms`}
            </span>
          </summary>
          <pre className="mt-2 rounded bg-muted p-2 text-xs whitespace-pre-wrap">
            {JSON.stringify(call.args, null, 2)}
          </pre>
          <pre className="mt-2 max-h-80 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">
            {call.error ?? (call.result ? resultText(call.result) : "")}
          </pre>
        </details>
      ))}
    </aside>
  )
}

function Frame(props: { surface: SurfaceModule }): ReactNode {
  const { surface } = props
  const [logOpen, setLogOpen] = useState(false)
  const path = usePath()
  const current = useSyncExternalStore(
    (listener) => {
      noticeListeners.add(listener)
      return () => noticeListeners.delete(listener)
    },
    () => notices
  )
  const routes = Object.entries(surface.pages)
  const match = routes
    .map(([pattern, page]) => ({ pattern, page, params: matchPath(pattern, path) }))
    .find((route) => route.params !== undefined)
  currentParams = match?.params ?? {}
  const tabs = routes.filter(([, page]) => page.title !== undefined)
  const Page = match?.page.component

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-4 border-b border-border bg-card px-5 py-3">
        <a href="/" className="text-muted-foreground hover:text-foreground" title="All surfaces">
          ←
        </a>
        <h1 className="text-lg font-semibold tracking-tight">{surface.title}</h1>
        {tabs.length > 1 && (
          <nav className="flex gap-1">
            {tabs.map(([pattern, page]) => (
              <Link
                key={pattern}
                to={pattern}
                className={cx(
                  "rounded-md px-2.5 py-1 text-sm hover:no-underline",
                  pattern === match?.pattern ? "bg-muted font-medium" : "text-muted-foreground"
                )}
              >
                {page.title}
              </Link>
            ))}
          </nav>
        )}
        <Button variant="ghost" className="ml-auto" onClick={() => setLogOpen(!logOpen)}>
          Tool calls
        </Button>
      </header>
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-5">
        <ErrorBoundary key={path}>
          {Page === undefined ? <Empty>No page at {path}</Empty> : <Page />}
        </ErrorBoundary>
      </main>
      {logOpen && <CallLog onClose={() => setLogOpen(false)} />}
      <div className="fixed right-4 bottom-4 flex flex-col gap-2">
        {current.map((notice) => (
          <div
            key={notice.id}
            className="max-w-md rounded-lg border border-destructive/40 bg-card px-3 py-2 text-sm text-destructive shadow-lg"
          >
            {notice.text}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Renders a surface. Called by the generated entry point, not by surfaces. */
export function mount(surface: SurfaceModule): void {
  document.title = surface.title
  const root = document.getElementById("root")
  if (root === null) throw new Error("Missing #root")
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <Frame surface={surface} />
      </QueryClientProvider>
    </StrictMode>
  )
}
