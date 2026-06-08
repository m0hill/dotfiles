--- Spotify Volume Keys
--- Use F7/F9 media keys to adjust Spotify app volume.
---
--- @package spotifyvolume
--- @version v1

return function(manager)
	local P = {}
	local STEP = 7
	local PACKAGE_NAME = "Spotify Volume"

	local SYSTEM_KEY_DELTAS = {
		PREVIOUS = -STEP, -- Some keyboards label F7/F9 as previous/next
		NEXT = STEP,
		REWIND = -STEP, -- Mac media keys usually report F7/F9 as rewind/fast-forward
		FAST = STEP,
	}

	local KEYCODE_DELTAS = {
		[hs.keycodes.map.f7] = -STEP,
		[hs.keycodes.map.f9] = STEP,
	}

	local event_tap = nil
	local active_system_keys = {}
	local active_keycodes = {}
	local last_error = nil
	local status = "listening"

	local function clampVolume(volume)
		return math.max(0, math.min(100, math.floor(volume + 0.5)))
	end

	local function hasActionModifiers(flags)
		return type(flags) == "table"
			and (flags.cmd == true or flags.ctrl == true or flags.alt == true or flags.shift == true)
	end

	local function isSpotifyRunning()
		return hs.application.get("Spotify") ~= nil
	end

	local function notifyErrorOnce(key, message)
		if last_error == key then
			return
		end
		last_error = key
		manager.notifyError(PACKAGE_NAME, message, { withdrawAfter = 5 })
	end

	local function adjustSpotifyVolume(delta)
		if not isSpotifyRunning() then
			status = "waiting for Spotify"
			return false
		end

		local script = string.format(
			[[
tell application "Spotify"
	set newVolume to (sound volume as integer) + %d
	if newVolume < 0 then set newVolume to 0
	if newVolume > 100 then set newVolume to 100
	set sound volume to newVolume
	return newVolume
end tell
]],
			delta
		)

		local okLua, okScript, result = pcall(hs.osascript.applescript, script)
		if not okLua or not okScript then
			local message = tostring(okLua and result or okScript)
			status = "error"
			notifyErrorOnce(message, "Could not control Spotify volume: " .. message)
			return false
		end

		local volume = tonumber(result)
		if not volume then
			status = "error"
			notifyErrorOnce("missing-volume", "Spotify did not return a volume value")
			return false
		end

		last_error = nil
		status = string.format("Spotify %d%%", clampVolume(volume))
		return true
	end

	local function handleSystemKey(event)
		local systemKey = event:systemKey()
		local key = type(systemKey) == "table" and systemKey.key or nil
		local delta = key and SYSTEM_KEY_DELTAS[key] or nil
		if not delta then
			return false
		end

		if not systemKey.down then
			if active_system_keys[key] then
				active_system_keys[key] = nil
				return true
			end
			return false
		end

		if hasActionModifiers(event:getFlags()) then
			return false
		end

		local consumed = adjustSpotifyVolume(delta)
		if consumed then
			active_system_keys[key] = true
		end
		return consumed
	end

	local function handleFunctionKey(event)
		local eventType = event:getType()
		local keycode = event:getKeyCode()
		local delta = KEYCODE_DELTAS[keycode]
		if not delta then
			return false
		end

		if eventType == hs.eventtap.event.types.keyUp then
			if active_keycodes[keycode] then
				active_keycodes[keycode] = nil
				return true
			end
			return false
		end

		if hasActionModifiers(event:getFlags()) then
			return false
		end

		local consumed = adjustSpotifyVolume(delta)
		if consumed then
			active_keycodes[keycode] = true
		end
		return consumed
	end

	local function handleEvent(event)
		local eventType = event:getType()
		if eventType == hs.eventtap.event.types.systemDefined then
			return handleSystemKey(event)
		end
		if eventType == hs.eventtap.event.types.keyDown or eventType == hs.eventtap.event.types.keyUp then
			return handleFunctionKey(event)
		end
		return false
	end

	function P.start()
		if event_tap then
			event_tap:stop()
			event_tap = nil
		end

		if hs.accessibilityState and not hs.accessibilityState(false) then
			manager.notify(
				PACKAGE_NAME,
				"Enable Accessibility permission for Hammerspoon so it can catch F7/F9.",
				{ withdrawAfter = 5 }
			)
		end

		event_tap = hs.eventtap.new({
			hs.eventtap.event.types.systemDefined,
			hs.eventtap.event.types.keyDown,
			hs.eventtap.event.types.keyUp,
		}, function(event)
			local ok, consumedOrErr = pcall(handleEvent, event)
			if not ok then
				status = "error"
				notifyErrorOnce("eventtap", "F7/F9 handler failed: " .. tostring(consumedOrErr))
				return false
			end
			return consumedOrErr == true
		end)

		if event_tap then
			event_tap:start()
			status = "listening"
		else
			status = "error"
			manager.notifyError(PACKAGE_NAME, "Could not create the F7/F9 event tap")
		end
	end

	function P.stop()
		if event_tap then
			event_tap:stop()
			event_tap = nil
		end
		active_system_keys = {}
		active_keycodes = {}
		status = "stopped"
	end

	function P.getStatus()
		return status
	end

	return P
end
