--- Whisper Transcription
--- Hold hotkey to record audio and automatically transcribe + paste using Groq's Whisper API.
---
--- @package whisper
--- @author m0hill

return function(manager)
	local P = {}
	local PACKAGE_ID = "whisper"

	local DEFAULT_HOTKEY = { { "alt" }, "/" }

	local CONFIG = {
		MODEL = "whisper-large-v3-turbo",
		SAMPLE_RATE = 16000,
		MIN_BYTES = 1000,
		MAX_HOLD_SECONDS = 300,
		API_TIMEOUT = 90,
		ENABLE_NOTIFY = true,
		ENABLE_SOUND = true,
		RECORDING_INDICATOR_COLOR = { red = 1, green = 0, blue = 0, alpha = 0.9 },
		TRANSCRIBING_INDICATOR_COLOR = { red = 0, green = 0.8, blue = 1, alpha = 0.9 },
	}

	local API_URL = "https://api.groq.com/openai/v1/audio/transcriptions"

	local rec_path = nil
	local is_recording = false
	local is_busy = false
	local rec_task = nil
	local stop_timer = nil
	local wav_path = nil
	local hotkey = nil
	local recordingIndicator = nil
	local transcribingIndicator = nil
	local indicatorTimer = nil
	local pulseTimer = nil
	local pulseDirection = 1
	local pulseAlpha = 0.3
	local telemetry = nil
	local stop_requested = false
	local settings = {
		enableNotify = manager.getSetting(PACKAGE_ID, "enableNotify", CONFIG.ENABLE_NOTIFY),
		enableSound = manager.getSetting(PACKAGE_ID, "enableSound", CONFIG.ENABLE_SOUND),
	}

	local function saveSetting(key, value)
		settings[key] = value
		manager.setSetting(PACKAGE_ID, key, value)
	end

	local function toggleNotifySetting()
		saveSetting("enableNotify", not settings.enableNotify)
	end

	local function toggleSoundSetting()
		saveSetting("enableSound", not settings.enableSound)
	end

	local function notify(title, text, sound)
		if not settings.enableNotify then
			return
		end
		manager.notify(title, text, { sound = sound, soundEnabled = settings.enableSound })
	end

	local function notifyError(title, text, sound)
		manager.notifyError(title, text, {
			sound = sound,
			soundEnabled = settings.enableSound,
			notify = settings.enableNotify,
		})
	end

	local function playSound(soundType)
		if not settings.enableSound then
			return
		end
		manager.playSound(soundType)
	end

	local function log(message)
		manager.log(PACKAGE_ID, message)
	end

	local function which(cmd)
		local out = hs.execute("command -v " .. cmd)
		out = (out or ""):gsub("%s+$", "")
		if out ~= "" then
			return out
		end

		local fallbacks = {
			"/opt/homebrew/bin/" .. cmd,
			"/usr/local/bin/" .. cmd,
			"/usr/bin/" .. cmd,
		}

		for _, p in ipairs(fallbacks) do
			if hs.fs.attributes(p, "mode") then
				return p
			end
		end

		return nil
	end

	local function tmpWavPath()
		local dir = os.getenv("TMPDIR") or "/tmp/"
		local name = string.format("whisper-%d-%d.wav", os.time(), math.random(1000, 9999))
		return dir .. name
	end

	local function formatDuration(value)
		if not value or value <= 0 then
			return "n/a"
		end
		return string.format("%.2fs", value)
	end

	local function toNumber(value)
		if type(value) == "number" then
			return value
		elseif type(value) == "string" and value ~= "" then
			local parsed = tonumber(value)
			if parsed and parsed >= 0 then
				return parsed
			end
		end
		return nil
	end

	local function buildTelemetrySummary()
		if not telemetry then
			return nil
		end

		local metrics = telemetry.curlMetrics or {}
		local parts = {}

		if telemetry.recordingDuration then
			table.insert(parts, "record " .. formatDuration(telemetry.recordingDuration))
		end

		local upload = toNumber(metrics.time_upload)
		if upload and upload > 0 then
			table.insert(parts, "upload " .. formatDuration(upload))
		end

		local responseWait = nil
		local startTransfer = toNumber(metrics.time_starttransfer)
		local uploadRef = toNumber(metrics.time_upload)
		if startTransfer and uploadRef then
			responseWait = startTransfer - uploadRef
			if responseWait <= 0 then
				responseWait = nil
			end
		end
		if responseWait then
			table.insert(parts, "server " .. formatDuration(responseWait))
		end

		local download = toNumber(metrics.time_download)
		if download and download > 0 then
			table.insert(parts, "download " .. formatDuration(download))
		end

		local total = toNumber(metrics.time_total)
		if total and total > 0 then
			table.insert(parts, "api " .. formatDuration(total))
		end

		if telemetry.transcriptionStartedAt and telemetry.transcriptionFinishedAt and total and total > 0 then
			local measured = telemetry.transcriptionFinishedAt - telemetry.transcriptionStartedAt
			if measured and measured > total then
				local localTime = measured - total
				if localTime > 0 then
					table.insert(parts, "local " .. formatDuration(localTime))
				end
			end
		end

		if #parts > 0 then
			return "time " .. table.concat(parts, " | ")
		end

		return nil
	end

	local function createRecordingIndicator()
		local mousePos = hs.mouse.absolutePosition()
		recordingIndicator = hs.canvas.new({
			x = mousePos.x - 15,
			y = mousePos.y - 35,
			w = 30,
			h = 30,
		})

		recordingIndicator[1] = {
			type = "circle",
			action = "stroke",
			strokeColor = CONFIG.RECORDING_INDICATOR_COLOR,
			strokeWidth = 2,
			center = { x = 15, y = 15 },
			radius = 12,
		}

		recordingIndicator[2] = {
			type = "circle",
			action = "fill",
			fillColor = CONFIG.RECORDING_INDICATOR_COLOR,
			center = { x = 15, y = 15 },
			radius = 8,
		}

		recordingIndicator:show()

		indicatorTimer = hs.timer.new(0.05, function()
			if recordingIndicator then
				local pos = hs.mouse.absolutePosition()
				recordingIndicator:topLeft({ x = pos.x - 15, y = pos.y - 35 })
			end
		end)
		indicatorTimer:start()
	end

	local function createTranscribingIndicator()
		local mousePos = hs.mouse.absolutePosition()
		transcribingIndicator = hs.canvas.new({
			x = mousePos.x - 15,
			y = mousePos.y - 35,
			w = 30,
			h = 30,
		})

		transcribingIndicator[1] = {
			type = "circle",
			action = "stroke",
			strokeColor = { red = 0, green = 0.8, blue = 1, alpha = pulseAlpha },
			strokeWidth = 3,
			center = { x = 15, y = 15 },
			radius = 12,
		}

		transcribingIndicator[2] = {
			type = "circle",
			action = "fill",
			fillColor = CONFIG.TRANSCRIBING_INDICATOR_COLOR,
			center = { x = 15, y = 15 },
			radius = 6,
		}

		transcribingIndicator:show()

		indicatorTimer = hs.timer.new(0.05, function()
			if transcribingIndicator then
				local pos = hs.mouse.absolutePosition()
				transcribingIndicator:topLeft({ x = pos.x - 15, y = pos.y - 35 })
			end
		end)
		indicatorTimer:start()

		pulseTimer = hs.timer.new(0.03, function()
			if transcribingIndicator and transcribingIndicator[1] then
				pulseAlpha = pulseAlpha + (pulseDirection * 0.02)
				if pulseAlpha >= 0.9 then
					pulseDirection = -1
				elseif pulseAlpha <= 0.3 then
					pulseDirection = 1
				end

				transcribingIndicator[1] = {
					type = "circle",
					action = "stroke",
					strokeColor = { red = 0, green = 0.8, blue = 1, alpha = pulseAlpha },
					strokeWidth = 3,
					center = { x = 15, y = 15 },
					radius = 12,
				}
			end
		end)
		pulseTimer:start()
	end

	local function cleanupIndicators()
		if indicatorTimer then
			indicatorTimer:stop()
			indicatorTimer = nil
		end

		if pulseTimer then
			pulseTimer:stop()
			pulseTimer = nil
		end

		if recordingIndicator then
			recordingIndicator:delete()
			recordingIndicator = nil
		end

		if transcribingIndicator then
			transcribingIndicator:delete()
			transcribingIndicator = nil
		end
	end

	local function cleanupRecordingRuntime()
		if rec_task and rec_task:isRunning() then
			rec_task:terminate()
		end
		rec_task = nil

		if stop_timer then
			stop_timer:stop()
			stop_timer = nil
		end

		cleanupIndicators()
		is_recording = false
		stop_requested = false
	end

	local function markRecordingStopped()
		if not telemetry or telemetry.recordingStoppedAt then
			return
		end

		local now = hs.timer.secondsSinceEpoch()
		telemetry.recordingStoppedAt = now
		if telemetry.recordingStartedAt then
			telemetry.recordingDuration = now - telemetry.recordingStartedAt
		end
	end

	local function transcribeAudio(path)
		local apiKey = manager.getSecret("GROQ_API_KEY")
		if not apiKey or apiKey == "" then
			notifyError("Whisper", "Missing Groq API key. Set it in the Whisper secrets menu.")
			playSound("error")
			if path then
				os.remove(path)
			end
			return
		end

		local attrs = path and hs.fs.attributes(path)
		if not attrs or (attrs.size or 0) < CONFIG.MIN_BYTES then
			if path then
				os.remove(path)
			end
			notifyError("Whisper", "Recording too short. Please speak longer.")
			return
		end

		is_busy = true
		createTranscribingIndicator()

		if telemetry then
			telemetry.transcriptionStartedAt = hs.timer.secondsSinceEpoch()
		else
			telemetry = { transcriptionStartedAt = hs.timer.secondsSinceEpoch() }
		end

		local args = {
			"-sS",
			"-m",
			tostring(CONFIG.API_TIMEOUT),
			"-H",
			"Authorization: Bearer " .. apiKey,
			"-F",
			"file=@" .. path .. ";type=audio/wav",
			"-F",
			"model=" .. CONFIG.MODEL,
			"-F",
			"response_format=json",
			"-w",
			'__CURL_TIMING__{"time_total":"%{time_total}","time_upload":"%{time_upload}","time_starttransfer":"%{time_starttransfer}","time_download":"%{time_download}"}',
			API_URL,
		}

		local curl = hs.task.new("/usr/bin/curl", function(exitCode, out, err)
			is_busy = false
			cleanupIndicators()
			if path then
				os.remove(path)
			end
			wav_path = nil

			local metrics = nil
			if out and out:find("__CURL_TIMING__") then
				local bodyPart, metricsPart = out:match("^(.*)__CURL_TIMING__(%b{})$")
				if bodyPart then
					out = bodyPart
					local okMetrics, parsed = pcall(hs.json.decode, metricsPart)
					if okMetrics and type(parsed) == "table" then
						metrics = parsed
						if telemetry then
							telemetry.curlMetrics = parsed
						end
					end
				end
			end

			out = (out or ""):gsub("%s+$", "")

			if exitCode ~= 0 then
				notifyError("Whisper", "Network error while calling API.")
				playSound("error")
				telemetry = nil
				return
			end

			local ok, body = pcall(hs.json.decode, out or "")
			if not ok or not body then
				notifyError("Whisper", "Invalid API response.")
				playSound("error")
				telemetry = nil
				return
			end

			if body.error then
				local msg = body.error.message or "Unknown API error"
				notifyError("Whisper", "Transcription error: " .. msg)
				playSound("error")
				telemetry = nil
				return
			end

			local text = (body.text or ""):gsub("^%s+", ""):gsub("%s+$", "")
			if text == "" then
				notifyError("Whisper", "No speech detected in audio.")
				telemetry = nil
				return
			end

			local now = hs.timer.secondsSinceEpoch()
			if telemetry then
				telemetry.transcriptionFinishedAt = now
				if not telemetry.curlMetrics and metrics then
					telemetry.curlMetrics = metrics
				end
			end

			hs.pasteboard.setContents(text)
			hs.eventtap.keyStroke({ "cmd" }, "v", 0)

			local preview = '"' .. (text:len() > 50 and text:sub(1, 50) .. "..." or text) .. '"'
			local summary = buildTelemetrySummary()
			if summary then
				log(summary)
			end
			notify("Whisper", preview)
			telemetry = nil
		end, args)

		curl:start()
	end

	local function stopRecordingAndTranscribe()
		if not is_recording then
			return
		end

		markRecordingStopped()
		cleanupRecordingRuntime()

		local path = wav_path
		wav_path = nil

		if not path then
			notifyError("Whisper", "No recording captured.")
			telemetry = nil
			return
		end

		transcribeAudio(path)
	end

	local function requestStopRecording()
		if not is_recording or stop_requested then
			return
		end

		stop_requested = true
		markRecordingStopped()

		if stop_timer then
			stop_timer:stop()
			stop_timer = nil
		end

		if rec_task and rec_task:isRunning() then
			rec_task:terminate()
		else
			stopRecordingAndTranscribe()
		end
	end

	local function startRecording()
		if is_busy or is_recording then
			return
		end

		if not rec_path then
			rec_path = which("rec")
			if not rec_path then
				notifyError("Whisper", "'sox' is not installed. Install via: brew install sox")
				playSound("error")
				return
			end
		end

		telemetry = { recordingStartedAt = hs.timer.secondsSinceEpoch() }
		stop_requested = false
		wav_path = tmpWavPath()
		is_recording = true

		rec_task = hs.task.new(rec_path, function(exitCode, out, err)
			stopRecordingAndTranscribe()
		end, {
			"-q",
			"-c",
			"1",
			"-r",
			tostring(CONFIG.SAMPLE_RATE),
			wav_path,
		})

		if not rec_task:start() then
			is_recording = false
			wav_path = nil
			notifyError("Whisper", "Could not start audio recording.")
			playSound("error")
			telemetry = nil
			return
		end

		stop_timer = hs.timer.doAfter(CONFIG.MAX_HOLD_SECONDS, requestStopRecording)
		createRecordingIndicator()
	end

	function P.getHotkeySpec()
		return {
			record = {
				fn = { press = startRecording, release = requestStopRecording },
				description = "Hold to Record",
			},
		}
	end

	function P.start()
		if hotkey then
			hotkey:delete()
			hotkey = nil
		end

		local hotkeyDef = manager.getHotkey(PACKAGE_ID, "record", DEFAULT_HOTKEY)
		if hotkeyDef then
			local spec = P.getHotkeySpec()
			local boundHotkeys = manager.bindHotkeysToSpec(PACKAGE_ID, spec, { record = hotkeyDef })
			hotkey = boundHotkeys.record
		end
	end

	function P.stop()
		if hotkey then
			hotkey:delete()
			hotkey = nil
		end
		cleanupRecordingRuntime()
		cleanupIndicators()
		if wav_path then
			os.remove(wav_path)
			wav_path = nil
		end
		is_busy = false
		telemetry = nil
	end

	function P.getMenuItems()
		return {
			{
				title = (settings.enableNotify and "[x] " or "") .. "Show notifications",
				fn = function()
					toggleNotifySetting()
				end,
			},
			{
				title = (settings.enableSound and "[x] " or "") .. "Play sounds",
				fn = function()
					toggleSoundSetting()
				end,
			},
		}
	end

	function P.getStatus()
		if is_busy then
			return "Transcribing..."
		elseif is_recording then
			return "Recording..."
		else
			return "Ready"
		end
	end

	return P
end
