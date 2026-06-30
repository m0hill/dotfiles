--- Color Picker
--- Pick the pixel under the next click and copy its hex code.
---
--- @package colorpicker
--- @version v1

return function(manager)
	local P = {}
	local PACKAGE_ID = "colorpicker"
	local PACKAGE_NAME = "Color Picker"

	local click_tap = nil
	local hotkeys = {}
	local status = "stopped"

	local function clampByte(value)
		value = tonumber(value) or 0
		if value <= 1 then
			value = value * 255
		end
		value = math.floor(value + 0.5)
		if value < 0 then
			return 0
		end
		if value > 255 then
			return 255
		end
		return value
	end

	local function colorToHex(color)
		local rgb = hs.drawing.color.asRGB(color)
		return string.format("#%02X%02X%02X", clampByte(rgb.red), clampByte(rgb.green), clampByte(rgb.blue))
	end

	local function screenForPoint(point)
		for _, screen in ipairs(hs.screen.allScreens()) do
			local frame = screen:fullFrame()
			if point.x >= frame.x and point.x < frame.x + frame.w and point.y >= frame.y and point.y < frame.y + frame.h then
				return screen, frame
			end
		end
		return hs.mouse.getCurrentScreen(), hs.mouse.getCurrentScreen() and hs.mouse.getCurrentScreen():fullFrame() or nil
	end

	local function colorAtPoint(point)
		local screen, frame = screenForPoint(point)
		if not screen or not frame then
			return nil, "Could not find screen under pointer"
		end

		local image = screen:snapshot()
		if not image then
			return nil, "Could not capture screen"
		end

		local size = image:size()
		local localPoint = {
			x = (point.x - frame.x) * (size.w / frame.w),
			y = (point.y - frame.y) * (size.h / frame.h),
		}
		return image:colorAt(localPoint)
	end

	local function stopPicker()
		if click_tap then
			click_tap:stop()
			click_tap = nil
		end
		status = "ready"
	end

	local function pick(event)
		local point = event and event:location() or hs.mouse.absolutePosition()
		stopPicker()

		local ok, color, err = pcall(colorAtPoint, point)
		if not ok or not color then
			status = "error"
			manager.notifyError(PACKAGE_NAME, ok and tostring(err or "No color found") or tostring(color), { withdrawAfter = 4 })
			return true
		end

		local hex = colorToHex(color)
		hs.pasteboard.setContents(hex)
		status = "copied " .. hex
		manager.notify(PACKAGE_NAME, hex .. " copied to clipboard", { withdrawAfter = 3 })
		manager.playSound("success")
		return true
	end

	function P.startPick()
		stopPicker()
		status = "waiting for click"
		manager.notify(PACKAGE_NAME, "Click anywhere to copy that pixel's hex color.", { withdrawAfter = 3 })
		manager.playSound("info")

		click_tap = hs.eventtap.new({ hs.eventtap.event.types.leftMouseDown }, function(event)
			local ok, consumedOrErr = pcall(pick, event)
			if not ok then
				stopPicker()
				status = "error"
				manager.notifyError(PACKAGE_NAME, "Pick failed: " .. tostring(consumedOrErr), { withdrawAfter = 4 })
				return true
			end
			return consumedOrErr == true
		end)

		if click_tap then
			click_tap:start()
		else
			status = "error"
			manager.notifyError(PACKAGE_NAME, "Could not create click watcher")
		end
	end

	function P.start()
		P.stop()
		local defaultHotkey = manager.parseHotkeyString("Cmd+Option+C")
		hotkeys = manager.bindHotkeysToSpec(PACKAGE_ID, {
			pick = { fn = P.startPick },
		}, {
			pick = manager.getHotkey(PACKAGE_ID, "pick", defaultHotkey),
		})
		status = "ready"
	end

	function P.stop()
		stopPicker()
		for _, hotkey in pairs(hotkeys) do
			hotkey:delete()
		end
		hotkeys = {}
		status = "stopped"
	end

	function P.getStatus()
		return status
	end

	function P.getMenuItems()
		return {
			{
				title = "Pick Color Now",
				fn = P.startPick,
			},
		}
	end

	return P
end
