let selectionAnchor
const dismissibleDialogs = new WeakSet()

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
