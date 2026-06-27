--- Autofocus
--- Focus the clicked window so cross-monitor clicks are not wasted only activating the app.
---
--- @package autofocus
--- @version v1

return function(manager)
	local P = {}
	local PACKAGE_NAME = "Autofocus"

	local event_tap = nil
	local status = "stopped"

	local function callWindowBool(win, methodName, defaultValue)
		if not win or type(win[methodName]) ~= "function" then
			return defaultValue
		end

		local ok, value = pcall(function()
			return win[methodName](win)
		end)
		if not ok or value == nil then
			return defaultValue
		end
		return value == true
	end

	local function windowId(win)
		if not win or type(win.id) ~= "function" then
			return nil
		end

		local ok, id = pcall(function()
			return win:id()
		end)
		if not ok then
			return nil
		end
		return id
	end

	local function isFocusableWindow(win)
		if not win then
			return false
		end
		if not windowId(win) then
			return false
		end
		if not callWindowBool(win, "isVisible", true) then
			return false
		end
		if callWindowBool(win, "isMinimized", false) then
			return false
		end
		if not callWindowBool(win, "isStandard", true) then
			return false
		end
		return true
	end

	local function pointInFrame(point, frame)
		return point
			and frame
			and point.x >= frame.x
			and point.x < frame.x + frame.w
			and point.y >= frame.y
			and point.y < frame.y + frame.h
	end

	local function windowAtPoint(point)
		if not point then
			return nil
		end

		for _, win in ipairs(hs.window.orderedWindows()) do
			if isFocusableWindow(win) then
				local ok, frame = pcall(function()
					return win:frame()
				end)
				if ok and pointInFrame(point, frame) then
					return win
				end
			end
		end

		return nil
	end

	local function windowIdFromEvent(event)
		local props = hs.eventtap.event.properties
		local candidates = {
			props.mouseEventWindowUnderMousePointerThatCanHandleThisEvent,
			props.mouseEventWindowUnderMousePointer,
		}

		for _, prop in ipairs(candidates) do
			if prop then
				local ok, id = pcall(function()
					return event:getProperty(prop)
				end)
				if ok and id and id > 0 then
					return id
				end
			end
		end

		return nil
	end

	local function windowForEvent(event)
		local id = event and windowIdFromEvent(event) or nil
		if id then
			local win = hs.window.get(id)
			if isFocusableWindow(win) then
				return win
			end
		end

		local ok, point = pcall(function()
			return event and event:location() or hs.mouse.absolutePosition()
		end)
		if not ok then
			return nil
		end

		return windowAtPoint(point)
	end

	local function focusedWindowId()
		return windowId(hs.window.focusedWindow())
	end

	local function appName(win)
		local ok, app = pcall(function()
			return win:application()
		end)
		if not ok or not app then
			return "window"
		end
		return app:name() or "window"
	end

	local function focusWindow(win)
		if not isFocusableWindow(win) then
			return false
		end

		local id = windowId(win)
		if id and id == focusedWindowId() then
			status = "watching clicks"
			return false
		end

		local ok, err = pcall(function()
			win:focus()
		end)
		if not ok then
			status = "error"
			manager.notifyError(PACKAGE_NAME, "Could not focus window: " .. tostring(err), { withdrawAfter = 4 })
			return false
		end

		status = "focused " .. appName(win)
		return true
	end

	local function handleEvent(event)
		focusWindow(windowForEvent(event))
		return false
	end

	function P.start()
		P.stop()

		if hs.accessibilityState and not hs.accessibilityState(false) then
			status = "needs accessibility"
			manager.notify(
				PACKAGE_NAME,
				"Enable Accessibility permission for Hammerspoon so it can focus clicked windows.",
				{ withdrawAfter = 5 }
			)
		end

		event_tap = hs.eventtap.new({
			hs.eventtap.event.types.leftMouseDown,
			hs.eventtap.event.types.rightMouseDown,
			hs.eventtap.event.types.otherMouseDown,
		}, function(event)
			local ok, consumedOrErr = pcall(handleEvent, event)
			if not ok then
				status = "error"
				manager.notifyError(PACKAGE_NAME, "Autofocus failed: " .. tostring(consumedOrErr), { withdrawAfter = 4 })
				return false
			end
			return consumedOrErr == true
		end)

		if event_tap then
			event_tap:start()
			if status ~= "needs accessibility" then
				status = "watching clicks"
			end
		else
			status = "error"
			manager.notifyError(PACKAGE_NAME, "Could not create the mouse event tap")
		end
	end

	function P.stop()
		if event_tap then
			event_tap:stop()
			event_tap = nil
		end
		status = "stopped"
	end

	function P.getStatus()
		return status
	end

	return P
end
