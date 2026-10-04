--- Spotify Volume Keys
--- Use Option + volume keys to adjust Spotify app volume.
---
--- @package spotifyvolume
--- @version v1

return function(manager)
	local P = {}
	local STEP = 7
	local PACKAGE_NAME = "Spotify Volume"
	local SYSTEM_KEY_DELTAS = { SOUND_DOWN = -STEP, SOUND_UP = STEP }

	local event_tap = nil
	local active_system_keys = {}
	local last_error = nil
	local status = "stopped"

	local function isSpotifyShortcut(flags)
		return type(flags) == "table"
			and flags.alt == true
			and not (flags.cmd == true or flags.ctrl == true or flags.shift == true)
	end

	local function notifyErrorOnce(key, message)
		if last_error == key then
			return
		end
		last_error = key
		manager.notifyError(PACKAGE_NAME, message, { withdrawAfter = 5 })
	end

	local function adjustSpotifyVolume(delta)
		if not hs.application.get("Spotify") then
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
		status = string.format("Spotify %d%%", math.max(0, math.min(100, math.floor(volume + 0.5))))
		return true
	end

	local function handleSystemKey(event)
		local systemKey = event:systemKey()
		local key = type(systemKey) == "table" and systemKey.key or nil
		local delta = key and SYSTEM_KEY_DELTAS[key] or nil
		if not delta then
			return false
		end

		-- Consume the matching release even if Option was released first.
		if not systemKey.down then
			if active_system_keys[key] then
				active_system_keys[key] = nil
				return true
			end
			return false
		end
		if not isSpotifyShortcut(event:getFlags()) then
			return false
		end
		local consumed = adjustSpotifyVolume(delta)
		if consumed then
			active_system_keys[key] = true
		end
		return consumed
	end

	function P.start()
		P.stop()
		last_error = nil
		if hs.accessibilityState and not hs.accessibilityState(false) then
			manager.notify(
				PACKAGE_NAME,
				"Enable Accessibility permission for Hammerspoon so it can catch Option + volume keys.",
				{ withdrawAfter = 5 }
			)
		end
		event_tap = hs.eventtap.new({ hs.eventtap.event.types.systemDefined }, function(event)
			local ok, consumedOrErr = pcall(handleSystemKey, event)
			if not ok then
				status = "error"
				notifyErrorOnce("eventtap", "Option + volume handler failed: " .. tostring(consumedOrErr))
				return false
			end
			return consumedOrErr == true
		end)
		if event_tap then
			event_tap:start()
			status = "listening"
		else
			status = "error"
			manager.notifyError(PACKAGE_NAME, "Could not create the Option + volume event tap")
		end
	end

	function P.stop()
		if event_tap then
			event_tap:stop()
			event_tap = nil
		end
		active_system_keys = {}
		status = "stopped"
	end

	function P.getStatus()
		return status
	end

	return P
end
