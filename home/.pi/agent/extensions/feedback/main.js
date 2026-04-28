document.documentElement.dataset.theme = "dark"

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
  selectedQuote = ""

function updateToggles() {
  const lc = document.body.classList.contains("lc"),
    rc = document.body.classList.contains("rc")
  document.getElementById("leftToggle").textContent = lc ? "›" : "‹"
  document.getElementById("rightToggle").textContent = rc ? "‹" : "›"
}
document.getElementById("leftToggle").onclick = () => {
  document.body.classList.toggle("lc")
  localStorage.setItem("ann-lc", document.body.classList.contains("lc") ? "1" : "0")
  updateToggles()
}
document.getElementById("rightToggle").onclick = () => {
  document.body.classList.toggle("rc")
  localStorage.setItem("ann-rc", document.body.classList.contains("rc") ? "1" : "0")
  updateToggles()
}
if (localStorage.getItem("ann-lc") === "1") document.body.classList.add("lc")
if (localStorage.getItem("ann-rc") === "1") document.body.classList.add("rc")
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
    <div class="card annotation-card">
      <button data-i="${i}" class="icon-btn close-btn" aria-label="Delete annotation">${crossIcon()}</button>
      <div class="anno-top"><span class="anno-file">#${String(i + 1).padStart(2, "0")}</span></div>
      ${a.quote ? `<div class="quote anno-quote">${esc(a.quote.length > 280 ? a.quote.slice(0, 280) + "…" : a.quote)}</div>` : ""}
      ${a.comment ? `<div class="comment anno-comment">${esc(a.comment)}</div>` : ""}
    </div>`
    )
    .join("")
  annotationsEl.querySelectorAll("[data-i]").forEach((b) => {
    b.onclick = () => {
      annotations.splice(+b.dataset.i, 1)
      renderAnnotations()
    }
  })
}

function crossIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>`
}

function hidePopover() {
  popover.style.display = "none"
  selectedQuote = ""
  commentInput.value = ""
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
