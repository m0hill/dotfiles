import {
  FileDiff,
  parsePatchFiles,
  type AnnotationSide,
  type DiffLineAnnotation,
  type FileDiffMetadata,
  type FileDiffOptions,
  type ParsedPatch,
  type SelectedLineRange,
} from "@pierre/diffs"
import "./style.css"

// Constants

const DIFF_UNSAFE_CSS = `
:host {
  --diffs-font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --diffs-font-size: 13px;
  --diffs-line-height: 1.62;
  --diffs-header-font-family: Inter, system-ui, sans-serif;
  --diffs-addition-color-override: #22c55e;
  --diffs-deletion-color-override: #ef4444;
  --diffs-selection-color-override: #60a5fa;
  --diffs-bg-selection-override: rgba(96, 165, 250, 0.22);
  --diffs-bg-selection-number-override: rgba(96, 165, 250, 0.45);
}
[data-file] { background: #0f0f0f; }
[data-diffs-header] { background: #111111; border-bottom: 1px solid #262626; }
[data-column-number] { color: #737373; background: #0c0c0c; }
[data-line] { border-bottom: 1px solid rgba(255,255,255,0.025); }
[data-error-wrapper] { background: #111111; color: #F6FFF5; }
`

const MAX_TREE_DEPTH = 6
const DEFAULT_DIFF_SIDE: DiffSide = "additions"

// Types

type DiffSide = AnnotationSide
type DiffStyle = "split" | "unified"
type SelectionAction = "comment" | "ask"

type WorktreeDiffSession = {
  id: string
  title: string
  mode: "worktree"
  patch: string
}

type CommitDiffSession = {
  id: string
  title: string
  mode: "commit"
  commit: string
  patch: string
}

type BaseDiffSession = {
  id: string
  title: string
  mode: "base"
  base: string
  patch: string
}

type DiffSession = WorktreeDiffSession | CommitDiffSession | BaseDiffSession

type FileSelection = {
  file: FileDiffMetadata
  scope: "file"
  quote: string
}

type LineSelection = {
  file: FileDiffMetadata
  scope: "lines"
  range: SelectedLineRange
  side: DiffSide
  start: number
  end: number
  quote: string
}

type Selection = FileSelection | LineSelection

type FileAnnotation = {
  id: string
  file: string
  scope: "file"
  quote: string
  comment: string
}

type LineAnnotation = {
  id: string
  file: string
  scope: "lines"
  side: DiffSide
  start: number
  end: number
  quote: string
  comment: string
}

type Annotation = FileAnnotation | LineAnnotation

type LineAnnotationMetadata = {
  comment: string
}

type LineRange = {
  range: SelectedLineRange
  side: DiffSide
  start: number
  end: number
}

type LocationLabel =
  | { scope: "file" }
  | { scope: "lines"; side?: DiffSide; start?: number; end?: number }

type DiffStats = {
  files: number
  additions: number
  deletions: number
}

type TreeNode = {
  dirs: Map<string, TreeNode>
  files: Array<{ file: FileDiffMetadata; index: number }>
}

type FileIcon = {
  icon: string
  cls: string
  title: string
}

type AppState = {
  review: DiffSession | null
  files: FileDiffMetadata[]
  diffStyle: DiffStyle
  annotations: Annotation[]
  currentSelection: Selection | null
  instances: Array<FileDiff<LineAnnotationMetadata>>
  globalComment: string
  draftComment: string
  draftQuestion: string
}

type AskResponse = {
  ok: boolean
  message?: string
}

// State

const app = getAppElement()
const reviewId = new URLSearchParams(location.search).get("id") ?? ""
const state: AppState = {
  review: null,
  files: [],
  diffStyle: "split",
  annotations: [],
  currentSelection: null,
  instances: [],
  globalComment: "",
  draftComment: "",
  draftQuestion: "",
}

// Generic helpers

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char] ?? char
  )
}

function isLineAnnotation(annotation: Annotation): annotation is LineAnnotation {
  return annotation.scope === "lines"
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// DOM helpers

function getAppElement(): HTMLDivElement {
  const element = document.querySelector<HTMLDivElement>("#app")
  if (!element) throw new Error("Missing #app root element.")
  return element
}

function qs<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector(selector)
  if (!element) throw new Error(`Missing element: ${selector}`)
  return element as T
}

function datasetNumber(element: Element, key: string): number | undefined {
  if (!(element instanceof HTMLElement)) return undefined
  const raw = element.dataset[key]
  if (raw === undefined) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

function setText(selector: string, text: string): void {
  const element = document.querySelector(selector)
  if (element) element.textContent = text
}

// API helpers

function parseDiffSession(value: unknown): DiffSession {
  if (!isRecord(value)) throw new Error("Review response was not an object.")

  const id = stringValue(value.id)
  const title = stringValue(value.title)
  const patch = stringValue(value.patch)
  if (!id || !title || !patch) throw new Error("Review response was missing required fields.")

  switch (value.mode) {
    case "worktree":
      return { id, title, mode: "worktree", patch }
    case "commit": {
      const commit = stringValue(value.commit)
      if (!commit) throw new Error("Commit review response was missing commit.")
      return { id, title, mode: "commit", commit, patch }
    }
    case "base": {
      const base = stringValue(value.base)
      if (!base) throw new Error("Base review response was missing base.")
      return { id, title, mode: "base", base, patch }
    }
    default:
      throw new Error("Review response had an unknown mode.")
  }
}

function parseAskResponse(value: unknown): AskResponse {
  if (!isRecord(value)) throw new Error("Ask response was not an object.")
  return { ok: value.ok === true, message: stringValue(value.message) || undefined }
}

function responseError(value: unknown, fallback: string): string {
  if (isRecord(value)) {
    const error = stringValue(value.error)
    if (error) return error
  }
  return fallback
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init)
  const json = await readJsonResponse(response)
  if (!response.ok)
    throw new Error(responseError(json, `${response.status} ${response.statusText}`))
  return json
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  return await requestJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

// Diff metadata helpers

function review(): DiffSession {
  if (!state.review) throw new Error("Review has not loaded yet.")
  return state.review
}

function fileName(file: FileDiffMetadata): string {
  return file.name || "file"
}

function stats(): DiffStats {
  let additions = 0
  let deletions = 0
  for (const file of state.files) {
    additions += file.additionLines.length
    deletions += file.deletionLines.length
  }
  return { files: state.files.length, additions, deletions }
}

function fileIcon(file: FileDiffMetadata): FileIcon {
  switch (file.type) {
    case "new":
      return { icon: "+", cls: "ico-add", title: "added" }
    case "deleted":
      return { icon: "−", cls: "ico-del", title: "deleted" }
    case "rename-pure":
    case "rename-changed":
      return { icon: "↪", cls: "ico-ren", title: "renamed" }
    default:
      return { icon: "✎", cls: "ico-mod", title: "modified" }
  }
}

function parseFilesFromPatch(session: DiffSession): FileDiffMetadata[] {
  const patches: ParsedPatch[] = parsePatchFiles(session.patch, session.id, false)
  return patches.flatMap((patch) => patch.files)
}

// Selection helpers

function normalizeRange(range: SelectedLineRange | null | undefined): LineRange | null {
  if (!range) return null
  const side = range.side ?? range.endSide ?? DEFAULT_DIFF_SIDE
  return {
    range,
    side,
    start: range.start,
    end: range.end || range.start,
  }
}

function lineLabel(selection: LocationLabel): string {
  if (selection.scope === "file") return "entire file"
  return [
    selection.side,
    selection.start
      ? `lines ${selection.start}${selection.end && selection.end !== selection.start ? `-${selection.end}` : ""}`
      : "",
  ]
    .filter(Boolean)
    .join(" ")
}

function sideClass(side?: DiffSide): string {
  return side === "deletions"
    ? "selection-side-del"
    : side === "additions"
      ? "selection-side-add"
      : "selection-side-neutral"
}

function quoteForRange(file: FileDiffMetadata, side: DiffSide, start: number, end: number): string {
  const rawLines = side === "deletions" ? file.deletionLines : file.additionLines
  if (rawLines.length) {
    const prefix = side === "deletions" ? "-" : "+"
    return rawLines
      .slice(Math.max(0, start - 1), end)
      .map((line) => prefix + line.replace(/\n$/, ""))
      .join("\n")
  }
  return `${fileName(file)} ${lineLabel({ scope: "lines", side, start, end })}`
}

function setLineSelection(file: FileDiffMetadata, range?: SelectedLineRange | null): void {
  const normalized = normalizeRange(range)
  if (!normalized) {
    state.currentSelection = null
    renderEmptySelection()
    return
  }

  state.currentSelection = {
    file,
    scope: "lines",
    range: normalized.range,
    start: normalized.start,
    end: normalized.end,
    side: normalized.side,
    quote: quoteForRange(file, normalized.side, normalized.start, normalized.end),
  }
  renderSelectionChooser()
}

function setFileSelection(file: FileDiffMetadata, preferred: SelectionAction = "comment"): void {
  state.currentSelection = { file, scope: "file", quote: `[entire file diff: ${fileName(file)}]` }
  renderSelectionChooser(preferred)
}

function selectionToAnnotation(selection: Selection, comment: string): Annotation {
  const base = {
    id: crypto.randomUUID(),
    file: fileName(selection.file),
    quote: selection.quote,
    comment,
  }

  return selection.scope === "file"
    ? { ...base, scope: "file" }
    : {
        ...base,
        scope: "lines",
        side: selection.side,
        start: selection.start,
        end: selection.end,
      }
}

// Rendering: shell/files/tree/diffs

function renderShell(): void {
  const currentReview = review()
  const currentStats = stats()
  app.innerHTML = `
    <header id="topbar">
      <div id="topbar-title"><span class="prompt">›</span><div><h1 id="title">DIFF</h1><div id="subtitle">${escapeHtml(currentReview.title)}</div></div></div>
      <div id="topbar-stats"><span>${currentStats.files} files</span><span class="add">+${currentStats.additions}</span><span class="del">-${currentStats.deletions}</span><span>${escapeHtml(currentReview.mode)}</span></div>
      <div id="topbar-actions"><button id="toggle">${state.diffStyle === "split" ? "Unified" : "Split"}</button><button id="send" class="primary">Send Feedback</button></div>
    </header>
    <div id="shell">
      <aside class="sidebar" id="sidebar-left"><div class="sb-head"><span class="sb-label">Files</span><button class="sb-toggle" id="leftToggle">‹</button></div><div class="sb-scroll"><nav id="files"></nav></div></aside>
      <div id="diff-wrap"><div id="diff-bar"><span class="doc-bar-label">Diff</span><span class="hint">drag line numbers for ranges · use file actions for full-file comments</span></div><section id="diffs"></section></div>
      <aside class="sidebar" id="sidebar-right"><div class="sb-head"><span class="sb-label">Diff</span><div class="sb-head-actions"><span class="anno-badge" id="count">0</span><button class="sb-toggle" id="rightToggle">›</button></div></div><div id="sb-right-inner">
        <div class="rsec"><div class="rsec-head"><span class="rsec-label">Global Feedback</span></div><div class="rsec-body"><textarea id="global" placeholder="Overall diff notes…">${escapeHtml(state.globalComment)}</textarea></div></div>
        <div class="rsec"><div class="rsec-head"><span class="rsec-label">Selection</span></div><div id="selection" class="rsec-body"><div class="no-anno">select lines or choose a file action</div></div></div>
        <div class="rsec rsec-annotations"><div class="rsec-head"><span class="rsec-label">Annotations</span></div><div id="anns" class="rsec-body"></div></div>
      </div></aside>
    </div>`

  qs<HTMLButtonElement>("#toggle").addEventListener("click", () => {
    state.globalComment = globalCommentValue()
    state.diffStyle = state.diffStyle === "split" ? "unified" : "split"
    renderShell()
    renderDiffs()
    renderAnnotations()
  })
  qs<HTMLButtonElement>("#send").addEventListener("click", sendFeedback)
  qs<HTMLButtonElement>("#leftToggle").addEventListener("click", () =>
    document.body.classList.toggle("lc")
  )
  qs<HTMLButtonElement>("#rightToggle").addEventListener("click", () =>
    document.body.classList.toggle("rc")
  )
}

function visualDepth(depth: number): number {
  return Math.min(depth, MAX_TREE_DEPTH)
}

function compressDir(name: string, node: TreeNode): { name: string; node: TreeNode } {
  let label = name
  let current = node
  while (current.files.length === 0 && current.dirs.size === 1) {
    const first = current.dirs.entries().next().value
    if (!first) break
    const [childName, childNode] = first
    label += `/${childName}`
    current = childNode
  }
  return { name: label, node: current }
}

function renderTree(node: TreeNode, depth = 0): string {
  const dirs = [...node.dirs.entries()].sort(([a], [b]) => a.localeCompare(b))
  const treeFiles = [...node.files].sort((a, b) => fileName(a.file).localeCompare(fileName(b.file)))
  return [
    ...dirs.map(([name, child]) => {
      const compressed = compressDir(name, child)
      return `<div class="tree-dir" style="--depth:${visualDepth(depth)}" title="${escapeHtml(compressed.name)}"><span class="tree-twist">▾</span><span>${escapeHtml(compressed.name)}</span></div>${renderTree(compressed.node, depth + 1)}`
    }),
    ...treeFiles.map(({ file, index }) => {
      const icon = fileIcon(file)
      const name = fileName(file)
      const base = name.split("/").pop() || name
      const adds = file.additionLines.length
      const dels = file.deletionLines.length
      const stat = `${adds ? `<span class="add">+${adds}</span>` : ""}${dels ? `<span class="del">-${dels}</span>` : ""}`
      return `<a class="tree-file" style="--depth:${visualDepth(depth)}" href="#file-${index}" title="${escapeHtml(name)}"><span class="file-ico ${icon.cls}" title="${icon.title}">${icon.icon}</span><span class="tree-name">${escapeHtml(base)}</span><span class="tree-stat">${stat}</span></a>`
    }),
  ].join("")
}

function renderFileList(): void {
  const root: TreeNode = { dirs: new Map(), files: [] }
  state.files.forEach((file, index) => {
    const parts = fileName(file).split("/").filter(Boolean)
    let node = root
    for (const part of parts.slice(0, -1)) {
      let child = node.dirs.get(part)
      if (!child) {
        child = { dirs: new Map(), files: [] }
        node.dirs.set(part, child)
      }
      node = child
    }
    node.files.push({ file, index })
  })
  qs<HTMLElement>("#files").innerHTML = renderTree(root)
}

function makeOptions(file: FileDiffMetadata): FileDiffOptions<LineAnnotationMetadata> {
  return {
    theme: { dark: "github-dark-default", light: "github-light-default" },
    themeType: "dark",
    unsafeCSS: DIFF_UNSAFE_CSS,
    diffStyle: state.diffStyle,
    diffIndicators: "bars",
    hunkSeparators: "line-info-basic",
    overflow: "wrap",
    enableLineSelection: true,
    enableGutterUtility: true,
    lineHoverHighlight: "both",
    onLineSelected(range) {
      setLineSelection(file, range)
    },
    onLineSelectionEnd(range) {
      setLineSelection(file, range)
    },
    onGutterUtilityClick(range) {
      setLineSelection(file, range)
    },
    renderAnnotation(annotation) {
      const div = document.createElement("div")
      div.className = "inline-ann"
      div.textContent = annotation.metadata.comment || "Annotation"
      return div
    },
  }
}

function lineAnnotationsFor(
  file: FileDiffMetadata
): Array<DiffLineAnnotation<LineAnnotationMetadata>> {
  const name = fileName(file)
  return state.annotations.filter(isLineAnnotation).flatMap((annotation) =>
    annotation.file === name
      ? [
          {
            side: annotation.side,
            lineNumber: annotation.start,
            metadata: { comment: annotation.comment },
          },
        ]
      : []
  )
}

function renderDiffs(): void {
  state.instances.forEach((instance) => instance.cleanUp())
  state.instances.length = 0
  renderFileList()

  const root = qs<HTMLElement>("#diffs")
  root.innerHTML = ""
  state.files.forEach((file, index) => {
    const outer = document.createElement("div")
    outer.className = "file-wrap"
    outer.id = `file-${index}`
    outer.innerHTML = `<div class="file-top"><strong>${escapeHtml(fileName(file))}</strong><div class="file-top-actions"><button data-comment>Comment file</button><button data-ask>Ask about file</button></div></div><div class="diff-mount"></div>`
    root.appendChild(outer)

    qs<HTMLButtonElement>("[data-comment]", outer).addEventListener("click", () =>
      setFileSelection(file, "comment")
    )
    qs<HTMLButtonElement>("[data-ask]", outer).addEventListener("click", () =>
      setFileSelection(file, "ask")
    )

    const mount = qs<HTMLElement>(".diff-mount", outer)
    mount.style.setProperty("--diffs-bg", "#0f0f0f")
    mount.style.setProperty("--diffs-fg", "#F6FFF5")

    const instance = new FileDiff<LineAnnotationMetadata>(makeOptions(file))
    state.instances.push(instance)
    instance.render({
      fileDiff: file,
      containerWrapper: mount,
      lineAnnotations: lineAnnotationsFor(file),
    })
  })
}

// Rendering: selection/actions/annotations

function renderEmptySelection(): void {
  const selection = document.querySelector("#selection")
  if (selection)
    selection.innerHTML = '<div class="no-anno">select lines or choose a file action</div>'
}

function selectionDetailsHtml(selection: Selection): string {
  const name = fileName(selection.file)
  if (selection.scope === "file") {
    return `<div class="selection-meta">
      <div class="selection-row"><span>Scope</span><strong class="selection-scope">Entire file</strong></div>
      <div class="selection-row"><span>File</span><code title="${escapeHtml(name)}">${escapeHtml(name)}</code></div>
    </div>`
  }

  const lines = `${selection.start}${selection.end !== selection.start ? `–${selection.end}` : ""}`
  return `<div class="selection-meta">
    <div class="selection-row"><span>File</span><code title="${escapeHtml(name)}">${escapeHtml(name)}</code></div>
    <div class="selection-row"><span>Side</span><strong class="selection-side ${sideClass(selection.side)}">${escapeHtml(selection.side)}</strong></div>
    <div class="selection-row"><span>Lines</span><strong>${escapeHtml(lines)}</strong></div>
  </div>${selection.quote ? `<div class="quote selection-quote">${escapeHtml(selection.quote)}</div>` : ""}`
}

function renderSelectionChooser(preferred: SelectionAction = "comment"): void {
  const selection = qs<HTMLElement>("#selection")
  if (!state.currentSelection) {
    renderEmptySelection()
    return
  }

  selection.innerHTML = `<div class="selection-card">${selectionDetailsHtml(state.currentSelection)}<div class="mode-switch" role="tablist" aria-label="Selection action"><button id="chooseComment" class="mode-option" type="button">Comment</button><button id="chooseAsk" class="mode-option" type="button">Ask Pi</button></div><div id="actionBox"></div></div>`
  qs<HTMLButtonElement>("#chooseComment").addEventListener("click", () => {
    setMode("comment")
    renderCommentBox()
  })
  qs<HTMLButtonElement>("#chooseAsk").addEventListener("click", () => {
    setMode("ask")
    renderAskBox()
  })

  if (preferred === "ask") {
    setMode("ask")
    renderAskBox()
  } else {
    setMode("comment")
    renderCommentBox()
  }
}

function setMode(mode: SelectionAction): void {
  document.querySelector("#chooseComment")?.classList.toggle("active", mode === "comment")
  document.querySelector("#chooseAsk")?.classList.toggle("active", mode === "ask")
}

function renderCommentBox(): void {
  const box = qs<HTMLElement>("#actionBox")
  box.innerHTML = `<textarea id="comment" class="comment-editor" placeholder="Add a diff comment…">${escapeHtml(state.draftComment)}</textarea><button id="add" class="primary">Add Annotation</button>`
  const input = qs<HTMLTextAreaElement>("#comment")
  input.addEventListener("input", () => {
    state.draftComment = input.value
  })
  qs<HTMLButtonElement>("#add").addEventListener("click", addAnnotation)
}

function renderAskBox(): void {
  const box = qs<HTMLElement>("#actionBox")
  box.innerHTML = `<textarea id="question" placeholder="Ask Pi about this selection…">${escapeHtml(state.draftQuestion)}</textarea><button id="ask" class="primary">Ask Pi</button><div id="askStatus" class="hint"></div>`
  const input = qs<HTMLTextAreaElement>("#question")
  input.addEventListener("input", () => {
    state.draftQuestion = input.value
  })
  qs<HTMLButtonElement>("#ask").addEventListener("click", askPi)
}

function clearSelectionInputs(): void {
  state.draftComment = ""
  state.draftQuestion = ""
  const comment = document.querySelector<HTMLTextAreaElement>("#comment")
  const question = document.querySelector<HTMLTextAreaElement>("#question")
  if (comment) comment.value = ""
  if (question) question.value = ""
  setText("#askStatus", "")
}

function annotationTone(annotation: Annotation): string {
  if (annotation.scope === "file") return "annotation-file"
  if (annotation.side === "deletions") return "annotation-del"
  if (annotation.side === "additions") return "annotation-add"
  return "annotation-neutral"
}

function crossIcon(): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>`
}

function pencilIcon(): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`
}

function renderAnnotations(): void {
  setText("#count", String(state.annotations.length))
  const root = document.querySelector("#anns")
  if (!root) return

  root.innerHTML =
    state.annotations
      .map(
        (annotation, index) =>
          `<div class="card annotation-card ${annotationTone(annotation)}" role="button" tabindex="0" data-jump="${index}"><button data-del="${index}" class="icon-btn close-btn" aria-label="Delete annotation">${crossIcon()}</button><div class="anno-top"><span class="anno-file" title="${escapeHtml(annotation.file)}">${escapeHtml(annotation.file)}</span></div><div class="anno-loc">${escapeHtml(lineLabel(annotation))}</div><div class="anno-comment-wrap"><button data-edit="${index}" class="icon-btn edit-btn" aria-label="Edit annotation">${pencilIcon()}</button><div class="comment anno-comment">${escapeHtml(annotation.comment)}</div></div></div>`
      )
      .join("") || '<div class="no-anno">no annotations yet</div>'

  root.querySelectorAll("[data-jump]").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (
        event.target instanceof Element &&
        event.target.closest("[data-del],[data-edit],.edit-annotation-input,.edit-actions")
      ) {
        return
      }
      jumpToAnnotation(state.annotations[datasetNumber(card, "jump") ?? -1])
    })
    card.addEventListener("keydown", (event) => {
      if (event instanceof KeyboardEvent && event.key === "Enter") {
        jumpToAnnotation(state.annotations[datasetNumber(card, "jump") ?? -1])
      }
    })
  })

  root.querySelectorAll("[data-del]").forEach((button) =>
    button.addEventListener("click", () => {
      const index = datasetNumber(button, "del")
      if (index === undefined) return
      state.annotations.splice(index, 1)
      renderAnnotations()
      renderDiffs()
    })
  )

  root.querySelectorAll("[data-edit]").forEach((button) =>
    button.addEventListener("click", () => {
      const index = datasetNumber(button, "edit")
      if (index !== undefined) editAnnotation(index)
    })
  )
}

// Actions

function globalCommentValue(): string {
  return document.querySelector<HTMLTextAreaElement>("#global")?.value ?? state.globalComment
}

function addAnnotation(): void {
  if (!state.currentSelection) return
  const comment = qs<HTMLTextAreaElement>("#comment").value.trim()
  if (!comment) return

  state.annotations.push(selectionToAnnotation(state.currentSelection, comment))
  renderAnnotations()
  renderDiffs()
  clearSelectionInputs()
}

function editAnnotation(index: number): void {
  const annotation = state.annotations[index]
  if (!annotation) return

  const card = document.querySelector(`[data-edit="${index}"]`)?.closest(".annotation-card")
  const wrap = card?.querySelector<HTMLElement>(".anno-comment-wrap")
  if (!wrap) return

  wrap.innerHTML = `<textarea class="edit-annotation-input" wrap="soft">${escapeHtml(annotation.comment)}</textarea><div class="edit-actions"><button data-cancel-edit>Cancel</button><button data-save-edit class="primary">Save</button></div>`
  const input = qs<HTMLTextAreaElement>("textarea", wrap)
  input.focus()
  input.setSelectionRange(input.value.length, input.value.length)
  qs<HTMLButtonElement>("[data-cancel-edit]", wrap).onclick = renderAnnotations
  qs<HTMLButtonElement>("[data-save-edit]", wrap).onclick = () => {
    const comment = input.value.trim()
    if (!comment) return
    annotation.comment = comment
    renderAnnotations()
    renderDiffs()
  }
}

function jumpToAnnotation(annotation: Annotation | undefined): void {
  if (!annotation) return
  const index = state.files.findIndex((file) => fileName(file) === annotation.file)
  if (index < 0) return
  document.querySelector(`#file-${index}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
}

async function sendFeedback(): Promise<void> {
  state.globalComment = globalCommentValue().trim()
  if (!state.annotations.length && !state.globalComment) {
    alert("Add annotations or global feedback first.")
    return
  }

  try {
    await postJson("/api/feedback", {
      id: review().id,
      annotations: state.annotations,
      globalComment: state.globalComment,
    })
    alert("Feedback sent to Pi.")
  } catch (error) {
    alert(`Feedback failed: ${errorMessage(error)}`)
  }
}

async function askPi(): Promise<void> {
  const selection = state.currentSelection
  if (!selection) return

  const question = qs<HTMLTextAreaElement>("#question").value.trim()
  if (!question) return

  try {
    const response = parseAskResponse(
      await postJson("/api/ask", {
        id: review().id,
        file: fileName(selection.file),
        scope: selection.scope,
        side: selection.scope === "lines" ? selection.side : undefined,
        start: selection.scope === "lines" ? selection.start : undefined,
        end: selection.scope === "lines" ? selection.end : undefined,
        quote: selection.quote,
        question,
      })
    )
    setText("#askStatus", response.message || "Question sent to Pi. Check the terminal.")
    state.draftQuestion = ""
  } catch (error) {
    setText("#askStatus", `Ask failed: ${errorMessage(error)}`)
  }
}

// Boot

async function boot(): Promise<void> {
  app.innerHTML =
    '<div class="loading"><div class="dot"></div><div class="dot"></div><div class="dot"></div><span>loading diff…</span></div>'
  state.review = parseDiffSession(
    await requestJson(`/api/review?id=${encodeURIComponent(reviewId)}`)
  )
  state.files = parseFilesFromPatch(state.review)
  renderShell()
  renderDiffs()
  renderAnnotations()
}

boot().catch((error) => {
  app.innerHTML = `<pre class="full-msg">${escapeHtml(errorMessage(error))}</pre>`
})
