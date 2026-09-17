const locateTextPosition = (root, offset) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let consumed = 0
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const next = consumed + (node.textContent?.length ?? 0)
    if (offset <= next) return { node, offset: offset - consumed }
    consumed = next
  }
}

const rangeForOffsets = (root, start, end) => {
  if (start >= end) return
  const from = locateTextPosition(root, start)
  const to = locateTextPosition(root, end)
  if (!from || !to) return

  const range = new Range()
  range.setStart(from.node, from.offset)
  range.setEnd(to.node, to.offset)
  return range
}

class FeedbackDocument extends HTMLElement {
  #selectionAnchor
  #dialog
  #handleMouseup = () => {
    const selection = this.#captureSelection()
    if (!selection) return
    this.dispatchEvent(new CustomEvent("feedback-selection", { detail: selection }))
  }
  #handleDocumentMouseDown = (event) => {
    if (this.#dialog?.open && !this.#dialog.contains(event.target)) this.#dialog.close()
  }
  #handleDocumentKeyDown = (event) => {
    if (this.#dialog?.open && event.key === "Escape") {
      event.preventDefault()
      this.#dialog.close()
    }
  }

  connectedCallback() {
    this.addEventListener("mouseup", this.#handleMouseup)
    document.addEventListener("mousedown", this.#handleDocumentMouseDown)
    document.addEventListener("keydown", this.#handleDocumentKeyDown)
  }

  disconnectedCallback() {
    this.removeEventListener("mouseup", this.#handleMouseup)
    document.removeEventListener("mousedown", this.#handleDocumentMouseDown)
    document.removeEventListener("keydown", this.#handleDocumentKeyDown)
  }

  #captureSelection() {
    const selection = globalThis.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return

    const range = selection.getRangeAt(0)
    if (!this.contains(range.commonAncestorContainer)) return

    const before = range.cloneRange()
    before.selectNodeContents(this)
    before.setEnd(range.startContainer, range.startOffset)
    const quote = range.toString()
    const bounds = range.getBoundingClientRect()
    this.#selectionAnchor =
      bounds.width > 0 || bounds.height > 0
        ? { left: bounds.left, top: bounds.top, bottom: bounds.bottom }
        : undefined

    return {
      quote: quote.trim(),
      start: before.toString().length,
      end: before.toString().length + quote.length,
    }
  }

  syncDialog(dialog, open) {
    if (!(dialog instanceof HTMLDialogElement)) return
    this.#dialog = dialog
    if (!open) {
      if (dialog.open) dialog.close()
      return
    }

    if (!dialog.open) dialog.show()
    const padding = 12
    const gap = 10
    const centeredLeft = (innerWidth - dialog.offsetWidth) / 2
    const preferredLeft = this.#selectionAnchor?.left ?? centeredLeft
    const left = Math.max(
      padding,
      Math.min(preferredLeft, innerWidth - dialog.offsetWidth - padding)
    )
    const below = this.#selectionAnchor?.bottom ?? (innerHeight - dialog.offsetHeight) / 2
    const top =
      this.#selectionAnchor && below + dialog.offsetHeight > innerHeight - padding
        ? this.#selectionAnchor.top - dialog.offsetHeight - gap
        : below + (this.#selectionAnchor ? gap : 0)

    dialog.style.left = `${left}px`
    dialog.style.top = `${Math.max(padding, Math.min(top, innerHeight - dialog.offsetHeight - padding))}px`
  }

  activate(start, end) {
    const range = rangeForOffsets(this, start, end)
    if (!range) return

    if (CSS.highlights && globalThis.Highlight) {
      CSS.highlights.set("feedback-active", new Highlight(range))
    }
    const scroller = this.closest("#doc-wrap")
    if (!(scroller instanceof HTMLElement)) return
    const rangeBounds = range.getBoundingClientRect()
    const scrollerBounds = scroller.getBoundingClientRect()
    const top =
      scroller.scrollTop + rangeBounds.top - scrollerBounds.top - scroller.clientHeight / 2
    scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" })
  }

  sync(items, activeId) {
    if (!CSS.highlights || !globalThis.Highlight) return
    const ranges = items.flatMap(({ start, end }) => {
      const range = rangeForOffsets(this, start, end)
      return range ? [range] : []
    })
    CSS.highlights.set("feedback", new Highlight(...ranges))
    CSS.highlights.delete("feedback-active")

    const active = items.find(({ id }) => id === activeId)
    const activeRange = active && rangeForOffsets(this, active.start, active.end)
    if (activeRange) CSS.highlights.set("feedback-active", new Highlight(activeRange))
    globalThis.getSelection()?.removeAllRanges()
  }
}

customElements.define("feedback-document", FeedbackDocument)
