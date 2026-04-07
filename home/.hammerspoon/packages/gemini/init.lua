--- Gemini OCR
--- Screenshot OCR using Google Gemini API. Select a region to extract text.
---
--- @package gemini
--- @author m0hill

return function(manager)
	local P = {}
	local PACKAGE_ID = "gemini"
	local DEFAULT_HOTKEY = { { "cmd", "shift" }, "s" }

	local CONFIG = {
		MODEL = "gemini-3.1-flash-lite-preview",
		MIME_TYPE = "image/png",
		PROMPT = table.concat({
			"Extract all text from this image. If the text is in a non-english language, translate it to English.",
			"Format it in a clear, organized way with proper spacing and line breaks.",
			"Use only these symbols: hyphens (-), commas (,), numbers (1, 2, 3), and spaces for indentation.",
			"When separating information, use a hyphen (-) or comma (,) or space or new line (whatever is appropriate).",
			"Do not use bullets or bullet symbols like bullet points. Do not use asterisks.",
			"Put your entire answer inside a code block using three backticks (```).",
		}, " "),
		SCREENSHOT_TIMEOUT = 60,
	}

	local settings = {
		enableNotify = manager.getSetting(PACKAGE_ID, "enableNotify", true),
		enableSound = manager.getSetting(PACKAGE_ID, "enableSound", true),
		prompt = manager.getSetting(PACKAGE_ID, "prompt", nil),
	}

	local state = {
		captureTask = nil,
		busy = false,
		timer = nil,
		hotkey = nil,
	}

	local function saveSetting(key, value)
		settings[key] = value
		manager.setSetting(PACKAGE_ID, key, value)
	end

	local function playSound(soundType)
		if not settings.enableSound then
			return
		end
		manager.playSound(soundType)
	end

	local function notify(title, text)
		if not settings.enableNotify then
			return
		end
		manager.notify(title, text, {
			withdrawAfter = 4,
		})
	end

	local function notifyError(title, text)
		manager.notifyError(title, text, {
			withdrawAfter = 4,
			notify = settings.enableNotify,
		})
	end

	local function log(level, message)
		local line = string.format("Gemini OCR [%s] %s", level, message)
		if hs.printf then
			hs.printf("%s", line)
		else
			print(line)
		end
	end

	local function previewText(value, limit)
		if type(value) ~= "string" then
			return "<non-string>"
		end
		local compact = value:gsub("%s+", " ")
		if #compact <= limit then
			return compact
		end
		return compact:sub(1, limit - 3) .. "..."
	end

	local function cleanUp(path)
		if path and hs.fs.attributes(path) then
			os.remove(path)
		end
	end

	local function reset(path)
		state.busy = false
		if state.captureTask then
			state.captureTask = nil
		end
		if state.timer then
			state.timer:stop()
			state.timer = nil
		end
		cleanUp(path)
	end

	local function getPrompt()
		if settings.prompt and settings.prompt ~= "" then
			return settings.prompt
		end
		return CONFIG.PROMPT
	end

	local function setPrompt(newPrompt)
		if newPrompt and newPrompt ~= "" then
			settings.prompt = newPrompt
			manager.setSetting(PACKAGE_ID, "prompt", newPrompt)
		else
			settings.prompt = nil
			manager.setSetting(PACKAGE_ID, "prompt", nil)
		end
	end

	local function editPrompt()
		local current = settings.prompt or ""
		local hint = "Enter a custom prompt for Gemini OCR. Leave empty to use default."
		local button, text = hs.dialog.textPrompt("Gemini Prompt", hint, current, "Save", "Cancel")
		if button == "Save" then
			setPrompt(text)
		end
	end

	local function extractTextFromResponse(body)
		if type(body) ~= "table" then
			log("error", "Response decode returned non-table")
			return nil
		end

		if type(body.error) == "table" then
			local message = tostring(body.error.message or "unknown API error")
			local status = tostring(body.error.status or "unknown status")
			log("error", string.format("Gemini API error status=%s message=%s", status, message))
		end

		local candidates = body.candidates
		if type(candidates) ~= "table" then
			log("error", "Response missing candidates")
			return nil
		end

		for _, candidate in ipairs(candidates) do
			local content = candidate.content
			if type(content) == "table" then
				local parts = content.parts
				if type(parts) == "table" then
					for _, part in ipairs(parts) do
						if type(part.text) == "string" and part.text ~= "" then
							return part.text
						end
					end
				end
			end
		end

		return nil
	end

	local function postToGemini(path)
		local attrs = hs.fs.attributes(path)
		if not attrs or attrs.size == 0 then
			reset(path)
			return
		end

		local apiKey = manager.getSecret("GEMINI_API_KEY")
		if not apiKey or apiKey == "" then
			reset(path)
			notifyError("Gemini OCR", "GEMINI_API_KEY is missing")
			playSound("error")
			return
		end

		local file = io.open(path, "rb")
		if not file then
			reset(path)
			notifyError("Gemini OCR", "Unable to read screenshot")
			playSound("error")
			return
		end

		local bytes = file:read("*all")
		file:close()

		local encoded = hs.base64.encode(bytes, false)
		local payload = {
			contents = {
				{
					parts = {
						{
							inline_data = {
								mime_type = CONFIG.MIME_TYPE,
								data = encoded,
							},
						},
						{
							text = getPrompt(),
						},
					},
				},
			},
		}

		local body = hs.json.encode(payload)
		local headers = {
			["Content-Type"] = "application/json",
			["x-goog-api-key"] = apiKey,
		}

		local apiUrl = "https://generativelanguage.googleapis.com/v1beta/models/" .. CONFIG.MODEL .. ":generateContent"

		hs.http.asyncPost(apiUrl, body, headers, function(status, responseData, responseHeaders)
			local resultText = nil
			log("info", string.format("HTTP status=%s model=%s", tostring(status), CONFIG.MODEL))
			if type(responseData) == "string" and responseData ~= "" then
				log("info", "Raw response: " .. previewText(responseData, 600))
			end
			if status == 200 and type(responseData) == "string" then
				local ok, decoded = pcall(hs.json.decode, responseData)
				if ok then
					resultText = extractTextFromResponse(decoded)
				else
					log("error", "JSON decode failed: " .. tostring(decoded))
				end
			elseif type(responseHeaders) == "table" then
				log("error", "Non-200 response headers seen")
			end

			if not resultText or resultText == "" then
				reset(path)
				notifyError("Gemini OCR", "Failed to interpret API response")
				playSound("error")
				return
			end

			local cleaned = resultText:gsub("^```[%w]*\n?", ""):gsub("\n?```$", "")
			hs.pasteboard.setContents(cleaned)

			local preview = cleaned
			if #preview > 150 then
				preview = preview:sub(1, 147) .. "..."
			end

			notify("Gemini OCR", preview)
			playSound("success")
			reset(path)
		end)
	end

	local function startCapture()
		if state.busy then
			return
		end

		local tmpDir = hs.fs.temporaryDirectory()
		local tmpPath = tmpDir .. string.format("gemini_%d.png", hs.timer.absoluteTime())
		state.busy = true
		playSound("capture")

		state.timer = hs.timer.doAfter(CONFIG.SCREENSHOT_TIMEOUT, function()
			if state.captureTask then
				state.captureTask:terminate()
			end
			reset(tmpPath)
			notifyError("Gemini OCR", "Screenshot timed out")
			playSound("error")
		end)

		state.captureTask = hs.task.new("/usr/sbin/screencapture", function(exitCode)
			if exitCode ~= 0 then
				reset(tmpPath)
				playSound("cancel")
				return
			end

			if state.timer then
				state.timer:stop()
				state.timer = nil
			end

			postToGemini(tmpPath)
		end, { "-i", "-o", "-x", "-t", "png", tmpPath })

		if not state.captureTask:start() then
			reset(tmpPath)
			notifyError("Gemini OCR", "Unable to start screenshot")
			playSound("error")
			return
		end
	end

	function P.getHotkeySpec()
		return {
			capture = {
				fn = startCapture,
				description = "Start Capture",
			},
		}
	end

	function P.start()
		if state.hotkey then
			state.hotkey:delete()
			state.hotkey = nil
		end

		local hotkeyDef = manager.getHotkey(PACKAGE_ID, "capture", DEFAULT_HOTKEY)
		if hotkeyDef then
			local spec = P.getHotkeySpec()
			local boundHotkeys = manager.bindHotkeysToSpec(PACKAGE_ID, spec, { capture = hotkeyDef })
			state.hotkey = boundHotkeys.capture
		end
	end

	function P.stop()
		if state.hotkey then
			state.hotkey:delete()
			state.hotkey = nil
		end
		if state.captureTask then
			state.captureTask:terminate()
			state.captureTask = nil
		end
		if state.timer then
			state.timer:stop()
			state.timer = nil
		end
		state.busy = false
	end

	function P.getStatus()
		return state.busy and "Processing..." or "Ready"
	end

	function P.getMenuItems()
		return {
			{
				title = (settings.enableNotify and "[x] " or "") .. "Show notifications",
				fn = function()
					saveSetting("enableNotify", not settings.enableNotify)
				end,
			},
			{
				title = (settings.enableSound and "[x] " or "") .. "Play sounds",
				fn = function()
					saveSetting("enableSound", not settings.enableSound)
				end,
			},
			{ title = "-" },
			{
				title = settings.prompt and "Edit Prompt (Custom)" or "Set Prompt (Default)",
				fn = function()
					editPrompt()
				end,
			},
			{
				title = "Reset Prompt to Default",
				disabled = settings.prompt == nil,
				fn = function()
					setPrompt(nil)
				end,
			},
		}
	end

	return P
end
