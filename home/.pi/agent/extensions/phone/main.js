const params = new URLSearchParams(location.search)
const token = params.get("token") || ""
const messagesEl = document.querySelector("#messages")
const statusEl = document.querySelector("#status")
const form = document.querySelector("#composer")
const promptEl = document.querySelector("#prompt")
const waveformEl = document.querySelector("#waveform")
const micButton = document.querySelector("#mic")
const refreshButton = document.querySelector("#refresh")
const jumpLatestButton = document.querySelector("#jump-latest")
let eventSource
let reconnectTimer
let reconnectAttempt = 0
let lastEventAt = 0
let watchdogTimer
let highlighterPromise
let currentMessages = []
let pendingMessages = []
let didInitialScroll = false
let lastRenderSignature = ""
let recorder
let recordingStream
let recordingChunks = []
let isRecording = false
let isTranscribing = false
let audioContext
let analyser
let waveformData
let waveformLevels = []
let waveformAnimation

function api(path) {
  return `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
}

function setStatus(text) {
  statusEl.textContent = text
}

function noteEvent() {
  lastEventAt = Date.now()
}

function reconnectDelay() {
  return Math.min(30_000, 750 * 2 ** Math.min(reconnectAttempt, 6))
}

function scheduleReconnect(reason = "Reconnecting…") {
  setStatus(reason)
  if (reconnectTimer) return
  const delay = reconnectDelay()
  reconnectAttempt += 1
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined
    connectEvents()
  }, delay)
}

function reconnectNow(reason = "Reconnecting…") {
  if (!token) return
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = undefined
  reconnectAttempt = 0
  setStatus(reason)
  connectEvents()
  refresh().catch((error) => setStatus(error.message))
}

function startWatchdog() {
  if (watchdogTimer) clearInterval(watchdogTimer)
  watchdogTimer = setInterval(() => {
    if (document.hidden) return
    if (!lastEventAt) return
    if (Date.now() - lastEventAt > 45_000) reconnectNow("Connection stale; reconnecting…")
  }, 10_000)
}

function updateComposerHeight() {
  const height = Math.ceil(form.getBoundingClientRect().height) + 24
  document.documentElement.style.setProperty("--composer-h", `${height}px`)
}

function autosizePrompt() {
  form.classList.remove("multiline")
  promptEl.style.height = "auto"
  const compactHeight = promptEl.scrollHeight
  form.classList.toggle("multiline", compactHeight > 44)
  promptEl.style.height = "auto"
  promptEl.style.height = `${Math.min(promptEl.scrollHeight, Math.floor(window.innerHeight * 0.34))}px`
  updateComposerHeight()
}

function isNearBottom() {
  const distance = document.documentElement.scrollHeight - window.scrollY - window.innerHeight
  return distance < 80
}

function setJumpLatestVisible(visible) {
  jumpLatestButton.hidden = !visible
}

function scrollToBottom(behavior = "smooth") {
  requestAnimationFrame(() => {
    updateComposerHeight()
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior })
    setJumpLatestVisible(false)
  })
}

function renderSignature(messages) {
  return messages.map((message) => `${message.id}:${message.role}:${message.text.length}`).join("|")
}

function sanitizeHtml(html) {
  const template = document.createElement("template")
  template.innerHTML = html
  for (const el of template.content.querySelectorAll("script, iframe, object, embed")) el.remove()
  for (const el of template.content.querySelectorAll("*")) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      const value = attr.value.trim().toLowerCase()
      if (name.startsWith("on") || value.startsWith("javascript:")) el.removeAttribute(attr.name)
    }
  }
  return template.innerHTML
}

function markedApi() {
  const candidate = globalThis.marked
  if (!candidate) return null
  if (typeof candidate.parse === "function") return candidate
  if (candidate.marked && typeof candidate.marked.parse === "function") return candidate.marked
  return null
}

function renderMarkdown(text) {
  const api = markedApi()
  if (!api) return escapeText(text)
  const html = api.parse(text, { breaks: true, gfm: true })
  return sanitizeHtml(html)
}

function escapeText(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br />")
}

function normalizeLanguage(language) {
  const normalized = language.toLowerCase().trim()
  if (normalized === "javascript" || normalized === "jsx") return "js"
  if (normalized === "typescript" || normalized === "tsx") return "ts"
  if (normalized === "python") return "py"
  if (normalized === "rust") return "rs"
  if (normalized === "shell" || normalized === "sh" || normalized === "zsh") return "bash"
  if (normalized === "markdown") return "md"
  if (normalized === "yaml" || normalized === "yml") return "yaml"
  return normalized || "plain"
}

function loadHighlighter() {
  highlighterPromise ??= Promise.all([
    import("https://cdn.jsdelivr.net/gh/speed-highlight/core/dist/index.js"),
    import("https://cdn.jsdelivr.net/gh/speed-highlight/core/dist/detect.js"),
  ]).then(([core, detect]) => ({
    highlightElement: core.highlightElement,
    detectLanguage: detect.detectLanguage,
  }))
  return highlighterPromise
}

function prepareCodeBlocks(root) {
  for (const link of root.querySelectorAll("a")) {
    link.target = "_blank"
    link.rel = "noreferrer noopener"
  }

  const blocks = []
  for (const preCode of root.querySelectorAll("pre code")) {
    const languageClass = Array.from(preCode.classList).find((className) =>
      className.startsWith("language-")
    )
    const language = languageClass ? languageClass.slice("language-".length) : ""
    preCode.className = `shj-lang-${normalizeLanguage(language)}`
    blocks.push(preCode)
  }
  return blocks
}

function highlightCodeBlocks(blocks) {
  if (blocks.length === 0) return
  loadHighlighter()
    .then(({ highlightElement, detectLanguage }) => {
      for (const block of blocks) {
        const explicitLanguage = Array.from(block.classList)
          .find((className) => className.startsWith("shj-lang-"))
          ?.slice("shj-lang-".length)
        const language = explicitLanguage || detectLanguage(block.textContent || "")
        highlightElement(block, language)
      }
    })
    .catch(() => {})
}

function reconcilePendingMessages(messages) {
  pendingMessages = pendingMessages.filter((pending) => {
    const userMessages = messages.filter((message) => message.role === "user")
    const newerUserMessages = userMessages.slice(pending.baseUserCount ?? 0)
    return !newerUserMessages.some((message) => message.text.trim() === pending.text.trim())
  })
}

function renderMessages(messages) {
  currentMessages = messages
  reconcilePendingMessages(messages)
  const visibleMessages = [...messages, ...pendingMessages]
  const signature = renderSignature(visibleMessages)
  const changed = signature !== lastRenderSignature
  const shouldStickToBottom = didInitialScroll && isNearBottom()
  messagesEl.replaceChildren()
  for (const message of visibleMessages) {
    const article = document.createElement("article")
    article.className = `message ${message.role}`

    const role = document.createElement("div")
    role.className = "role"
    role.textContent = message.role

    const content = document.createElement("div")
    content.className = "markdown"
    content.innerHTML = renderMarkdown(message.text)
    const codeBlocks = prepareCodeBlocks(content)

    article.append(role, content)
    highlightCodeBlocks(codeBlocks)
    messagesEl.append(article)
  }
  lastRenderSignature = signature
  updateComposerHeight()

  if (!didInitialScroll) {
    didInitialScroll = true
    scrollToBottom("auto")
    return
  }

  if (!changed) return
  if (shouldStickToBottom) scrollToBottom("auto")
  else setJumpLatestVisible(true)
}

async function refresh() {
  const response = await fetch(api("/api/state"))
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || "Refresh failed")
  renderMessages(data.messages || [])
  setStatus(data.idle ? "Idle" : "Working…")
}

function connectEvents() {
  if (eventSource) eventSource.close()
  noteEvent()
  eventSource = new EventSource(api("/events"))
  eventSource.addEventListener("open", () => {
    noteEvent()
    reconnectAttempt = 0
    setStatus("Connected")
  })
  eventSource.addEventListener("error", () => {
    eventSource?.close()
    eventSource = undefined
    scheduleReconnect("Disconnected; reconnecting…")
  })
  eventSource.addEventListener("snapshot", (event) => {
    noteEvent()
    const data = JSON.parse(event.data)
    renderMessages(data.messages || [])
    setStatus(data.idle ? "Idle" : "Working…")
  })
  eventSource.addEventListener("status", (event) => {
    noteEvent()
    const data = JSON.parse(event.data)
    setStatus(data.idle ? "Idle" : "Working…")
  })
}

function removePendingMessage(id) {
  pendingMessages = pendingMessages.filter((message) => message.id !== id)
}

function setMicState(state) {
  micButton.classList.toggle("recording", state === "recording")
  micButton.classList.toggle("busy", state === "busy")
  micButton.disabled = state === "busy"
  micButton.setAttribute(
    "aria-label",
    state === "recording" ? "Stop recording" : state === "busy" ? "Transcribing" : "Record voice"
  )
  micButton.title = micButton.getAttribute("aria-label") || "Record voice"
}

function setRecordingMode(active) {
  form.classList.toggle("recording-mode", active)
  promptEl.readOnly = active
  if (active) promptEl.blur()
  updateComposerHeight()
}

function drawWaveform() {
  if (!analyser || !waveformData) return

  const rect = waveformEl.getBoundingClientRect()
  const width = Math.max(1, Math.floor(rect.width))
  const height = Math.max(1, Math.floor(rect.height))
  const dpr = window.devicePixelRatio || 1
  const targetWidth = Math.floor(width * dpr)
  const targetHeight = Math.floor(height * dpr)

  if (waveformEl.width !== targetWidth || waveformEl.height !== targetHeight) {
    waveformEl.width = targetWidth
    waveformEl.height = targetHeight
  }

  const ctx = waveformEl.getContext("2d")
  if (!ctx) return

  analyser.getByteTimeDomainData(waveformData)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)

  const gap = 4
  const barWidth = 2
  const stride = barWidth + gap
  const barCount = Math.max(24, Math.ceil(width / stride))
  const centerY = height / 2
  const step = Math.max(1, Math.floor(waveformData.length / barCount))
  ctx.fillStyle = "rgba(246, 255, 245, 0.72)"

  if (waveformLevels.length !== barCount) waveformLevels = Array(barCount).fill(0)

  for (let i = 0; i < barCount; i += 1) {
    let sum = 0
    const start = i * step
    const end = Math.min(waveformData.length, start + step)
    for (let j = start; j < end; j += 1) {
      sum += Math.abs(waveformData[j] - 128) / 128
    }
    const average = sum / Math.max(1, end - start)
    const target = Math.min(1, average * 2.8)
    waveformLevels[i] = waveformLevels[i] * 0.82 + target * 0.18
    const barHeight = Math.max(3, waveformLevels[i] * height * 0.82)
    const x = i * stride
    ctx.fillRect(x, centerY - barHeight / 2, barWidth, barHeight)
  }

  waveformAnimation = requestAnimationFrame(drawWaveform)
}

function startWaveform(stream) {
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext
  if (!AudioContextClass) return
  audioContext = new AudioContextClass()
  analyser = audioContext.createAnalyser()
  analyser.fftSize = 2048
  waveformData = new Uint8Array(analyser.fftSize)
  waveformLevels = []
  audioContext.createMediaStreamSource(stream).connect(analyser)
  waveformAnimation = requestAnimationFrame(drawWaveform)
}

function stopWaveform() {
  if (waveformAnimation) cancelAnimationFrame(waveformAnimation)
  waveformAnimation = undefined
  analyser = undefined
  waveformData = undefined
  waveformLevels = []
  audioContext?.close().catch(() => {})
  audioContext = undefined
}

function insertTranscript(text) {
  const transcript = text.trim()
  if (!transcript) return
  const current = promptEl.value.trim()
  promptEl.value = current ? `${current}\n${transcript}` : transcript
  autosizePrompt()
  promptEl.focus()
}

async function transcribeRecording(blob) {
  setMicState("busy")
  setStatus("Transcribing…")
  const response = await fetch(api("/api/transcribe"), {
    method: "POST",
    headers: { "content-type": blob.type || "application/octet-stream" },
    body: blob,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || "Transcription failed")
  insertTranscript(data.text || "")
  setStatus("Transcript ready")
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    throw new Error("Voice recording is not supported in this browser")
  }
  recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true })
  recordingChunks = []
  recorder = new MediaRecorder(recordingStream)
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) recordingChunks.push(event.data)
  })
  recorder.addEventListener("stop", () => {
    const type = recorder.mimeType || "audio/webm"
    const blob = new Blob(recordingChunks, { type })
    stopWaveform()
    setRecordingMode(false)
    recordingStream?.getTracks().forEach((track) => track.stop())
    recordingStream = undefined
    recorder = undefined
    isRecording = false
    isTranscribing = true
    transcribeRecording(blob)
      .catch((error) => setStatus(error.message))
      .finally(() => {
        isTranscribing = false
        setMicState("idle")
      })
  })
  recorder.start()
  isRecording = true
  setRecordingMode(true)
  startWaveform(recordingStream)
  setMicState("recording")
  setStatus("Recording…")
}

function stopRecording() {
  if (!recorder || recorder.state === "inactive") return
  setStatus("Stopping…")
  recorder.stop()
}

async function toggleRecording() {
  if (isTranscribing) return
  if (isRecording) {
    stopRecording()
    return
  }
  try {
    await startRecording()
  } catch (error) {
    stopWaveform()
    setRecordingMode(false)
    recordingStream?.getTracks().forEach((track) => track.stop())
    recordingStream = undefined
    isRecording = false
    setMicState("idle")
    setStatus(error.message)
  }
}

async function sendPrompt() {
  const message = promptEl.value.trim()
  if (!message) return
  const pendingId = `pending-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const baseUserCount = currentMessages.filter(
    (currentMessage) => currentMessage.role === "user"
  ).length
  pendingMessages.push({ id: pendingId, role: "user pending", text: message, baseUserCount })
  promptEl.value = ""
  autosizePrompt()
  renderMessages(currentMessages)
  scrollToBottom("smooth")
  setStatus("Sending…")
  const response = await fetch(api("/api/send"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    removePendingMessage(pendingId)
    renderMessages(currentMessages)
    setStatus(data.error || "Send failed")
    promptEl.value = message
    return
  }
  setStatus("Sent")
}

form.addEventListener("submit", (event) => {
  event.preventDefault()
  sendPrompt().catch((error) => setStatus(error.message))
})

micButton.addEventListener("click", () => toggleRecording())

promptEl.addEventListener("input", autosizePrompt)

promptEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    sendPrompt().catch((error) => setStatus(error.message))
  }
})

refreshButton.addEventListener("click", () => refresh().catch((error) => setStatus(error.message)))

jumpLatestButton.addEventListener("click", () => scrollToBottom())
window.addEventListener("scroll", () => {
  if (isNearBottom()) setJumpLatestVisible(false)
})

new ResizeObserver(updateComposerHeight).observe(form)
window.visualViewport?.addEventListener("resize", updateComposerHeight)
window.addEventListener("resize", updateComposerHeight)
window.addEventListener("online", () => reconnectNow("Back online; reconnecting…"))
window.addEventListener("focus", () => reconnectNow("Reconnecting…"))
window.addEventListener("pageshow", () => reconnectNow("Reconnecting…"))
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) reconnectNow("Reconnecting…")
})
autosizePrompt()
updateComposerHeight()

if (!token) setStatus("Missing token. Run /phone again.")
else {
  connectEvents()
  startWatchdog()
  refresh().catch((error) => setStatus(error.message))
}
