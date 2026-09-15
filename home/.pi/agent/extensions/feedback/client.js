let selectionAnchor
const dismissibleDialogs = new WeakSet()
const MERMAID_RUNTIME = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs"
const COPY_BUTTON_ICONS = `
  <svg class="copy-icon" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="9" y="9" width="11" height="11" rx="2"></rect>
    <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"></path>
  </svg>
  <svg class="check-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="m5 12 4 4L19 6"></path>
  </svg>
`

const diagramDefinition = (code) => {
  const language = [...code.classList]
    .find((className) => className.startsWith("language-"))
    ?.slice("language-".length)
    .toLowerCase()
  const source = code.textContent ?? ""

  if (language === "mermaid") return source
  if (["sequence", "sequential", "sequence-diagram", "sequencediagram"].includes(language)) {
    return /^\s*sequenceDiagram\b/.test(source) ? source : `sequenceDiagram\n${source}`
  }
  return undefined
}

const addDiagramExpandButton = (container) => {
  const button = document.createElement("button")
  button.className = "button icon-button diagram-expand-button"
  button.type = "button"
  button.textContent = "⛶"

  const setExpanded = (expanded) => {
    button.title = expanded ? "Close expanded diagram" : "Expand diagram"
    button.setAttribute("aria-label", button.title)
  }
  const open = () => {
    const placeholder = document.createComment("diagram position")
    container.replaceWith(placeholder)

    const dialog = document.createElement("dialog")
    dialog.className = "diagram-dialog"
    dialog.setAttribute("aria-label", "Expanded diagram")
    dialog.append(container)
    document.body.append(dialog)

    setExpanded(true)
    button.onclick = () => dialog.close()
    const restore = () => {
      placeholder.replaceWith(container)
      setExpanded(false)
      button.onclick = open
      dialog.remove()
    }
    dialog.addEventListener("close", restore, { once: true })
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close()
    })
    dialog.showModal()
  }

  setExpanded(false)
  button.onclick = open
  container.append(button)
}

const renderDiagrams = async () => {
  const diagrams = [...document.querySelectorAll("#doc pre > code[class*='language-']")]
    .map((code) => ({ code, definition: diagramDefinition(code) }))
    .filter(({ definition }) => definition !== undefined)
  if (diagrams.length === 0) return

  try {
    const { default: mermaid } = await import(MERMAID_RUNTIME)
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "dark",
      fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
    })

    for (const [index, { code, definition }] of diagrams.entries()) {
      const container = document.createElement("div")
      container.className = "diagram"
      container.setAttribute("role", "img")
      container.setAttribute("aria-label", "Mermaid diagram")
      try {
        await mermaid.parse(definition)
        const { svg, bindFunctions } = await mermaid.render(`feedback-diagram-${index}`, definition)
        container.innerHTML = svg
        bindFunctions?.(container)
        addDiagramExpandButton(container)
        code.parentElement?.replaceWith(container)
      } catch (error) {
        code.parentElement?.classList.add("diagram-error")
        code.parentElement?.setAttribute(
          "title",
          `Could not render diagram: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  } catch (error) {
    console.error("Could not load Mermaid", error)
    diagrams.forEach(({ code }) => code.parentElement?.classList.add("diagram-error"))
  }
}

const copyTimers = new WeakMap()

const updateCopyLabel = (button, label) => {
  button.dataset.label = label
  button.title = label
  button.setAttribute("aria-label", label)
  const visibleLabel = button.querySelector(".copy-document-label")
  if (visibleLabel) visibleLabel.textContent = label
}

const setCopyState = (button, label, resetAfter = 1600) => {
  const originalLabel = button.dataset.copyLabel ?? "Copy"
  button.dataset.copyLabel = originalLabel
  updateCopyLabel(button, label)
  button.classList.toggle("copied", label === "Copied")

  const currentTimer = copyTimers.get(button)
  if (currentTimer !== undefined) clearTimeout(currentTimer)
  copyTimers.set(
    button,
    setTimeout(() => {
      updateCopyLabel(button, originalLabel)
      button.classList.remove("copied")
      copyTimers.delete(button)
    }, resetAfter)
  )
}

const writeClipboard = async (text) => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch (error) {
      console.warn("Clipboard API unavailable; trying fallback", error)
    }
  }

  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  document.body.append(textarea)
  textarea.select()
  const copied = document.execCommand("copy")
  textarea.remove()
  if (!copied) throw new Error("Browser rejected the copy command")
}

const copyText = async (text, button) => {
  button.disabled = true
  try {
    await writeClipboard(text)
    setCopyState(button, "Copied")
  } catch (error) {
    console.error("Could not copy feedback content", error)
    setCopyState(button, "Copy failed", 2400)
  } finally {
    button.disabled = false
  }
}

const addCodeCopyButtons = () => {
  document.querySelectorAll("#doc pre > code").forEach((code) => {
    const pre = code.parentElement
    if (!pre || pre.parentElement?.classList.contains("code-block")) return

    const wrapper = document.createElement("div")
    wrapper.className = "code-block"
    pre.replaceWith(wrapper)
    wrapper.append(pre)

    const button = document.createElement("button")
    button.className = "button icon-button code-copy-button"
    button.type = "button"
    button.innerHTML = COPY_BUTTON_ICONS
    button.dataset.copyLabel = "Copy code block"
    button.dataset.label = "Copy code block"
    button.title = "Copy code block"
    button.setAttribute("aria-label", "Copy code block")
    button.addEventListener("mouseup", (event) => event.stopPropagation())
    button.addEventListener("click", (event) => {
      event.stopPropagation()
      void copyText(code.textContent ?? "", button)
    })
    wrapper.append(button)
  })
}

const initializeCopyControls = () => {
  const button = document.querySelector("[data-copy-document]")
  const source = document.getElementById("document-source")
  if (!(button instanceof HTMLButtonElement) || !(source instanceof HTMLTextAreaElement)) return

  button.dataset.copyLabel = "Copy full response"
  button.addEventListener("click", () => void copyText(source.value, button))
}

const locate = (root, offset) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let consumed = 0
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const next = consumed + (node.textContent?.length ?? 0)
    if (offset <= next) return { node, offset: offset - consumed }
    consumed = next
  }
}

globalThis.feedback = {
  capture(root) {
    const selection = globalThis.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
    const range = selection.getRangeAt(0)
    if (!root.contains(range.commonAncestorContainer)) return null
    const before = range.cloneRange()
    before.selectNodeContents(root)
    before.setEnd(range.startContainer, range.startOffset)
    const start = before.toString().length
    const bounds = range.getBoundingClientRect()
    selectionAnchor =
      bounds.width > 0 || bounds.height > 0
        ? { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom }
        : undefined
    return { quote: range.toString().trim(), start, end: start + range.toString().length }
  },
  open(dialog) {
    if (!dialog.open) dialog.show()
    if (!dismissibleDialogs.has(dialog)) {
      dismissibleDialogs.add(dialog)
      document.addEventListener("mousedown", (event) => {
        if (dialog.open && !dialog.contains(event.target)) dialog.close()
      })
      document.addEventListener("keydown", (event) => {
        if (dialog.open && event.key === "Escape") {
          event.preventDefault()
          dialog.close()
        }
      })
    }
    const padding = 12
    const gap = 10
    const width = dialog.offsetWidth
    const height = dialog.offsetHeight
    const centeredLeft = (innerWidth - width) / 2
    const preferredLeft = selectionAnchor ? selectionAnchor.left : centeredLeft
    const left = Math.max(padding, Math.min(preferredLeft, innerWidth - width - padding))
    const below = selectionAnchor ? selectionAnchor.bottom + gap : (innerHeight - height) / 2
    const top =
      selectionAnchor && below + height > innerHeight - padding
        ? selectionAnchor.top - height - gap
        : below
    dialog.style.left = left + "px"
    dialog.style.top = Math.max(padding, Math.min(top, innerHeight - height - padding)) + "px"
  },
  activate(start, end) {
    const root = document.getElementById("doc")
    if (!root) return
    const from = locate(root, start)
    const to = locate(root, end)
    if (!from || !to || start >= end) return
    const range = new Range()
    range.setStart(from.node, from.offset)
    range.setEnd(to.node, to.offset)
    if (CSS.highlights && globalThis.Highlight) {
      CSS.highlights.set("feedback-active", new Highlight(range))
    }
    const scroller = document.getElementById("doc-wrap")
    if (!scroller) return
    const rangeBounds = range.getBoundingClientRect()
    const scrollerBounds = scroller.getBoundingClientRect()
    const top =
      scroller.scrollTop + rangeBounds.top - scrollerBounds.top - scroller.clientHeight / 2
    scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" })
  },
  sync(items, activeId) {
    if (!CSS.highlights || !globalThis.Highlight) return
    const root = document.getElementById("doc")
    if (!root) return
    const ranges = items.flatMap(({ start, end }) => {
      const from = locate(root, start)
      const to = locate(root, end)
      if (!from || !to || start >= end) return []
      const range = new Range()
      range.setStart(from.node, from.offset)
      range.setEnd(to.node, to.offset)
      return [range]
    })
    CSS.highlights.set("feedback", new Highlight(...ranges))
    CSS.highlights.delete("feedback-active")
    const active = items.find(({ id }) => id === activeId)
    if (active) {
      const from = locate(root, active.start)
      const to = locate(root, active.end)
      if (from && to && active.start < active.end) {
        const range = new Range()
        range.setStart(from.node, from.offset)
        range.setEnd(to.node, to.offset)
        CSS.highlights.set("feedback-active", new Highlight(range))
      }
    }
    globalThis.getSelection()?.removeAllRanges()
  },
}

const initializeDocument = async () => {
  initializeCopyControls()
  await renderDiagrams()
  addCodeCopyButtons()
}

void initializeDocument()
