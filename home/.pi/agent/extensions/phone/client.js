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

function element(selector) {
  return document.querySelector(selector)
}

function setStatus(text) {
  const status = element("#status")
  if (status) status.textContent = text
}

function setMicState(mode) {
  const button = element("#mic")
  if (!button) return
  button.classList.toggle("recording", mode === "recording")
  button.classList.toggle("busy", mode === "busy")
  button.disabled = mode === "busy"
  const label =
    mode === "recording" ? "Stop recording" : mode === "busy" ? "Transcribing" : "Record voice"
  button.setAttribute("aria-label", label)
  button.title = label
}

function setRecordingMode(active) {
  const form = element("#composer")
  const prompt = element("#prompt")
  if (!form || !prompt) return
  form.classList.toggle("recording-mode", active)
  prompt.readOnly = active
  if (active) prompt.blur()
}

function drawWaveform() {
  const canvas = element("#waveform")
  if (!canvas || !analyser || !waveformData) return

  const rect = canvas.getBoundingClientRect()
  const width = Math.max(1, Math.floor(rect.width))
  const height = Math.max(1, Math.floor(rect.height))
  const dpr = window.devicePixelRatio || 1
  const targetWidth = Math.floor(width * dpr)
  const targetHeight = Math.floor(height * dpr)
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth
    canvas.height = targetHeight
  }

  const context = canvas.getContext("2d")
  if (!context) return
  analyser.getByteTimeDomainData(waveformData)
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, width, height)

  const barWidth = 2
  const stride = barWidth + 4
  const barCount = Math.max(24, Math.ceil(width / stride))
  const centerY = height / 2
  const step = Math.max(1, Math.floor(waveformData.length / barCount))
  context.fillStyle = "rgba(245, 245, 245, 0.72)"
  if (waveformLevels.length !== barCount) waveformLevels = Array(barCount).fill(0)

  for (let index = 0; index < barCount; index += 1) {
    let sum = 0
    const start = index * step
    const end = Math.min(waveformData.length, start + step)
    for (let sample = start; sample < end; sample += 1) {
      sum += Math.abs(waveformData[sample] - 128) / 128
    }
    const target = Math.min(1, (sum / Math.max(1, end - start)) * 2.8)
    waveformLevels[index] = waveformLevels[index] * 0.82 + target * 0.18
    const barHeight = Math.max(3, waveformLevels[index] * height * 0.82)
    context.fillRect(index * stride, centerY - barHeight / 2, barWidth, barHeight)
  }
  waveformAnimation = requestAnimationFrame(drawWaveform)
}

function startWaveform(stream) {
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext
  if (!AudioContextClass) return
  audioContext = new AudioContextClass()
  analyser = audioContext.createAnalyser()
  analyser.fftSize = 2_048
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
  const prompt = element("#prompt")
  if (!prompt) return
  const transcript = text.trim()
  if (!transcript) return
  const current = prompt.value.trim()
  prompt.value = current ? `${current}\n${transcript}` : transcript
  prompt.dispatchEvent(new Event("input", { bubbles: true }))
  prompt.focus()
}

async function transcribeRecording(blob) {
  setMicState("busy")
  setStatus("Transcribing…")
  const response = await fetch("/api/transcribe", {
    method: "POST",
    headers: { "content-type": blob.type || "application/octet-stream" },
    body: blob,
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || "Transcription failed")
  insertTranscript(result.text || "")
  setStatus("Transcript ready")
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || globalThis.MediaRecorder === undefined) {
    throw new Error("Voice recording is not supported in this browser")
  }
  recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true })
  recordingChunks = []
  recorder = new MediaRecorder(recordingStream)
  recorder.addEventListener("dataavailable", (recordingEvent) => {
    if (recordingEvent.data.size > 0) recordingChunks.push(recordingEvent.data)
  })
  recorder.addEventListener("stop", () => {
    const blob = new Blob(recordingChunks, { type: recorder.mimeType || "audio/webm" })
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

globalThis.phone = { toggleRecording }
