--- STT
--- Hold a trigger to record audio and transcribe locally with Parakeet.
---
--- @package stt
--- @author m0hill

return function(manager)
	local P = {}
	local PACKAGE_ID = "stt"

	local DEFAULT_COMBO_HOTKEY = { { "alt" }, "/" }
	local TRIGGER_MODE_RIGHT_OPTION = "right_option_only"
	local TRIGGER_MODE_COMBO = "combo"
	local HELPER_MARKER = "__STT_JSON_B64__"

	local CONFIG = {
		SAMPLE_RATE = 16000,
		MIN_BYTES = 2000,
		MAX_HOLD_SECONDS = 300,
		RIGHT_OPTION_TRIGGER_DELAY = 0.15,
		ENABLE_NOTIFY = true,
		ENABLE_SOUND = true,
		RECORDING_INDICATOR_COLOR = { red = 1, green = 0, blue = 0, alpha = 0.9 },
		TRANSCRIBING_INDICATOR_COLOR = { red = 0, green = 0.8, blue = 1, alpha = 0.9 },
	}

	local rec_path = nil
	local is_recording = false
	local is_busy = false
	local is_downloading = false
	local rec_task = nil
	local stop_timer = nil
	local wav_path = nil
	local combo_hotkey = nil
	local right_option_tap = nil
	local right_option_down = false
	local right_option_cancelled = false
	local right_option_timer = nil
	local indicatorCanvas = nil
	local indicatorTimer = nil
	local pulseTimer = nil
	local pulseDirection = 1
	local pulseAlpha = 0.3
	local stop_requested = false
	local status_task = nil
	local download_task = nil
	local transcribe_task = nil

	local settings = {
		enableNotify = manager.getSetting(PACKAGE_ID, "enableNotify", CONFIG.ENABLE_NOTIFY),
		enableSound = manager.getSetting(PACKAGE_ID, "enableSound", CONFIG.ENABLE_SOUND),
		triggerMode = manager.getSetting(PACKAGE_ID, "triggerMode", TRIGGER_MODE_RIGHT_OPTION),
		comboHotkey = manager.getSetting(PACKAGE_ID, "comboHotkey", DEFAULT_COMBO_HOTKEY),
	}

	local helperState = {
		helperReady = false,
		modelAvailable = false,
		cacheRoot = nil,
		message = "Checking helper...",
		checked = false,
	}

	local function saveSetting(key, value)
		settings[key] = value
		manager.setSetting(PACKAGE_ID, key, value)
	end

	local function normalizeTriggerMode(value)
		if value == TRIGGER_MODE_COMBO then
			return TRIGGER_MODE_COMBO
		end
		return TRIGGER_MODE_RIGHT_OPTION
	end

	local function normalizeComboHotkey(value)
		if type(value) == "table" and #value >= 2 and type(value[1]) == "table" and type(value[2]) == "string" then
			return value
		end
		return DEFAULT_COMBO_HOTKEY
	end

	settings.triggerMode = normalizeTriggerMode(settings.triggerMode)
	settings.comboHotkey = normalizeComboHotkey(settings.comboHotkey)

	local function log(message)
		manager.log(PACKAGE_ID, message)
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

	local function helperRuntimeRoot()
		local home = os.getenv("HOME") or ""
		return home .. "/Library/Application Support/Hammerspoon/STT"
	end

	local function shellQuote(value)
		local escaped = tostring(value):gsub("\\", "\\\\"):gsub('"', '\\"')
		return '"' .. escaped .. '"'
	end

	local function helperBinaryPath()
		return helperRuntimeRoot() .. "/bin/stt-helper"
	end

	local function helperExists()
		local attrs = hs.fs.attributes(helperBinaryPath())
		if not attrs or attrs.mode ~= "file" then
			return false
		end
		local _, ok = hs.execute("/bin/test -x " .. shellQuote(helperBinaryPath()))
		return ok == true
	end

	local function helperMissingMessage()
		return "Helper missing. Build and install stt-helper. See packages/stt/README.md."
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
		local name = string.format("stt-%d-%d.wav", os.time(), math.random(1000, 9999))
		return dir .. name
	end

	local function stopIndicatorTracking()
		if indicatorTimer then
			indicatorTimer:stop()
			indicatorTimer = nil
		end
	end

	local function updateIndicatorPosition()
		if not indicatorCanvas then
			return
		end

		local pos = hs.mouse.absolutePosition()
		indicatorCanvas:topLeft({ x = pos.x - 15, y = pos.y - 35 })
	end

	local function startIndicatorTracking()
		if indicatorTimer then
			return
		end

		indicatorTimer = hs.timer.new(0.05, updateIndicatorPosition)
		indicatorTimer:start()
	end

	local function stopIndicatorPulse()
		if pulseTimer then
			pulseTimer:stop()
			pulseTimer = nil
		end
		pulseDirection = 1
		pulseAlpha = 0.3
	end

	local function ensureIndicator()
		if indicatorCanvas then
			return indicatorCanvas
		end

		local mousePos = hs.mouse.absolutePosition()
		indicatorCanvas = hs.canvas.new({
			x = mousePos.x - 15,
			y = mousePos.y - 35,
			w = 30,
			h = 30,
		})
		indicatorCanvas:show()
		return indicatorCanvas
	end

	local function setIndicatorMode(mode)
		local indicator = ensureIndicator()
		if not indicator then
			return
		end

		stopIndicatorPulse()

		if mode == "recording" then
			updateIndicatorPosition()
			indicator[1] = {
				type = "circle",
				action = "stroke",
				strokeColor = CONFIG.RECORDING_INDICATOR_COLOR,
				strokeWidth = 2,
				center = { x = 15, y = 15 },
				radius = 12,
			}

			indicator[2] = {
				type = "circle",
				action = "fill",
				fillColor = CONFIG.RECORDING_INDICATOR_COLOR,
				center = { x = 15, y = 15 },
				radius = 8,
			}
			startIndicatorTracking()
			return
		end

		stopIndicatorTracking()
		indicator[1] = {
			type = "circle",
			action = "stroke",
			strokeColor = { red = 0, green = 0.8, blue = 1, alpha = pulseAlpha },
			strokeWidth = 3,
			center = { x = 15, y = 15 },
			radius = 12,
		}

		indicator[2] = {
			type = "circle",
			action = "fill",
			fillColor = CONFIG.TRANSCRIBING_INDICATOR_COLOR,
			center = { x = 15, y = 15 },
			radius = 6,
		}

		pulseTimer = hs.timer.new(0.03, function()
			if indicatorCanvas and indicatorCanvas[1] then
				pulseAlpha = pulseAlpha + (pulseDirection * 0.02)
				if pulseAlpha >= 0.9 then
					pulseDirection = -1
				elseif pulseAlpha <= 0.3 then
					pulseDirection = 1
				end

				indicatorCanvas[1] = {
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
		stopIndicatorTracking()
		stopIndicatorPulse()

		if indicatorCanvas then
			indicatorCanvas:delete()
			indicatorCanvas = nil
		end
	end

	local function cleanupRecordingRuntime(keepIndicator)
		if rec_task and rec_task:isRunning() then
			rec_task:terminate()
		end
		rec_task = nil

		if stop_timer then
			stop_timer:stop()
			stop_timer = nil
		end

		if not keepIndicator then
			cleanupIndicators()
		end
		is_recording = false
		stop_requested = false
	end

	local function cleanupHelperTasks()
		local tasks = { status_task, download_task, transcribe_task }
		for _, task in ipairs(tasks) do
			if task and task:isRunning() then
				task:terminate()
			end
		end
		status_task = nil
		download_task = nil
		transcribe_task = nil
	end

	local function cancelPendingRightOptionStart()
		if right_option_timer then
			right_option_timer:stop()
			right_option_timer = nil
		end

		if not is_recording and not is_busy then
			cleanupIndicators()
		end
	end

	local function extractHelperPayload(output)
		local payload = nil
		for candidate in (output or ""):gmatch(HELPER_MARKER .. "([A-Za-z0-9+/=]+)") do
			payload = candidate
		end
		return payload
	end

	local function parseHelperResult(exitCode, stdout, stderr)
		local payload = extractHelperPayload(stdout) or extractHelperPayload(stderr)
		if payload then
			local okBase64, decodedBase64 = pcall(hs.base64.decode, payload)
			local ok, decoded = pcall(hs.json.decode, okBase64 and decodedBase64 or "")
			if ok and type(decoded) == "table" then
				return decoded
			end
		end

		local fallback = (stderr or "") ~= "" and stderr or stdout or ""
		fallback = fallback:gsub("%s+$", "")
		if fallback == "" then
			fallback = exitCode == 0 and "Helper finished without output." or "Helper failed."
		end

		return {
			ok = exitCode == 0,
			error = fallback,
		}
	end

	local function applyHelperState(result)
		helperState.checked = true
		helperState.helperReady = result and result.helperReady == true or false
		helperState.modelAvailable = result and result.modelAvailable == true or false
		helperState.cacheRoot = result and result.cacheRoot or nil

		if not helperExists() then
			helperState.helperReady = false
			helperState.modelAvailable = false
			helperState.message = helperMissingMessage()
		elseif result and result.ok == false then
			helperState.message = result.error or "Helper error."
		elseif helperState.modelAvailable then
			helperState.message = "Ready"
		elseif helperState.helperReady then
			helperState.message = "Model missing"
		else
			helperState.message = result and result.message or "Helper not ready"
		end
	end

	local function runHelper(args, onComplete)
		local path = helperBinaryPath()
		local commandName = args[1] or "helper"
		if not helperExists() then
			local result = { ok = false, helperReady = false, modelAvailable = false, error = helperMissingMessage() }
			applyHelperState(result)
			manager.refreshMenu()
			return nil, result.error
		end

		local task = hs.task.new(path, function(exitCode, stdout, stderr)
			local result = parseHelperResult(exitCode, stdout, stderr)
			stdout = (stdout or ""):gsub("%s+$", "")
			stderr = (stderr or ""):gsub("%s+$", "")
			if stderr ~= "" then
				log(commandName .. " stderr: " .. stderr)
			end
			if result and result.ok ~= true then
				log(commandName .. " failed: " .. (result.error or "unknown error"))
			end
			onComplete(exitCode, result, stdout, stderr)
		end, args)

		if not task then
			helperState.checked = true
			helperState.helperReady = false
			helperState.message = "Could not create stt-helper task."
			return nil, "Could not create stt-helper task."
		end

		if not task:start() then
			helperState.checked = true
			helperState.helperReady = false
			helperState.message = "Could not start stt-helper task."
			return nil, "Could not start stt-helper task."
		end

		return task
	end

	local function refreshHelperStatus()
		if status_task or is_downloading or is_busy then
			return
		end

		status_task, _ = runHelper({ "status" }, function(_, result)
			status_task = nil
			applyHelperState(result)
			manager.refreshMenu()
		end)
	end

	local function getTriggerDisplay()
		if settings.triggerMode == TRIGGER_MODE_RIGHT_OPTION then
			return "Right Option"
		end
		return manager.formatHotkeyString(settings.comboHotkey)
	end

	local function stopTriggerBinding()
		if combo_hotkey then
			combo_hotkey:delete()
			combo_hotkey = nil
		end

		if right_option_tap then
			right_option_tap:stop()
			right_option_tap = nil
		end

		cancelPendingRightOptionStart()
		right_option_down = false
		right_option_cancelled = false
	end

	local function stopRecordingAndTranscribe()
		if not is_recording then
			return
		end

		setIndicatorMode("transcribing")
		cleanupRecordingRuntime(true)

		local path = wav_path
		wav_path = nil

		if not path then
			cleanupIndicators()
			notifyError("STT", "No recording captured.")
			return
		end

		local attrs = hs.fs.attributes(path)
		if not attrs or (attrs.size or 0) < CONFIG.MIN_BYTES then
			cleanupIndicators()
			os.remove(path)
			notifyError("STT", "Recording too short. Please speak longer.")
			return
		end

		if not helperExists() then
			cleanupIndicators()
			os.remove(path)
			applyHelperState({ ok = false, helperReady = false, modelAvailable = false, error = helperMissingMessage() })
			notifyError("STT", helperMissingMessage(), "Basso")
			manager.refreshMenu()
			return
		end

		if not helperState.modelAvailable then
			cleanupIndicators()
			os.remove(path)
			notifyError("STT", "Model missing. Open STT menu and click Download Model.", "Basso")
			refreshHelperStatus()
			return
		end

		is_busy = true
		setIndicatorMode("transcribing")
		playSound("process")
		log("Transcribing with local Parakeet")
		manager.refreshMenu()

		transcribe_task, _ = runHelper({ "transcribe", "--input", path }, function(_, result)
			transcribe_task = nil
			is_busy = false
			cleanupIndicators()
			if path then
				os.remove(path)
			end

			if result and result.helperReady ~= nil then
				applyHelperState(result)
			end

			if not result or result.ok ~= true then
				notifyError("STT", result and result.error or "Transcription failed.", "Basso")
				playSound("error")
				refreshHelperStatus()
				manager.refreshMenu()
				return
			end

			local text = (result.text or ""):gsub("^%s+", ""):gsub("%s+$", "")
			if text == "" then
				notifyError("STT", "No speech detected in audio.")
				manager.refreshMenu()
				return
			end

			hs.pasteboard.setContents(text)
			hs.eventtap.keyStroke({ "cmd" }, "v", 0)

			local preview = '"' .. (text:len() > 50 and text:sub(1, 50) .. "..." or text) .. '"'
			notify("STT", preview, "Glass")
			playSound("success")
			manager.refreshMenu()
		end)

		if not transcribe_task then
			is_busy = false
			cleanupIndicators()
			os.remove(path)
			notifyError("STT", "Could not start stt-helper.", "Basso")
			playSound("error")
			manager.refreshMenu()
		end
	end

	local function requestStopRecording()
		if not is_recording or stop_requested then
			return
		end

		stop_requested = true
		setIndicatorMode("transcribing")

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
		if is_busy or is_recording or is_downloading then
			if not is_recording then
				cleanupIndicators()
			end
			return
		end

		if settings.triggerMode == TRIGGER_MODE_RIGHT_OPTION and hs.eventtap.isSecureInputEnabled() then
			cleanupIndicators()
			notifyError("STT", "Secure Input is enabled, so Right Option trigger is blocked.", "Basso")
			return
		end

		setIndicatorMode("recording")

		if not rec_path then
			rec_path = which("rec")
			if not rec_path then
				cleanupIndicators()
				notifyError("STT", "'sox' is not installed. Install via: brew install sox", "Basso")
				playSound("error")
				return
			end
		end

		wav_path = tmpWavPath()
		stop_requested = false
		is_recording = true

		-- Record Parakeet-friendly WAV to keep the helper simple and predictable.
		rec_task = hs.task.new(rec_path, function()
			stopRecordingAndTranscribe()
		end, {
			"-q",
			"-c",
			"1",
			"-r",
			tostring(CONFIG.SAMPLE_RATE),
			"-b",
			"32",
			"-e",
			"floating-point",
			wav_path,
		})

		if not rec_task then
			is_recording = false
			wav_path = nil
			cleanupIndicators()
			notifyError("STT", "Could not create audio recording task.", "Basso")
			playSound("error")
			return
		end

		if not rec_task:start() then
			is_recording = false
			wav_path = nil
			rec_task = nil
			cleanupIndicators()
			notifyError("STT", "Could not start audio recording.", "Basso")
			playSound("error")
			return
		end

		stop_timer = hs.timer.doAfter(CONFIG.MAX_HOLD_SECONDS, requestStopRecording)
		playSound("start")
		manager.refreshMenu()
	end

	local function bindTrigger()
		stopTriggerBinding()

		if settings.triggerMode == TRIGGER_MODE_COMBO then
			local spec = {
				record = {
					fn = { press = startRecording, release = requestStopRecording },
					description = "Hold to Record",
				},
			}
			local bound = manager.bindHotkeysToSpec(PACKAGE_ID, spec, { record = settings.comboHotkey })
			combo_hotkey = bound.record
			return
		end

		local rawFlagMasks = hs.eventtap.event.rawFlagMasks or {}
		local rightAltMask = rawFlagMasks.deviceRightAlternate or 0
		local altMask = rawFlagMasks.alternate or 0
		local ignoreMask = (rawFlagMasks.nonCoalesced or 0) | 0x20000000
		local allowedMask = rightAltMask | altMask

		local function startPendingRightOption()
			if is_busy or is_recording or is_downloading then
				return
			end

			cancelPendingRightOptionStart()
			setIndicatorMode("recording")
			right_option_timer = hs.timer.doAfter(CONFIG.RIGHT_OPTION_TRIGGER_DELAY, function()
				right_option_timer = nil
				if right_option_down and not right_option_cancelled and not is_recording then
					startRecording()
				end
			end)
		end

		local function cancelRightOptionOnlyTrigger()
			right_option_cancelled = true
			cancelPendingRightOptionStart()
		end

		right_option_tap = hs.eventtap.new({ hs.eventtap.event.types.flagsChanged, hs.eventtap.event.types.keyDown, hs.eventtap.event.types.keyUp }, function(event)
			local eventType = event:getType()
			local flags = event:rawFlags() & (~ignoreMask)
			local hasOtherModifiers = (flags & (~allowedMask)) ~= 0
			local isDown = (flags & rightAltMask) ~= 0

			if eventType == hs.eventtap.event.types.keyDown or eventType == hs.eventtap.event.types.keyUp then
				if right_option_down and not is_recording then
					cancelRightOptionOnlyTrigger()
				end
				return false
			end

			if right_option_down and hasOtherModifiers and not is_recording then
				cancelRightOptionOnlyTrigger()
			end

			if isDown == right_option_down then
				return false
			end

			right_option_down = isDown
			if isDown then
				right_option_cancelled = hasOtherModifiers
				if not right_option_cancelled then
					startPendingRightOption()
				end
			else
				cancelPendingRightOptionStart()
				right_option_cancelled = false
				requestStopRecording()
			end

			return false
		end)

		right_option_tap:start()
	end

	local function setTriggerMode(mode)
		mode = normalizeTriggerMode(mode)
		saveSetting("triggerMode", mode)
		bindTrigger()
		manager.refreshMenu()
	end

	local function openComboPrompt()
		local currentStr = manager.formatHotkeyString(settings.comboHotkey)
		local button, text = hs.dialog.textPrompt(
			"Configure STT Combo",
			"Enter trigger combo like Option+/. Right Option mode is configured separately.",
			currentStr,
			"Save",
			"Cancel"
		)
		if button ~= "Save" then
			return
		end

		local parsed = manager.parseHotkeyString(text or "")
		if not parsed then
			manager.notify("STT", "Invalid hotkey format")
			return
		end

		saveSetting("comboHotkey", parsed)
		bindTrigger()
		manager.refreshMenu()
	end

	local function startDownload()
		if is_downloading or is_busy or is_recording then
			return
		end

		is_downloading = true
		helperState.message = "Downloading model..."
		notify("STT", "Downloading Parakeet model...", "Tink")
		manager.refreshMenu()

		download_task, _ = runHelper({ "download" }, function(_, result)
			download_task = nil
			is_downloading = false
			applyHelperState(result)
		if result and result.ok == true and result.modelAvailable == true then
				log("download ready path=" .. tostring(result.modelPath or "unknown"))
				notify("STT", "Parakeet model downloaded.", "Glass")
				playSound("success")
			else
				log("download not ready path=" .. tostring(result and result.modelPath or "unknown"))
				notifyError("STT", result and result.error or "Download failed.", "Basso")
				playSound("error")
			end
			manager.refreshMenu()
		end)

		if not download_task then
			is_downloading = false
			notifyError("STT", helperState.message or helperMissingMessage(), "Basso")
			manager.refreshMenu()
		end
	end

	local function deleteModel()
		if is_downloading or is_busy or is_recording then
			return
		end

		is_downloading = true
		helperState.message = "Deleting model..."
		notify("STT", "Deleting Parakeet model...", "Tink")
		manager.refreshMenu()

		download_task, _ = runHelper({ "delete" }, function(_, result)
			download_task = nil
			is_downloading = false
			applyHelperState(result)
			if result and result.ok == true and result.modelAvailable ~= true then
				log("delete finished path=" .. tostring(result.modelPath or "unknown"))
				notify("STT", "Parakeet model deleted.", "Glass")
				playSound("success")
			else
				log("delete failed path=" .. tostring(result and result.modelPath or "unknown"))
				notifyError("STT", result and result.error or "Delete failed.", "Basso")
				playSound("error")
			end
			manager.refreshMenu()
		end)

		if not download_task then
			is_downloading = false
			notifyError("STT", helperState.message or helperMissingMessage(), "Basso")
			manager.refreshMenu()
		end
	end

	local function toggleNotifySetting()
		saveSetting("enableNotify", not settings.enableNotify)
	end

	local function toggleSoundSetting()
		saveSetting("enableSound", not settings.enableSound)
	end

	function P.start()
		bindTrigger()
		refreshHelperStatus()
	end

	function P.stop()
		stopTriggerBinding()
		cancelPendingRightOptionStart()
		cleanupRecordingRuntime()
		cleanupIndicators()
		cleanupHelperTasks()
		if wav_path then
			os.remove(wav_path)
			wav_path = nil
		end
		is_busy = false
		is_downloading = false
	end

	function P.getMenuItems()
		local helperLine = helperExists() and "Helper: installed" or "Helper: missing"
		local statusLine = helperState.message
		if settings.triggerMode == TRIGGER_MODE_RIGHT_OPTION and hs.eventtap.isSecureInputEnabled() and not is_recording then
			statusLine = "Secure Input blocks Right Option"
		end

		local comboDisplay = manager.formatHotkeyString(settings.comboHotkey)

		return {
			{
				title = helperLine,
				disabled = true,
			},
			{
				title = "Status: " .. statusLine,
				disabled = true,
			},
			{
				title = is_downloading and (helperState.modelAvailable and "Deleting Model..." or "Downloading Model...")
					or (helperState.modelAvailable and "Delete Model" or "Download Model"),
				disabled = is_downloading or not helperExists(),
				fn = helperState.modelAvailable and deleteModel or startDownload,
			},
			{
				title = "Recheck Status",
				fn = refreshHelperStatus,
			},
			{ title = "-" },
			{
				title = "Trigger: " .. getTriggerDisplay(),
				disabled = true,
			},
			{
				title = (settings.triggerMode == TRIGGER_MODE_RIGHT_OPTION and "[x] " or "") .. "Use Right Option",
				fn = function()
					setTriggerMode(TRIGGER_MODE_RIGHT_OPTION)
				end,
			},
			{
				title = (settings.triggerMode == TRIGGER_MODE_COMBO and "[x] " or "") .. "Use Combo",
				fn = function()
					setTriggerMode(TRIGGER_MODE_COMBO)
				end,
			},
			{
				title = "Set Combo: " .. comboDisplay,
				disabled = settings.triggerMode ~= TRIGGER_MODE_COMBO,
				fn = openComboPrompt,
			},
			{ title = "-" },
			{
				title = (settings.enableNotify and "[x] " or "") .. "Show notifications",
				fn = toggleNotifySetting,
			},
			{
				title = (settings.enableSound and "[x] " or "") .. "Play sounds",
				fn = toggleSoundSetting,
			},
		}
	end

	function P.getStatus()
		if is_downloading then
			return "Downloading..."
		elseif is_busy then
			return "Transcribing..."
		elseif is_recording then
			return "Recording..."
		elseif settings.triggerMode == TRIGGER_MODE_RIGHT_OPTION and hs.eventtap.isSecureInputEnabled() then
			return "Secure Input"
		elseif not helperExists() then
			return "Helper missing"
		elseif helperState.checked and helperState.modelAvailable then
			return "Ready"
		elseif helperState.checked and helperState.helperReady then
			return "Model missing"
		else
			return helperState.message or "Checking..."
		end
	end

	return P
end
