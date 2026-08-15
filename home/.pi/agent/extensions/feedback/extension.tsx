/** @jsxRuntime automatic */
/** @jsxImportSource datastar-kit */

import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, basename, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
  SessionMessageEntry,
} from "@earendil-works/pi-coding-agent"
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai"
import MarkdownIt from "markdown-it"
import { event, js, mod, post, read, reply, state, unsafeHtml } from "datastar-kit"
import { bodyLimit } from "hono/body-limit"
import { Hono } from "hono/tiny"
import { Type, type Static } from "typebox"
import { Value } from "typebox/value"

const DATASTAR_RUNTIME =
  "https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.2/bundles/datastar.js"
const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url))

const feedbackForm = state({
  quote: "",
  comment: "",
  globalComment: "",
  selectionStart: 0,
  selectionEnd: 0,
  dialogOpen: false,
  selectedAnnotationId: "",
  editingAnnotationId: "",
  editingComment: "",
  annotationCount: 0,
  error: "",
})

type Annotation = {
  readonly id: string
  readonly quote: string
  readonly comment: string
  readonly start: number
  readonly end: number
}

type Heading = {
  readonly id: string
  readonly label: string
  readonly level: number
}

type RenderedMarkdown = {
  readonly html: string
  readonly headings: readonly Heading[]
}

type FeedbackSession = {
  readonly id: string
  readonly title: string
  readonly source: string
  readonly document: string
  readonly rendered: RenderedMarkdown
  annotations: Annotation[]
}

const feedbackInputSchema = Type.Object({
  quote: Type.String(),
  comment: Type.String(),
  globalComment: Type.String(),
  editingComment: Type.String(),
  selectionStart: Type.Integer(),
  selectionEnd: Type.Integer(),
})

type ParsedForm = Static<typeof feedbackInputSchema>

type ParseResult<T> =
  | { readonly _tag: "ok"; readonly value: T }
  | { readonly _tag: "error"; readonly message: string }

const sessions = new Map<string, FeedbackSession>()
let server: ReturnType<typeof serve> | undefined
let serverPort: number | undefined
let serverStart: Promise<number> | undefined

function isAssistantMessageEntry(
  entry: SessionEntry
): entry is SessionMessageEntry & { message: AssistantMessage } {
  return entry.type === "message" && entry.message.role === "assistant"
}

function isTextContent(block: AssistantMessage["content"][number]): block is TextContent {
  return block.type === "text"
}

function lastAssistantText(ctx: ExtensionContext): string | undefined {
  const branch = ctx.sessionManager.getBranch()
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index]
    if (entry === undefined || !isAssistantMessageEntry(entry)) continue
    const text = entry.message.content
      .filter(isTextContent)
      .map((block) => block.text)
      .join("\n\n")
      .trim()
    if (text) return text
  }
  return undefined
}

function parseForm(input: unknown): ParseResult<ParsedForm> {
  if (!Value.Check(feedbackInputSchema, input)) {
    return { _tag: "error", message: "Invalid feedback form." }
  }
  return {
    _tag: "ok",
    value: {
      ...input,
      quote: input.quote.trim(),
      comment: input.comment.trim(),
      globalComment: input.globalComment.trim(),
      editingComment: input.editingComment.trim(),
    },
  }
}

function slugifyHeading(label: string, seen: Map<string, number>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-") || "section"
  const count = seen.get(base) ?? 0
  seen.set(base, count + 1)
  return count === 0 ? base : `${base}-${count}`
}

function renderMarkdown(document: string): RenderedMarkdown {
  const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false })
  const environment = {}
  const tokens = markdown.parse(document, environment)
  const headings: Heading[] = []
  const seen = new Map<string, number>()

  tokens.forEach((token, index) => {
    if (token.type !== "heading_open") return
    const inline = tokens[index + 1]
    if (inline?.type !== "inline") return
    const label = inline.content.trim()
    const id = slugifyHeading(label, seen)
    token.attrSet("id", id)
    headings.push({ id, label, level: Number(token.tag.slice(1)) })
  })

  return {
    html: markdown.renderer.render(tokens, markdown.options, environment),
    headings,
  }
}

function createFeedbackSession(title: string, source: string, document: string): FeedbackSession {
  const session: FeedbackSession = {
    id: randomUUID(),
    title,
    source,
    document,
    rendered: renderMarkdown(document),
    annotations: [],
  }
  sessions.set(session.id, session)
  return session
}

function AnnotationList(props: { readonly session: FeedbackSession }) {
  const highlights = props.session.annotations.map(({ id, start, end }) => ({ id, start, end }))
  return (
    <section
      id="annotations"
      class="rsec rsec-annotations"
      aria-label="Annotations"
      data-init={js<void>(
        `window.feedback.sync(${JSON.stringify(highlights)}, ${feedbackForm.refs.selectedAnnotationId})`
      )}
    >
      <div class="rsec-head">
        <span class="rsec-label">Annotations</span>
        <span class="anno-file">{props.session.annotations.length}</span>
      </div>
      <div class="rsec-body">
        {props.session.annotations.length === 0 ? (
          <p class="no-anno">no annotations yet</p>
        ) : (
          props.session.annotations.map((annotation, index) => {
            const isSelected = js<boolean>`${feedbackForm.refs.selectedAnnotationId} === ${annotation.id}`
            const isEditing = js<boolean>`${feedbackForm.refs.editingAnnotationId} === ${annotation.id}`
            const isNotEditing = js<boolean>`${feedbackForm.refs.editingAnnotationId} !== ${annotation.id}`
            const selectAnnotation = js<void>`if (!evt.target.closest?.("button, textarea")) { ${feedbackForm.refs.selectedAnnotationId} = ${annotation.id}; window.feedback.activate(${annotation.start}, ${annotation.end}) }`
            const startEditing = js<void>`${feedbackForm.refs.editingAnnotationId} = ${annotation.id}; ${feedbackForm.refs.editingComment} = ${annotation.comment}; ${feedbackForm.refs.error} = ""`
            const cancelEditing = js<void>`${feedbackForm.refs.editingAnnotationId} = ""; ${feedbackForm.refs.editingComment} = ""; ${feedbackForm.refs.error} = ""`
            return (
              <article
                class="annotation-card"
                id={`annotation-${annotation.id}`}
                data-class:active={isSelected}
                data-on:click={selectAnnotation}
              >
                <button
                  class="close-btn"
                  type="button"
                  title="Delete annotation"
                  aria-label="Delete annotation"
                  data-on:click={post(
                    `/sessions/${props.session.id}/annotations/${annotation.id}/delete`
                  )}
                >
                  ×
                </button>
                <span class="anno-file">#{String(index + 1).padStart(2, "0")}</span>
                <blockquote class="quote">{annotation.quote}</blockquote>
                <div class="anno-comment-wrap">
                  <div data-show={isNotEditing}>
                    <button
                      class="edit-btn"
                      type="button"
                      title="Edit annotation"
                      aria-label="Edit annotation"
                      data-on:click={startEditing}
                    >
                      ✎
                    </button>
                    <p class="anno-comment">{annotation.comment}</p>
                  </div>
                  <div data-show={isEditing}>
                    <textarea
                      class="edit-annotation-input"
                      aria-label="Edit annotation comment"
                      data-bind={feedbackForm.refs.editingComment}
                    />
                    <div class="edit-actions">
                      <button type="button" data-on:click={cancelEditing}>
                        Cancel
                      </button>
                      <button
                        class="primary"
                        type="button"
                        data-attr:disabled={js<boolean>`${feedbackForm.refs.editingComment}.trim() === ""`}
                        data-on:click={post(
                          `/sessions/${props.session.id}/annotations/${annotation.id}/edit`
                        )}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            )
          })
        )}
      </div>
    </section>
  )
}

function TableOfContents(props: { readonly headings: readonly Heading[] }) {
  return (
    <nav id="toc">
      {props.headings.length === 0 ? (
        <div class="toc-empty">no headings</div>
      ) : (
        props.headings.map((heading) => (
          <a href={`#${heading.id}`} data-level={heading.level} title={heading.label}>
            {heading.label}
          </a>
        ))
      )}
    </nav>
  )
}

function FeedbackPage(props: { readonly session: FeedbackSession }) {
  const sendDisabled = js<boolean>`${feedbackForm.refs.annotationCount} === 0`
  const addDisabled = js<boolean>`${feedbackForm.refs.quote}.trim() === "" || ${feedbackForm.refs.comment}.trim() === ""`
  const captureSelection = js<void>`const selected = window.feedback.capture(el); if (selected) { ${feedbackForm.refs.quote} = selected.quote; ${feedbackForm.refs.selectionStart} = selected.start; ${feedbackForm.refs.selectionEnd} = selected.end; ${feedbackForm.refs.error} = ""; ${feedbackForm.refs.dialogOpen} = true }`
  const syncDialog = js<void>`${feedbackForm.refs.dialogOpen} ? window.feedback.open(el) : (el.open && el.close())`
  const closeDialog = js<void>`${feedbackForm.refs.dialogOpen} = false; ${feedbackForm.refs.error} = ""`

  return (
    <main
      id="feedback-app"
      data-signals={mod(
        { ...feedbackForm.defaults, annotationCount: props.session.annotations.length },
        { ifMissing: true }
      )}
    >
      <header id="topbar">
        <div id="topbar-title">
          <span class="prompt">›</span>
          <h1 id="title">{props.session.title}</h1>
        </div>
        <div id="topbar-actions">
          <button
            type="button"
            data-attr:disabled={sendDisabled}
            data-on:click={post(`/sessions/${props.session.id}/submit-clear`)}
          >
            Send & Clear
          </button>
          <button
            class="primary"
            type="button"
            data-attr:disabled={sendDisabled}
            data-on:click={post(`/sessions/${props.session.id}/submit`)}
          >
            Send Feedback
          </button>
        </div>
      </header>

      <div id="shell">
        <aside id="sidebar-left" class="sidebar">
          <div class="sb-head">
            <span class="sb-label">Index</span>
          </div>
          <div class="sb-scroll">
            <TableOfContents headings={props.session.rendered.headings} />
          </div>
        </aside>

        <div id="doc-wrap">
          <div id="doc-bar">
            <span class="doc-bar-label">Document</span>
            <span id="source">{props.session.source}</span>
          </div>
          <article id="doc" data-on:mouseup={captureSelection}>
            {unsafeHtml(props.session.rendered.html)}
          </article>
        </div>

        <aside id="sidebar-right" class="sidebar">
          <div id="sb-right-inner">
            <section class="rsec">
              <div class="rsec-head">
                <span class="rsec-label">Global Feedback</span>
              </div>
              <textarea
                id="global-comment"
                data-bind={feedbackForm.refs.globalComment}
                placeholder="Overall notes…"
              />
              <p class="error" data-text={feedbackForm.refs.error} />
            </section>
            <AnnotationList session={props.session} />
          </div>
        </aside>
      </div>

      <dialog
        id="annotation-dialog"
        aria-labelledby="annotation-dialog-title"
        data-effect={syncDialog}
        data-on:close={closeDialog}
      >
        <div class="dialog-head">
          <span id="annotation-dialog-title" class="rsec-label">
            Selection
          </span>
          <button
            class="dialog-close"
            type="button"
            title="Close"
            aria-label="Close annotation dialog"
            data-on:click={closeDialog}
          >
            ×
          </button>
        </div>
        <div class="dialog-body">
          <blockquote class="quote dialog-quote" data-text={feedbackForm.refs.quote} />
          <textarea
            id="comment"
            autofocus
            aria-label="Annotation comment"
            data-bind={feedbackForm.refs.comment}
            placeholder="Add a comment…"
          />
          <p class="error" data-text={feedbackForm.refs.error} />
        </div>
        <div class="dialog-foot">
          <span class="dialog-hint">esc to cancel</span>
          <div class="dialog-actions">
            <button type="button" data-on:click={closeDialog}>
              Cancel
            </button>
            <button
              class="primary"
              type="button"
              data-attr:disabled={addDisabled}
              data-on:click={post(`/sessions/${props.session.id}/annotations/add`)}
            >
              Add
            </button>
          </div>
        </div>
      </dialog>
    </main>
  )
}

function SentPage() {
  return (
    <main id="feedback-app">
      <div class="full-msg">
        <h2>Feedback Sent</h2>
        <p>You may close this tab</p>
      </div>
    </main>
  )
}

function page(session: FeedbackSession): Response {
  return reply.page(<FeedbackPage session={session} />, {
    title: `Feedback · ${session.title}`,
    head: [
      <meta name="color-scheme" content="dark" />,
      <link rel="stylesheet" href="/assets/style.css" />,
      <script type="module" src="/assets/client.js" />,
      <script type="module" src={DATASTAR_RUNTIME} />,
    ],
  })
}

function buildFeedback(session: FeedbackSession, globalComment: string): string {
  const lines = [`I annotated ${session.source}. Please address this feedback:`]
  session.annotations.forEach((annotation, index) => {
    lines.push("", `${index + 1}. Regarding:`)
    lines.push(...annotation.quote.split("\n").map((line) => `> ${line}`))
    lines.push("", "Comment:", annotation.comment)
  })
  if (globalComment) lines.push("", "Global feedback:", globalComment)
  return lines.join("\n").trim()
}

function createFeedbackApp(pi: ExtensionAPI) {
  const app = new Hono()

  app.use(
    "/sessions/*",
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (context) => context.text("Request body too large.", 413),
    })
  )
  app.get("/assets/style.css", serveStatic({ path: join(EXTENSION_DIR, "style.css") }))
  app.get("/assets/client.js", serveStatic({ path: join(EXTENSION_DIR, "client.js") }))

  app.get("/", (context) => {
    const id = context.req.query("id")
    const session = id === undefined ? undefined : sessions.get(id)
    return session === undefined ? context.text("Not Found", 404) : page(session)
  })

  app.post("/sessions/:sessionId/annotations/add", async (context) => {
    const session = sessions.get(context.req.param("sessionId"))
    if (session === undefined) return context.text("Not Found", 404)

    const parsed = parseForm(await read.signals(context.req.raw))
    if (parsed._tag === "error") {
      return reply.signals(feedbackForm.patch({ error: parsed.message }))
    }
    if (!parsed.value.quote || !parsed.value.comment) {
      return reply.signals(feedbackForm.patch({ error: "Select text and add a comment." }))
    }
    if (
      parsed.value.selectionStart < 0 ||
      parsed.value.selectionEnd <= parsed.value.selectionStart
    ) {
      return reply.signals(feedbackForm.patch({ error: "Select document text again." }))
    }
    session.annotations.push({
      id: randomUUID(),
      quote: parsed.value.quote,
      comment: parsed.value.comment,
      start: parsed.value.selectionStart,
      end: parsed.value.selectionEnd,
    })
    return reply.stream([
      event.signals(
        feedbackForm.patch({
          quote: "",
          comment: "",
          selectionStart: 0,
          selectionEnd: 0,
          dialogOpen: false,
          editingAnnotationId: "",
          editingComment: "",
          annotationCount: session.annotations.length,
          error: "",
        })
      ),
      event.patch(<AnnotationList session={session} />),
    ])
  })

  app.post("/sessions/:sessionId/annotations/:annotationId/edit", async (context) => {
    const session = sessions.get(context.req.param("sessionId"))
    if (session === undefined) return context.text("Not Found", 404)

    const parsed = parseForm(await read.signals(context.req.raw))
    if (parsed._tag === "error") {
      return reply.signals(feedbackForm.patch({ error: parsed.message }))
    }
    if (!parsed.value.editingComment) {
      return reply.signals(feedbackForm.patch({ error: "Add an annotation comment." }))
    }
    const annotationIndex = session.annotations.findIndex(
      (annotation) => annotation.id === context.req.param("annotationId")
    )
    const annotation = session.annotations[annotationIndex]
    if (annotation === undefined) return context.text("Not Found", 404)
    session.annotations[annotationIndex] = {
      ...annotation,
      comment: parsed.value.editingComment,
    }
    return reply.stream([
      event.signals(feedbackForm.patch({ editingAnnotationId: "", editingComment: "", error: "" })),
      event.patch(<AnnotationList session={session} />),
    ])
  })

  app.post("/sessions/:sessionId/annotations/:annotationId/delete", (context) => {
    const session = sessions.get(context.req.param("sessionId"))
    if (session === undefined) return context.text("Not Found", 404)

    session.annotations = session.annotations.filter(
      (annotation) => annotation.id !== context.req.param("annotationId")
    )
    return reply.stream([
      event.signals(
        feedbackForm.patch({
          selectedAnnotationId: "",
          editingAnnotationId: "",
          editingComment: "",
          annotationCount: session.annotations.length,
          error: "",
        })
      ),
      event.patch(<AnnotationList session={session} />),
    ])
  })

  app.post("/sessions/:sessionId/submit-clear", async (context) => {
    const session = sessions.get(context.req.param("sessionId"))
    if (session === undefined) return context.text("Not Found", 404)

    const parsed = parseForm(await read.signals(context.req.raw))
    if (parsed._tag === "error") {
      return reply.signals(feedbackForm.patch({ error: parsed.message }))
    }
    if (session.annotations.length === 0) {
      return reply.signals(feedbackForm.patch({ error: "Add an annotation first." }))
    }
    pi.sendUserMessage(buildFeedback(session, parsed.value.globalComment), {
      deliverAs: "followUp",
    })
    session.annotations = []
    return reply.stream([
      event.signals(
        feedbackForm.patch({
          quote: "",
          comment: "",
          globalComment: "",
          selectionStart: 0,
          selectionEnd: 0,
          dialogOpen: false,
          selectedAnnotationId: "",
          editingAnnotationId: "",
          editingComment: "",
          annotationCount: 0,
          error: "",
        })
      ),
      event.patch(<AnnotationList session={session} />),
    ])
  })

  app.post("/sessions/:sessionId/submit", async (context) => {
    const session = sessions.get(context.req.param("sessionId"))
    if (session === undefined) return context.text("Not Found", 404)

    const parsed = parseForm(await read.signals(context.req.raw))
    if (parsed._tag === "error") {
      return reply.signals(feedbackForm.patch({ error: parsed.message }))
    }
    if (session.annotations.length === 0) {
      return reply.signals(feedbackForm.patch({ error: "Add an annotation first." }))
    }
    pi.sendUserMessage(buildFeedback(session, parsed.value.globalComment), {
      deliverAs: "followUp",
    })
    sessions.delete(session.id)
    return reply.patch(<SentPage />, { selector: "main", mode: "outer" })
  })

  app.notFound((context) => context.text("Not Found", 404))
  app.onError((error, context) => {
    console.error("Feedback request failed", error)
    return context.text("Internal Server Error", 500)
  })

  return app
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function startServer(pi: ExtensionAPI): Promise<number> {
  if (serverPort !== undefined) return Promise.resolve(serverPort)
  if (serverStart !== undefined) return serverStart

  const app = createFeedbackApp(pi)
  serverStart = new Promise((resolvePort, reject) => {
    const httpServer = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (address) => {
      httpServer.off("error", fail)
      serverPort = address.port
      resolvePort(address.port)
    })
    const fail = (error: Error) => {
      server = undefined
      serverPort = undefined
      serverStart = undefined
      reject(error)
    }
    server = httpServer
    httpServer.once("error", fail)
  })
  return serverStart
}

function stopServer(): Promise<void> {
  const current = server
  server = undefined
  serverPort = undefined
  serverStart = undefined
  sessions.clear()
  if (current === undefined) return Promise.resolve()
  return new Promise((resolveStop) => current.close(() => resolveStop()))
}

function openBrowser(url: string): void {
  spawn("open", [url], { detached: true, stdio: "ignore" }).unref()
}

async function openFeedback(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  title: string,
  source: string,
  document: string
): Promise<void> {
  const session = createFeedbackSession(title, source, document)
  const port = await startServer(pi)
  openBrowser(`http://127.0.0.1:${port}/?id=${session.id}`)
  ctx.ui.notify(`Feedback opened: ${title}`, "info")
}

async function openLastFeedback(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  const document = lastAssistantText(ctx)
  if (document === undefined) {
    ctx.ui.notify("No assistant text message found.", "warning")
    return
  }
  await openFeedback(pi, ctx, "Last response", "the previous assistant response", document)
}

/** Registers the server-driven browser feedback commands and shortcut. */
export default function feedback(pi: ExtensionAPI): void {
  pi.on("session_shutdown", stopServer)

  pi.registerShortcut("ctrl+alt+f", {
    description: "Annotate the last assistant response in the browser",
    handler: async (ctx) => {
      try {
        await openLastFeedback(pi, ctx)
      } catch (error) {
        ctx.ui.notify(`Could not open feedback: ${errorMessage(error)}`, "error")
      }
    },
  })

  pi.registerCommand("feedback-last", {
    description: "Annotate the last assistant response in the browser",
    handler: async (_args, ctx) => {
      try {
        await openLastFeedback(pi, ctx)
      } catch (error) {
        ctx.ui.notify(`Could not open feedback: ${errorMessage(error)}`, "error")
      }
    },
  })

  pi.registerCommand("feedback-file", {
    description: "Annotate a text file in the browser",
    handler: async (args, ctx) => {
      const input = args.trim().replace(/^@/, "")
      if (!input) {
        ctx.ui.setEditorText("/feedback-file ")
        ctx.ui.notify("Add a file path and submit again.", "info")
        return
      }
      try {
        const path = resolve(ctx.cwd, input)
        await openFeedback(pi, ctx, basename(path), `file ${path}`, readFileSync(path, "utf8"))
      } catch (error) {
        ctx.ui.notify(`Could not open feedback: ${errorMessage(error)}`, "error")
      }
    },
  })
}
