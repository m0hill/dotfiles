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
import {
  event,
  js,
  local,
  mod,
  post,
  read,
  reply,
  state,
  unsafeHtml,
  type SignalState,
} from "datastar-kit"
import { bodyLimit } from "hono/body-limit"
import { Hono } from "hono/tiny"
import { Type, type Static, type TSchema } from "typebox"
import { ParseError, Value } from "typebox/value"

const DATASTAR_RUNTIME =
  "https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.2/bundles/datastar.js"
const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url))

const feedbackForm = state({
  quote: "",
  comment: "",
  globalComment: "",
  title: "",
  selectionStart: 0,
  selectionEnd: 0,
  dialogOpen: false,
  selectedAnnotationId: "",
  editingAnnotationId: "",
  editingComment: "",
  annotationCount: 0,
  indexCollapsed: false,
  annotationMode: true,
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
  title: string
  readonly source: string
  readonly rendered: RenderedMarkdown
  annotations: Annotation[]
}

const newAnnotationSchema = Type.Object({
  quote: Type.String(),
  comment: Type.String(),
  selectionStart: Type.Integer({ minimum: 0 }),
  selectionEnd: Type.Integer({ minimum: 1 }),
})

const annotationCommentSchema = Type.Object({ editingComment: Type.String() })
const submitFeedbackSchema = Type.Object({ globalComment: Type.String() })
const feedbackTitleSchema = Type.Object({ title: Type.String({ maxLength: 60 }) })

type NewAnnotation = Static<typeof newAnnotationSchema>
type AnnotationComment = Static<typeof annotationCommentSchema>
type SubmitFeedback = Static<typeof submitFeedbackSchema>
type FeedbackTitle = Static<typeof feedbackTitleSchema>

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

function parseSignals<const Schema extends TSchema>(
  schema: Schema,
  input: SignalState
): ParseResult<Static<Schema>> {
  try {
    return { _tag: "ok", value: Value.Parse(schema, input) }
  } catch (error) {
    if (error instanceof ParseError) {
      return { _tag: "error", message: "Invalid feedback form." }
    }
    throw error
  }
}

function parseNewAnnotation(input: SignalState): ParseResult<NewAnnotation> {
  const parsed = parseSignals(newAnnotationSchema, input)
  if (parsed._tag === "error") return parsed

  const value = {
    ...parsed.value,
    quote: parsed.value.quote.trim(),
    comment: parsed.value.comment.trim(),
  }
  if (!value.quote || !value.comment) {
    return { _tag: "error", message: "Select text and add a comment." }
  }
  if (value.selectionEnd <= value.selectionStart) {
    return { _tag: "error", message: "Select document text again." }
  }
  return { _tag: "ok", value }
}

function parseAnnotationComment(input: SignalState): ParseResult<AnnotationComment> {
  const parsed = parseSignals(annotationCommentSchema, input)
  if (parsed._tag === "error") return parsed

  const editingComment = parsed.value.editingComment.trim()
  return editingComment
    ? { _tag: "ok", value: { editingComment } }
    : { _tag: "error", message: "Add an annotation comment." }
}

function parseSubmitFeedback(input: SignalState): ParseResult<SubmitFeedback> {
  const parsed = parseSignals(submitFeedbackSchema, input)
  return parsed._tag === "error"
    ? parsed
    : { _tag: "ok", value: { globalComment: parsed.value.globalComment.trim() } }
}

function parseFeedbackTitle(input: SignalState): ParseResult<FeedbackTitle> {
  const parsed = parseSignals(feedbackTitleSchema, input)
  if (parsed._tag === "error") return parsed

  const title = parsed.value.title.trim()
  return title ? { _tag: "ok", value: { title } } : { _tag: "error", message: "Add a title." }
}

function defaultFeedbackTitle(folder: string, now = new Date()): string {
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":")
  return `${folder || "feedback"} · ${time}`
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
            const updating = local<boolean>(`annotationBusy${index}`)
            const isSelected = js<boolean>`${feedbackForm.refs.selectedAnnotationId} === ${annotation.id}`
            const isEditing = js<boolean>`${feedbackForm.refs.editingAnnotationId} === ${annotation.id}`
            const isNotEditing = js<boolean>`${feedbackForm.refs.editingAnnotationId} !== ${annotation.id}`
            const selectAnnotation = js<void>`if (!evt.target.closest?.("button, textarea")) { ${feedbackForm.refs.selectedAnnotationId} = ${annotation.id}; window.feedback.activate(${annotation.start}, ${annotation.end}) }`
            const startEditing = js<void>`${feedbackForm.refs.editingAnnotationId} = ${annotation.id}; ${feedbackForm.refs.editingComment} = ${annotation.comment}; ${feedbackForm.refs.error} = ""`
            const cancelEditing = js<void>`${feedbackForm.refs.editingAnnotationId} = ""; ${feedbackForm.refs.editingComment} = ""; ${feedbackForm.refs.error} = ""`
            const editDisabled = js<boolean>`${feedbackForm.refs.editingComment}.trim() === "" || ${updating}`
            const saveLabel = js<string>`${updating} ? "Saving…" : "Save"`
            return (
              <article
                class="annotation-card"
                id={`annotation-${annotation.id}`}
                data-class:active={isSelected}
                data-on:click={selectAnnotation}
              >
                <button
                  class="button icon-button delete-button close-btn"
                  type="button"
                  title="Delete annotation"
                  aria-label="Delete annotation"
                  data-indicator={updating}
                  data-class:busy={updating}
                  data-attr:disabled={updating}
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
                      class="button icon-button edit-btn"
                      type="button"
                      title="Edit annotation"
                      aria-label="Edit annotation"
                      data-on:click={startEditing}
                    >
                      <span class="edit-icon" aria-hidden="true" />
                    </button>
                    <p class="anno-comment">{annotation.comment}</p>
                  </div>
                  <div data-show={isEditing}>
                    <textarea
                      class="field-input edit-annotation-input"
                      aria-label="Edit annotation comment"
                      data-bind={feedbackForm.refs.editingComment}
                    />
                    <div class="edit-actions">
                      <button
                        class="button button-secondary"
                        type="button"
                        data-on:click={cancelEditing}
                      >
                        Cancel
                      </button>
                      <button
                        class="button button-primary"
                        type="button"
                        data-indicator={updating}
                        data-class:busy={updating}
                        data-attr:disabled={editDisabled}
                        data-on:click={post(
                          `/sessions/${props.session.id}/annotations/${annotation.id}/edit`
                        )}
                      >
                        <span data-text={saveLabel}>Save</span>
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
  const submitting = local<boolean>("submittingFeedback")
  const clearing = local<boolean>("submittingAndClearing")
  const adding = local<boolean>("addingAnnotation")
  const sendDisabled = js<boolean>`${feedbackForm.refs.annotationCount} === 0 || ${submitting} || ${clearing}`
  const addDisabled = js<boolean>`${feedbackForm.refs.quote}.trim() === "" || ${feedbackForm.refs.comment}.trim() === "" || ${adding}`
  const submitLabel = js<string>`${submitting} ? "Sending…" : "Send Feedback"`
  const clearLabel = js<string>`${clearing} ? "Sending…" : "Send & Clear"`
  const addLabel = js<string>`${adding} ? "Adding…" : "Add"`
  const captureSelection = js<void>`if (${feedbackForm.refs.annotationMode}) { const selected = window.feedback.capture(el); if (selected) { ${feedbackForm.refs.quote} = selected.quote; ${feedbackForm.refs.selectionStart} = selected.start; ${feedbackForm.refs.selectionEnd} = selected.end; ${feedbackForm.refs.error} = ""; ${feedbackForm.refs.dialogOpen} = true } }`
  const syncDialog = js<void>`${feedbackForm.refs.dialogOpen} ? window.feedback.open(el) : (el.open && el.close())`
  const closeDialog = js<void>`${feedbackForm.refs.dialogOpen} = false; ${feedbackForm.refs.error} = ""`
  const useSelectMode = js<void>`${feedbackForm.refs.annotationMode} = false; ${feedbackForm.refs.dialogOpen} = false; ${feedbackForm.refs.error} = ""`
  const useAnnotationMode = js<void>`${feedbackForm.refs.annotationMode} = true`
  const selectingText = js<boolean>`!${feedbackForm.refs.annotationMode}`
  const toggleIndex = js<void>`${feedbackForm.refs.indexCollapsed} = !${feedbackForm.refs.indexCollapsed}`
  const indexExpanded = js<boolean>`!${feedbackForm.refs.indexCollapsed}`
  const indexToggleIcon = js<string>`${feedbackForm.refs.indexCollapsed} ? "›" : "‹"`

  return (
    <main
      id="feedback-app"
      data-signals={mod(
        {
          ...feedbackForm.defaults,
          title: props.session.title,
          annotationCount: props.session.annotations.length,
          indexCollapsed: props.session.rendered.headings.length === 0,
        },
        { ifMissing: true }
      )}
    >
      <header class="app-header">
        <div class="app-header-content">
          <div class="app-identity">
            <span class="app-mark" aria-hidden="true">
              ›
            </span>
            <form class="title-form" data-on:submit={post(`/sessions/${props.session.id}/title`)}>
              <input
                class="app-title"
                type="text"
                aria-label="Feedback title"
                title="Rename this feedback tab"
                maxlength="60"
                required
                data-bind={feedbackForm.refs.title}
              />
              <button class="button title-save" type="submit">
                Save
              </button>
            </form>
            <div class="selection-mode" role="group" aria-label="Text selection behavior">
              <button
                class="selection-mode-option"
                type="button"
                title="Select and copy text without opening feedback"
                data-class:active={selectingText}
                data-attr:aria-pressed={selectingText}
                data-on:click={useSelectMode}
              >
                Select
              </button>
              <button
                class="selection-mode-option"
                type="button"
                title="Select text to add an annotation"
                data-class:active={feedbackForm.refs.annotationMode}
                data-attr:aria-pressed={feedbackForm.refs.annotationMode}
                data-on:click={useAnnotationMode}
              >
                Annotate
              </button>
            </div>
          </div>
          <div class="app-actions">
            <button
              class="button button-secondary"
              type="button"
              data-indicator={clearing}
              data-class:busy={clearing}
              data-attr:disabled={sendDisabled}
              data-on:click={post(`/sessions/${props.session.id}/submit-clear`)}
            >
              <span data-text={clearLabel}>Send & Clear</span>
            </button>
            <button
              class="button button-primary"
              type="button"
              data-indicator={submitting}
              data-class:busy={submitting}
              data-attr:disabled={sendDisabled}
              data-on:click={post(`/sessions/${props.session.id}/submit`)}
            >
              <span data-text={submitLabel}>Send Feedback</span>
            </button>
          </div>
        </div>
      </header>

      <div id="shell" data-class:index-collapsed={feedbackForm.refs.indexCollapsed}>
        <aside id="sidebar-left" class="sidebar">
          <div class="sb-head">
            <span class="sb-label">Index</span>
            <button
              class="button icon-button sidebar-toggle"
              type="button"
              title="Toggle index sidebar"
              aria-label="Toggle index sidebar"
              data-attr:aria-expanded={indexExpanded}
              data-on:click={toggleIndex}
            >
              <span aria-hidden="true" data-text={indexToggleIcon}>
                ‹
              </span>
            </button>
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
          <article
            id="doc"
            data-class:annotation-mode={feedbackForm.refs.annotationMode}
            data-on:mouseup={captureSelection}
          >
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
                class="field-input"
                aria-label="Global feedback"
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
            class="button icon-button dialog-close"
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
            class="field-input"
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
            <button class="button button-secondary" type="button" data-on:click={closeDialog}>
              Cancel
            </button>
            <button
              class="button button-primary"
              type="button"
              data-indicator={adding}
              data-class:busy={adding}
              data-attr:disabled={addDisabled}
              data-on:click={post(`/sessions/${props.session.id}/annotations/add`)}
            >
              <span data-text={addLabel}>Add</span>
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
    title: `${session.title} · Feedback`,
    head: [
      <meta name="viewport" content="width=device-width, initial-scale=1" />,
      <meta name="color-scheme" content="dark" />,
      <meta name="referrer" content="no-referrer" />,
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

  app.post("/sessions/:sessionId/title", async (context) => {
    const session = sessions.get(context.req.param("sessionId"))
    if (session === undefined) return context.text("Not Found", 404)

    const parsed = parseFeedbackTitle(await read.signals(context.req.raw))
    if (parsed._tag === "error") {
      return reply.signals(feedbackForm.patch({ title: session.title, error: parsed.message }))
    }
    session.title = parsed.value.title
    return reply.stream([
      event.signals(feedbackForm.patch({ title: session.title, error: "" })),
      event.patch(<title>{`${session.title} · Feedback`}</title>, { selector: "title" }),
    ])
  })

  app.post("/sessions/:sessionId/annotations/add", async (context) => {
    const session = sessions.get(context.req.param("sessionId"))
    if (session === undefined) return context.text("Not Found", 404)

    const parsed = parseNewAnnotation(await read.signals(context.req.raw))
    if (parsed._tag === "error") {
      return reply.signals(feedbackForm.patch({ error: parsed.message }))
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

    const parsed = parseAnnotationComment(await read.signals(context.req.raw))
    if (parsed._tag === "error") {
      return reply.signals(feedbackForm.patch({ error: parsed.message }))
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

    const parsed = parseSubmitFeedback(await read.signals(context.req.raw))
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

    const parsed = parseSubmitFeedback(await read.signals(context.req.raw))
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
  await openFeedback(
    pi,
    ctx,
    defaultFeedbackTitle(basename(ctx.cwd)),
    "the previous assistant response",
    document
  )
}

async function reportOpenFailure(ctx: ExtensionContext, open: () => Promise<void>): Promise<void> {
  try {
    await open()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ctx.ui.notify(`Could not open feedback: ${message}`, "error")
  }
}

/** Registers the server-driven browser feedback commands and shortcut. */
export default function feedback(pi: ExtensionAPI): void {
  pi.on("session_shutdown", stopServer)

  pi.registerShortcut("ctrl+alt+f", {
    description: "Annotate the last assistant response in the browser",
    handler: (ctx) => reportOpenFailure(ctx, () => openLastFeedback(pi, ctx)),
  })

  pi.registerCommand("feedback-last", {
    description: "Annotate the last assistant response in the browser",
    handler: (_args, ctx) => reportOpenFailure(ctx, () => openLastFeedback(pi, ctx)),
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
      await reportOpenFailure(ctx, async () => {
        const path = resolve(ctx.cwd, input)
        await openFeedback(
          pi,
          ctx,
          defaultFeedbackTitle(basename(dirname(path))),
          `file ${path}`,
          readFileSync(path, "utf8")
        )
      })
    },
  })
}
