--- Lyrics Overlay
--- Real-time synchronized lyrics display for Spotify with draggable overlay.
---
--- @package lyrics
--- @author m0hill

return function(manager)
	local P = {}
	local PACKAGE_ID = "lyrics"
	local POLL_INTERVAL = 0.5
	local API_ENDPOINT = "https://lrclib.net/api/get"
	local DEFAULT_TEXT_SIZES = { info = 15, current = 26, next = 18 }

	local pollTimer = nil
	local overlay = nil
	local currentTrackId = nil
	local currentTrackState = nil
	local lyricsState = nil
	local fetchToken = 0
	local dragContext = nil
	local dragEventTap = nil
	local text_size_state = nil
	local last_error = nil
	local ensureOverlay

	local function formatTime(seconds)
		if not seconds or seconds < 0 then
			return "--:--"
		end
		local rounded = math.floor(seconds + 0.5)
		local minutes = math.floor(rounded / 60)
		local secs = rounded % 60
		return string.format("%d:%02d", minutes, secs)
	end

	local function getOverlayScale()
		local scale = manager.getSetting(PACKAGE_ID, "overlay.scale", 1.0)
		if type(scale) ~= "number" or scale <= 0 then
			return 1.0
		end
		return math.min(scale, 4.0)
	end

	local function getTextSizes()
		local scale = getOverlayScale()
		local stored = manager.getSetting(PACKAGE_ID, "overlay.textSizes")
		local result = {}

		for key, defaultSize in pairs(DEFAULT_TEXT_SIZES) do
			local size = defaultSize
			if type(stored) == "table" and type(stored[key]) == "number" and stored[key] > 0 then
				size = stored[key]
			end
			result[key] = math.max(8, math.floor(size * scale + 0.5))
		end

		return result
	end

	local function applyTextSizes(canvas)
		local sizes = getTextSizes()
		if text_size_state and text_size_state.info == sizes.info and text_size_state.current == sizes.current and text_size_state.next == sizes.next then
			return
		end

		canvas["info"].textSize = sizes.info
		canvas["current"].textSize = sizes.current
		canvas["next"].textSize = sizes.next
		text_size_state = sizes
	end

	local function resizeOverlayForScale()
		if not overlay then
			return
		end

		local screen = hs.screen.mainScreen():frame()
		local scale = getOverlayScale()
		local width = math.min(math.floor(600 * scale), math.floor(screen.w * 0.8))
		local height = math.min(math.floor(170 * scale), math.floor(screen.h * 0.6))
		width = math.max(width, 260)
		height = math.max(height, 120)

		local frame = overlay:frame()
		local center = { x = frame.x + frame.w / 2, y = frame.y + frame.h / 2 }
		local newFrame = {
			x = center.x - width / 2,
			y = center.y - height / 2,
			w = width,
			h = height,
		}

		overlay:frame(newFrame)
		manager.setSetting(PACKAGE_ID, "overlay.frame", newFrame)
		applyTextSizes(overlay)
	end

	local function setOverlayScale(newScale)
		local clamped = math.max(0.6, math.min(4.0, newScale))
		manager.setSetting(PACKAGE_ID, "overlay.scale", clamped)
		resizeOverlayForScale()
	end

	local function bumpOverlayScale(delta)
		setOverlayScale(getOverlayScale() + delta)
	end

	local function resetOverlaySizes()
		manager.setSetting(PACKAGE_ID, "overlay.scale", 1.0)
		manager.setSetting(PACKAGE_ID, "overlay.textSizes", nil)
		text_size_state = nil
		resizeOverlayForScale()
	end

	local function shouldDisplayOverlay(state)
		if not manager.getSetting(PACKAGE_ID, "overlay.visible", true) then
			return false
		end
		if not state or state.playerState ~= "playing" then
			return false
		end
		return true
	end

	local function syncOverlayVisibility(shouldShow)
		if shouldShow then
			if not overlay then
				ensureOverlay()
			end
			if overlay then
				overlay:show()
			end
		elseif overlay then
			overlay:hide()
		end
	end

	local function parseSyncedLyrics(raw)
		if type(raw) ~= "string" or raw == "" then
			return nil
		end

		local entries = {}
		for line in raw:gmatch("[^\r\n]+") do
			local stamps = {}
			for tag in line:gmatch("%[[^%]]+%]") do
				local m, s = tag:match("%[(%d+):(%d+%.?%d*)%]")
				if m and s then
					local total = tonumber(m) * 60 + tonumber(s)
					table.insert(stamps, total)
				end
			end

			local text = line:gsub("%[[^%]]+%]", "")
			text = text:gsub("^%s+", ""):gsub("%s+$", "")

			if #stamps > 0 then
				for _, ts in ipairs(stamps) do
					table.insert(entries, { time = ts, text = text })
				end
			end
		end

		if #entries == 0 then
			return nil
		end

		table.sort(entries, function(a, b)
			return a.time < b.time
		end)
		return entries
	end

	ensureOverlay = function()
		if overlay then
			return overlay
		end

		local frame = manager.getSetting(PACKAGE_ID, "overlay.frame")
		if not frame then
			local screen = hs.screen.mainScreen():frame()
			local scale = getOverlayScale()
			local width = math.min(math.floor(600 * scale), math.floor(screen.w * 0.8))
			local height = math.min(math.floor(170 * scale), math.floor(screen.h * 0.6))
			width = math.max(width, 260)
			height = math.max(height, 120)
			frame = {
				x = screen.x + (screen.w - width) / 2,
				y = screen.y + screen.h - height - 120,
				w = width,
				h = height,
			}
		end

		overlay = hs.canvas.new(frame)
		overlay:level(hs.canvas.windowLevels.floating)
		overlay:alpha(0.97)
		overlay:clickActivating(false)
		overlay:behavior(hs.canvas.windowBehaviors.canJoinAllSpaces + hs.canvas.windowBehaviors.stationary)

		overlay:appendElements({
			id = "background",
			type = "rectangle",
			action = "fill",
			fillColor = { white = 0.08, alpha = 0.65 },
			roundedRectRadii = { xRadius = 14, yRadius = 14 },
			trackMouseDown = true,
		}, {
			id = "info",
			type = "text",
			frame = { x = "5%", y = "6%", w = "90%", h = "18%" },
			text = "",
			textAlignment = "center",
			textColor = { white = 0.85 },
			textFont = "Helvetica Neue",
			textSize = DEFAULT_TEXT_SIZES.info,
			textLineBreak = "truncateTail",
		}, {
			id = "current",
			type = "text",
			frame = { x = "5%", y = "28%", w = "90%", h = "40%" },
			text = "",
			textAlignment = "center",
			textColor = { white = 1 },
			textFont = "Helvetica Neue Bold",
			textSize = DEFAULT_TEXT_SIZES.current,
			textLineBreak = "wordWrap",
		}, {
			id = "next",
			type = "text",
			frame = { x = "5%", y = "70%", w = "90%", h = "22%" },
			text = "",
			textAlignment = "center",
			textColor = { white = 0.7 },
			textFont = "Helvetica Neue",
			textSize = DEFAULT_TEXT_SIZES.next,
			textLineBreak = "truncateTail",
		})

		overlay:mouseCallback(function(canvas, message, elementId, x, y)
			if message == "mouseDown" and elementId == "background" then
				local mousePos = hs.mouse.absolutePosition()
				dragContext = {
					origin = mousePos,
					frameStart = canvas:frame(),
				}

				if dragEventTap then
					dragEventTap:stop()
				end

				dragEventTap = hs.eventtap
					.new({ hs.eventtap.event.types.leftMouseDragged, hs.eventtap.event.types.leftMouseUp }, function(event)
						if event:getType() == hs.eventtap.event.types.leftMouseDragged then
							if dragContext then
								local mousePosNow = hs.mouse.absolutePosition()
								local dx = mousePosNow.x - dragContext.origin.x
								local dy = mousePosNow.y - dragContext.origin.y
								local frameNow = dragContext.frameStart
								canvas:frame({
									x = frameNow.x + dx,
									y = frameNow.y + dy,
									w = frameNow.w,
									h = frameNow.h,
								})
							end
						elseif event:getType() == hs.eventtap.event.types.leftMouseUp then
							if dragContext then
								local f = canvas:frame()
								manager.setSetting(PACKAGE_ID, "overlay.frame", {
									x = f.x,
									y = f.y,
									w = f.w,
									h = f.h,
								})
								dragContext = nil
							end
							if dragEventTap then
								dragEventTap:stop()
								dragEventTap = nil
							end
						end
						return false
					end)
					:start()
			end
		end)

		if manager.getSetting(PACKAGE_ID, "overlay.visible", true) then
			overlay:show()
		end
		applyTextSizes(overlay)
		return overlay
	end

	local function updateOverlayTexts(infoText, mainText, secondaryText)
		if not overlay then
			return
		end
		applyTextSizes(overlay)
		overlay["info"].text = infoText or ""
		overlay["current"].text = mainText or ""
		overlay["next"].text = secondaryText or ""
	end

	local function logErrorOnce(key, message)
		if key == last_error then
			return
		end
		last_error = key
		manager.notifyError("Lyrics", message, { notify = false })
	end

	local function getSpotifyState()
		local script = [[
set spotifyRunning to false
tell application "System Events"
    if (name of processes) contains "Spotify" then set spotifyRunning to true
end tell
if spotifyRunning then
    tell application "Spotify"
        set playerState to player state as string
        if playerState is "stopped" then
            return {playerState:playerState}
        end if
        set trackName to name of current track
        set trackArtist to artist of current track
        set trackAlbum to album of current track
        set trackDuration to duration of current track
        set trackPosition to player position
        return {playerState:playerState, trackName:trackName, trackArtist:trackArtist, trackAlbum:trackAlbum, trackDuration:trackDuration, trackPosition:trackPosition}
    end tell
else
    return {playerState:"not_running"}
end if
]]

		local okScript, ok, result = pcall(hs.osascript.applescript, script)
		if not okScript then
			logErrorOnce("spotify-applescript", "Spotify AppleScript error: " .. tostring(ok))
			return { playerState = "error" }
		end

		if not ok then
			logErrorOnce("spotify-applescript", "Spotify AppleScript failed: " .. tostring(result))
			return { playerState = "error" }
		end

		if type(result) ~= "table" then
			logErrorOnce("spotify-response", "Spotify AppleScript returned unexpected data")
			return { playerState = "unknown" }
		end

		local state = {
			playerState = result.playerState or "unknown",
			name = result.trackName,
			artist = result.trackArtist,
			album = result.trackAlbum,
		}

		if result.trackDuration then
			local durationMs = tonumber(result.trackDuration)
			if durationMs and durationMs > 0 then
				state.duration = durationMs / 1000
			end
		end

		if result.trackPosition then
			local pos = tonumber(result.trackPosition)
			if pos and pos >= 0 then
				state.position = pos
			end
		end

		return state
	end

	local function determineTrackId(state)
		if not state or not state.name or not state.artist then
			return nil
		end
		return table.concat({ state.name, state.artist, state.album or "" }, "::")
	end

	local function computeLyricLines(position)
		if not lyricsState or not lyricsState.entries then
			return nil, nil
		end

		if not position then
			return lyricsState.entries[1], lyricsState.entries[2]
		end

		local currentEntry = nil
		for i = 1, #lyricsState.entries do
			local entry = lyricsState.entries[i]
			if position + 0.02 >= entry.time then
				currentEntry = entry
			else
				return currentEntry, lyricsState.entries[i]
			end
		end

		return currentEntry, nil
	end

	local function render(state)
		if state and (state.playerState == "not_running" or state.playerState == "stopped") then
			lyricsState = nil
			currentTrackId = nil
		end

		local displayOverlay = shouldDisplayOverlay(state)
		syncOverlayVisibility(displayOverlay)
		if not displayOverlay or not overlay then
			return
		end

		if state and state.playerState ~= "error" and not (lyricsState and lyricsState.error) then
			last_error = nil
		end

		local trackLabel = ""
		if state.name and state.artist then
			trackLabel = string.format("%s - %s", state.name, state.artist)
		elseif state.name then
			trackLabel = state.name
		else
			trackLabel = "Spotify"
		end

		local statusLabel = state.playerState or ""
		if state.duration and state.position then
			trackLabel = string.format("%s | %s %s / %s", trackLabel, statusLabel, formatTime(state.position), formatTime(state.duration))
		elseif statusLabel ~= "" then
			trackLabel = string.format("%s | %s", trackLabel, statusLabel)
		end

		if lyricsState and lyricsState.loading then
			updateOverlayTexts(trackLabel, "Loading lyrics...", "")
			return
		end

		if lyricsState and lyricsState.error then
			updateOverlayTexts(trackLabel, lyricsState.error, "")
			return
		end

		local currentEntry, nextEntry = computeLyricLines(state.position)
		if currentEntry then
			local main = currentEntry.text ~= "" and currentEntry.text or "♪"
			local secondary = nextEntry and nextEntry.text or ""
			updateOverlayTexts(trackLabel, main, secondary)
		elseif nextEntry then
			updateOverlayTexts(trackLabel, "", nextEntry.text)
		else
			updateOverlayTexts(trackLabel, "Lyrics not ready", "")
		end
	end

	local function handleLyricsResponse(state, requestId, status, body)
		if requestId ~= fetchToken then
			return
		end

		if status ~= 200 or not body or body == "" then
			logErrorOnce("lyrics-http", "Lyrics request failed (HTTP " .. tostring(status) .. ")")
			lyricsState = { error = "Lyrics unavailable" }
			render(currentTrackState or state)
			return
		end

		local ok, payload = pcall(hs.json.decode, body)
		if not ok or type(payload) ~= "table" then
			logErrorOnce("lyrics-parse", "Lyrics response could not be decoded")
			lyricsState = { error = "Lyrics unavailable" }
			render(currentTrackState or state)
			return
		end

		local entries = parseSyncedLyrics(payload.syncedLyrics)
		if not entries or #entries == 0 then
			logErrorOnce("lyrics-empty", "No synced lyrics found")
			lyricsState = { error = "No synced lyrics found" }
			render(currentTrackState or state)
			return
		end

		lyricsState = { entries = entries }
		render(currentTrackState or state)
	end

	local function fetchLyrics(state)
		if not state or not state.name or not state.artist then
			logErrorOnce("lyrics-track", "Missing track info for lyrics request")
			lyricsState = { error = "Missing track info" }
			render(state)
			return
		end

		lyricsState = { loading = true }
		render(state)

		fetchToken = fetchToken + 1
		local requestId = fetchToken
		local params = {
			"track_name=" .. hs.http.encodeForQuery(state.name),
			"artist_name=" .. hs.http.encodeForQuery(state.artist),
		}
		local url = string.format("%s?%s", API_ENDPOINT, table.concat(params, "&"))

		hs.http.asyncGet(url, nil, function(status, body)
			handleLyricsResponse(state, requestId, status, body)
		end)
	end

	local function tick()
		local state = getSpotifyState()
		currentTrackState = state

		local newTrackId = determineTrackId(state)
		if newTrackId ~= currentTrackId then
			currentTrackId = newTrackId
			lyricsState = nil
			if newTrackId then
				fetchLyrics(state)
			end
		end

		render(state)
	end

	function P.start()
		if not pollTimer then
			pollTimer = hs.timer.doEvery(POLL_INTERVAL, tick)
			tick()
		end
	end

	function P.stop()
		if pollTimer then
			pollTimer:stop()
			pollTimer = nil
		end
		if dragEventTap then
			dragEventTap:stop()
			dragEventTap = nil
		end
		if overlay then
			overlay:delete()
			overlay = nil
		end
		text_size_state = nil
		currentTrackId = nil
		lyricsState = nil
		dragContext = nil
	end

	function P.toggleVisibility()
		local visible = manager.getSetting(PACKAGE_ID, "overlay.visible", true)
		manager.setSetting(PACKAGE_ID, "overlay.visible", not visible)
		render(currentTrackState)
	end

	function P.isVisible()
		return manager.getSetting(PACKAGE_ID, "overlay.visible", true)
	end

	function P.getMenuItems()
		return {
			{
				title = (P.isVisible() and "Hide" or "Show") .. " Overlay",
				fn = function()
					P.toggleVisibility()
				end,
			},
			{ title = "-" },
			{
				title = string.format("Scale (%.0f%%)", getOverlayScale() * 100),
				disabled = true,
			},
			{
				title = "Increase Size (+10%)",
				fn = function()
					bumpOverlayScale(0.1)
					render(currentTrackState)
				end,
			},
			{
				title = "Decrease Size (-10%)",
				fn = function()
					bumpOverlayScale(-0.1)
					render(currentTrackState)
				end,
			},
			{
				title = "Reset Size",
				fn = function()
					resetOverlaySizes()
					render(currentTrackState)
				end,
			},
		}
	end

	return P
end
