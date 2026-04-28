const LEFT_COLLAPSED_CLASS = "is-left-collapsed",
  RIGHT_COLLAPSED_CLASS = "is-right-collapsed"

const params = new URLSearchParams(location.search),
  id = params.get("id")
const docEl = document.getElementById("doc"),
  titleEl = document.getElementById("title")
const sourceEl = document.getElementById("source"),
  popover = document.getElementById("popover")
const selPreview = document.getElementById("selPreview"),
  commentInput = document.getElementById("commentInput")
const annotationsEl = document.getElementById("annotations"),
  countEl = document.getElementById("count"),
  copySelectionBtn = document.getElementById("copySelectionBtn")
let annotations = [],
  selectedQuote = "",
  selectedRange = null,
  annotationHighlight = null,
  activeAnnotationHighlight = null,
  activeAnnotationIndex = null,
  annotationAnchors = []

function updateToggles() {
  const leftCollapsed = document.body.classList.contains(LEFT_COLLAPSED_CLASS),
    rightCollapsed = document.body.classList.contains(RIGHT_COLLAPSED_CLASS)
  document.getElementById("leftToggle").textContent = leftCollapsed ? "›" : "‹"
  document.getElementById("rightToggle").textContent = rightCollapsed ? "‹" : "›"
}
document.getElementById("leftToggle").onclick = () => {
  document.body.classList.toggle(LEFT_COLLAPSED_CLASS)
  localStorage.setItem("ann-lc", document.body.classList.contains(LEFT_COLLAPSED_CLASS) ? "1" : "0")
  updateToggles()
}
document.getElementById("rightToggle").onclick = () => {
  document.body.classList.toggle(RIGHT_COLLAPSED_CLASS)
  localStorage.setItem(
    "ann-rc",
    document.body.classList.contains(RIGHT_COLLAPSED_CLASS) ? "1" : "0"
  )
  updateToggles()
}
if (localStorage.getItem("ann-lc") === "1") document.body.classList.add(LEFT_COLLAPSED_CLASS)
if (localStorage.getItem("ann-rc") === "1") document.body.classList.add(RIGHT_COLLAPSED_CLASS)
updateToggles()

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])
}
function inlineMd(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer">$1</a>'
    )
}
function renderParagraph(lines) {
  return lines.length ? `<p>${inlineMd(lines.join("\n")).replace(/\n/g, "<br>")}</p>` : ""
}
function renderMd(md) {
  const out = []
  let para = []
  let list = null
  let quote = []
  let code = []
  let inCode = false
  const flushPara = () => {
    const html = renderParagraph(para)
    if (html) out.push(html)
    para = []
  }
  const flushList = () => {
    if (list)
      out.push(
        `<${list.type}>${list.items.map((x) => `<li>${inlineMd(x)}</li>`).join("")}</${list.type}>`
      )
    list = null
  }
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote>${quote.map(inlineMd).join("<br>")}</blockquote>`)
    quote = []
  }
  for (const raw of String(md).split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "")
    if (line.startsWith("```")) {
      if (inCode) {
        out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`)
        code = []
        inCode = false
      } else {
        flushPara()
        flushList()
        flushQuote()
        inCode = true
      }
      continue
    }
    if (inCode) {
      code.push(raw)
      continue
    }
    if (!line.trim()) {
      flushPara()
      flushList()
      flushQuote()
      continue
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      flushPara()
      flushList()
      flushQuote()
      out.push(`<h${heading[1].length}>${inlineMd(heading[2])}</h${heading[1].length}>`)
      continue
    }
    if (/^---+$/.test(line)) {
      flushPara()
      flushList()
      flushQuote()
      out.push("<hr>")
      continue
    }
    const quoted = /^>\s?(.*)$/.exec(line)
    if (quoted) {
      flushPara()
      flushList()
      quote.push(quoted[1])
      continue
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line)
    const ordered = /^\d+[.)]\s+(.+)$/.exec(line)
    if (bullet || ordered) {
      flushPara()
      flushQuote()
      const type = bullet ? "ul" : "ol"
      if (!list || list.type !== type) {
        flushList()
        list = { type, items: [] }
      }
      list.items.push((bullet || ordered)[1])
      continue
    }
    flushList()
    flushQuote()
    para.push(line)
  }
  flushPara()
  flushList()
  flushQuote()
  if (inCode) out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`)
  return out.join("\n")
}
function slugify(t, m) {
  const b =
    t
      .toLowerCase()
      .replace(/<[^>]+>/g, "")
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-") || "h"
  const n = m.get(b) || 0
  m.set(b, n + 1)
  return n ? `${b}-${n}` : b
}

function buildTOC() {
  const toc = document.getElementById("toc"),
    hs = [...docEl.querySelectorAll("h1,h2,h3,h4,h5,h6")]
  if (!hs.length) {
    toc.innerHTML = '<div class="toc-empty">no headings</div>'
    return
  }
  const m = new Map()
  toc.innerHTML = hs
    .map((h) => {
      const l = +h.tagName[1]
      if (!h.id) h.id = slugify(h.textContent || "h", m)
      return `<a href="#${h.id}" data-level="${l}" title="${esc(h.textContent)}">${esc(h.textContent)}</a>`
    })
    .join("")
}

function renderAnnotations() {
  countEl.textContent = annotations.length
  if (!annotations.length) {
    annotationsEl.innerHTML = '<div class="no-anno">no annotations yet</div>'
    return
  }
  annotationsEl.innerHTML = annotations
    .map(
      (a, i) => `
    <div class="card annotation-card ${activeAnnotationIndex === i ? "active" : ""}" role="button" tabindex="0" data-jump="${i}">
      <button data-i="${i}" class="icon-btn close-btn" aria-label="Delete annotation">${crossIcon()}</button>
      <div class="anno-top"><span class="anno-file">#${String(i + 1).padStart(2, "0")}</span></div>
      ${a.quote ? `<div class="quote anno-quote">${esc(a.quote.length > 280 ? a.quote.slice(0, 280) + "…" : a.quote)}</div>` : ""}
      ${a.comment ? `<div class="anno-comment-wrap"><button data-edit="${i}" class="icon-btn edit-btn" aria-label="Edit annotation">${pencilIcon()}</button><div class="comment anno-comment">${esc(a.comment)}</div></div>` : ""}
    </div>`
    )
    .join("")
  annotationsEl.querySelectorAll("[data-jump]").forEach((card) => {
    card.onclick = (event) => {
      if (event.target.closest("button,.edit-annotation-input,.edit-actions")) return
      jumpToAnnotation(+card.dataset.jump)
    }
    card.onkeydown = (event) => {
      if (event.key === "Enter") jumpToAnnotation(+card.dataset.jump)
    }
  })
  annotationsEl.querySelectorAll("[data-i]").forEach((b) => {
    b.onclick = () => {
      const index = +b.dataset.i
      annotations.splice(index, 1)
      annotationAnchors.splice(index, 1)
      if (activeAnnotationIndex === index) activeAnnotationIndex = null
      else if (activeAnnotationIndex > index) activeAnnotationIndex--
      rebuildHighlights()
      renderAnnotations()
    }
  })
  annotationsEl.querySelectorAll("[data-edit]").forEach((b) => {
    b.onclick = () => editAnnotation(+b.dataset.edit)
  })
}

function jumpToAnnotation(index) {
  const range = annotationAnchors[index]
  if (!range) return
  activeAnnotationIndex = index
  setActiveHighlight(range)
  renderAnnotations()
  const rect = range.getBoundingClientRect()
  const scroller = document.getElementById("doc-wrap")
  const scrollerRect = scroller.getBoundingClientRect()
  const target = rect.top - scrollerRect.top + scroller.scrollTop - 96
  scroller.scrollTo({ top: Math.max(0, target), behavior: "smooth" })
}

function rebuildHighlights() {
  if (!CSS.highlights || !window.Highlight) return
  annotationHighlight = new Highlight(...annotationAnchors)
  CSS.highlights.set("annotation-highlight", annotationHighlight)
  if (activeAnnotationIndex == null || !annotationAnchors[activeAnnotationIndex]) {
    CSS.highlights.delete("annotation-active-highlight")
    activeAnnotationHighlight = null
  } else {
    setActiveHighlight(annotationAnchors[activeAnnotationIndex])
  }
}

function setActiveHighlight(range) {
  if (!CSS.highlights || !window.Highlight) return
  activeAnnotationHighlight = new Highlight(range)
  CSS.highlights.set("annotation-active-highlight", activeAnnotationHighlight)
}

function editAnnotation(index) {
  const card = annotationsEl.querySelector(`[data-edit="${index}"]`)?.closest(".annotation-card")
  const wrap = card?.querySelector(".anno-comment-wrap")
  if (!wrap) return
  wrap.innerHTML = `<textarea class="edit-annotation-input" wrap="soft">${esc(annotations[index].comment)}</textarea><div class="edit-actions"><button data-cancel-edit>Cancel</button><button data-save-edit class="primary">Save</button></div>`
  const input = wrap.querySelector("textarea")
  input.focus()
  input.setSelectionRange(input.value.length, input.value.length)
  wrap.querySelector("[data-cancel-edit]").onclick = renderAnnotations
  wrap.querySelector("[data-save-edit]").onclick = () => {
    const comment = input.value.trim()
    if (!comment) return
    annotations[index].comment = comment
    renderAnnotations()
  }
}

function crossIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>`
}

function pencilIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`
}

function hidePopover() {
  popover.style.display = "none"
  selectedQuote = ""
  selectedRange = null
  commentInput.value = ""
}

function highlightSelectedRange() {
  if (!selectedRange || selectedRange.collapsed) return
  const range = selectedRange.cloneRange()
  selectedRange = null

  annotationAnchors.push(range.cloneRange())
  if (CSS.highlights && window.Highlight) {
    rebuildHighlights()
    return
  }

  const mark = document.createElement("mark")
  mark.className = "annotation-highlight"
  try {
    range.surroundContents(mark)
  } catch {
    const fragment = range.extractContents()
    mark.appendChild(fragment)
    range.insertNode(mark)
  }
}

function positionPopover(rect) {
  popover.style.display = "flex"
  popover.style.maxHeight = Math.max(260, window.innerHeight - 16) + "px"
  const popoverRect = popover.getBoundingClientRect()
  const left = Math.min(Math.max(rect.left, 8), window.innerWidth - popoverRect.width - 8)
  let top = rect.bottom + 10
  if (top + popoverRect.height > window.innerHeight - 8) top = rect.top - popoverRect.height - 10
  if (top < 8) top = 8
  popover.style.left = left + "px"
  popover.style.top = top + "px"
}

document.addEventListener("mouseup", () => {
  const sel = window.getSelection(),
    text = sel?.toString().trim()
  if (!text || !docEl.contains(sel.anchorNode)) return
  selectedQuote = text
  selectedRange = sel.getRangeAt(0).cloneRange()
  selPreview.textContent = text.length > 360 ? text.slice(0, 360) + "…" : text
  positionPopover(sel.getRangeAt(0).getBoundingClientRect())
  setTimeout(() => commentInput.focus(), 0)
})
document.addEventListener("mousedown", (e) => {
  if (popover.style.display === "flex" && !popover.contains(e.target)) hidePopover()
})
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hidePopover()
})

copySelectionBtn.onclick = async () => {
  if (!selectedQuote) return
  await navigator.clipboard.writeText(selectedQuote)
  copySelectionBtn.classList.add("copied")
  setTimeout(() => copySelectionBtn.classList.remove("copied"), 900)
}

document.getElementById("cancelAdd").onclick = hidePopover
document.getElementById("addBtn").onclick = () => {
  const c = commentInput.value.trim()
  if (!selectedQuote && !c) return
  annotations.push({ quote: selectedQuote, comment: c })
  highlightSelectedRange()
  hidePopover()
  window.getSelection()?.removeAllRanges()
  renderAnnotations()
}

document.getElementById("submitBtn").onclick = async () => {
  const g = document.getElementById("global").value.trim()
  if (!annotations.length && !g) {
    alert("Add an annotation or global feedback first.")
    return
  }
  try {
    await fetch("/api/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, annotations, globalComment: g }),
    })
    document.body.innerHTML =
      '<div class="full-msg"><h2>Feedback Sent</h2><p>You may close this tab</p></div>'
  } catch {
    alert("Submission failed.")
  }
}

document.getElementById("closeBtn").onclick = async () => {
  try {
    await fetch("/api/close", { method: "POST" })
  } catch {}
  window.close()
  document.body.innerHTML =
    '<div class="full-msg"><h2>Session Closed</h2><p>You may close this tab</p></div>'
}

;(async () => {
  try {
    const res = await fetch("/api/doc?id=" + encodeURIComponent(id || ""))
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || "failed to load")
    titleEl.textContent = data.title || "ANNOTATOR_TERMINAL"
    sourceEl.textContent =
      data.sourcePath || (data.kind === "last" ? "last assistant response" : "")
    docEl.innerHTML = renderMd(data.markdown || "")
    buildTOC()
    renderAnnotations()
  } catch (e) {
    docEl.innerHTML = `<span style="color:var(--danger)">error: ${esc(e.message)}</span>`
  }
})()
