--- Tiler
--- Focused-window snapping and screen moves for macOS.
---
--- @package tiler
--- @author m0hill

return function(manager)
	local P = {}
	local PACKAGE_ID = "tiler"

	local DEFAULT_GAP = 4
	local MAX_GAP = 80
	local SNAP_TOLERANCE = 6
	local OCCUPIED_OVERLAP_RATIO = 0.25
	local MACBOOK_SCREEN_NAME = "Built-in Retina Display"
	local EXTERNAL_SCREEN_NAME = "WR40-PRO"

	local DEFAULT_HOTKEYS = {
		left = { { "ctrl", "alt" }, "left" },
		right = { { "ctrl", "alt" }, "right" },
		up = { { "ctrl", "alt" }, "up" },
		down = { { "ctrl", "alt" }, "down" },
		maximize = { { "ctrl", "alt" }, "return" },
	}

	local settings = {
		gap = DEFAULT_GAP,
	}

	local bound_hotkeys = {}
	local previous_animation_duration = nil

	local function normalizeGap(value)
		local gap = tonumber(value) or DEFAULT_GAP
		if gap < 0 then
			gap = 0
		end
		if gap > MAX_GAP then
			gap = MAX_GAP
		end
		return math.floor(gap + 0.5)
	end

	local function loadSettings()
		settings.gap = normalizeGap(manager.getSetting(PACKAGE_ID, "gap", DEFAULT_GAP))
	end

	local function notify(text)
		manager.notify("Tiler", text, { withdrawAfter = 2 })
	end

	local function notifyError(text)
		manager.notifyError("Tiler", text, { withdrawAfter = 4 })
	end

	local function round(value)
		if value >= 0 then
			return math.floor(value + 0.5)
		end
		return math.ceil(value - 0.5)
	end

	local function roundFrame(frame)
		return {
			x = round(frame.x),
			y = round(frame.y),
			w = math.max(1, round(frame.w)),
			h = math.max(1, round(frame.h)),
		}
	end

	local function copyFrame(frame)
		return {
			x = frame.x,
			y = frame.y,
			w = frame.w,
			h = frame.h,
		}
	end

	local function getScreenFrame(screen)
		if not screen then
			return nil
		end

		local ok, frame = pcall(function()
			return screen:frame()
		end)
		if not ok or not frame then
			return nil
		end

		return copyFrame(frame)
	end

	local function insetFrame(frame, gap)
		local inset = math.min(gap, math.floor(math.min(frame.w, frame.h) / 4))
		return {
			x = frame.x + inset,
			y = frame.y + inset,
			w = math.max(1, frame.w - (inset * 2)),
			h = math.max(1, frame.h - (inset * 2)),
		}
	end

	local function splitSize(total, gap)
		local dividerGap = total > gap and gap or 0
		local first = math.floor((total - dividerGap) / 2)
		local second = total - dividerGap - first
		return math.max(1, first), math.max(1, second), dividerGap
	end

	local function frameForSnap(action, screen)
		local screenFrame = getScreenFrame(screen)
		if not screenFrame then
			return nil
		end

		local inner = insetFrame(screenFrame, settings.gap)

		if action == "maximize" then
			return roundFrame(inner)
		end

		if action == "left" or action == "right" then
			local leftWidth, rightWidth, dividerGap = splitSize(inner.w, settings.gap)
			if action == "left" then
				return roundFrame({ x = inner.x, y = inner.y, w = leftWidth, h = inner.h })
			end
			return roundFrame({
				x = inner.x + leftWidth + dividerGap,
				y = inner.y,
				w = rightWidth,
				h = inner.h,
			})
		end

		if action == "up" or action == "down" then
			local topHeight, bottomHeight, dividerGap = splitSize(inner.h, settings.gap)
			if action == "up" then
				return roundFrame({ x = inner.x, y = inner.y, w = inner.w, h = topHeight })
			end
			return roundFrame({
				x = inner.x,
				y = inner.y + topHeight + dividerGap,
				w = inner.w,
				h = bottomHeight,
			})
		end

		return nil
	end

	local function callWindowBool(win, methodName, defaultValue)
		if type(win[methodName]) ~= "function" then
			return defaultValue
		end

		local ok, value = pcall(function()
			return win[methodName](win)
		end)
		if not ok then
			return defaultValue
		end
		return value == true
	end

	local function focusedWindow()
		local win = hs.window.focusedWindow()
		if not win then
			notify("No focused window")
			return nil
		end

		if callWindowBool(win, "isFullScreen", false) then
			notify("Native full-screen windows cannot be tiled")
			return nil
		end

		if callWindowBool(win, "isMinimized", false) then
			notify("Focused window is minimized")
			return nil
		end

		if not callWindowBool(win, "isStandard", true) then
			notify("Focused window cannot be tiled")
			return nil
		end

		if not win:screen() then
			notify("Focused window has no screen")
			return nil
		end

		return win
	end

	local function applyFrame(win, frame, actionLabel)
		if not win or not frame then
			return false
		end

		local ok, err = pcall(function()
			win:setFrame(roundFrame(frame), 0)
			win:focus()
		end)

		if not ok then
			notifyError("Could not " .. actionLabel .. ": " .. tostring(err))
			return false
		end

		return true
	end

	local function snap(action)
		local win = focusedWindow()
		if not win then
			return
		end

		local target = frameForSnap(action, win:screen())
		if not target then
			notify("Could not compute target frame")
			return
		end

		applyFrame(win, target, "snap window")
	end

	local function framesClose(a, b, tolerance)
		return math.abs(a.x - b.x) <= tolerance
			and math.abs(a.y - b.y) <= tolerance
			and math.abs(a.w - b.w) <= tolerance
			and math.abs(a.h - b.h) <= tolerance
	end

	local function isSnapped(win, screen, action)
		local target = frameForSnap(action, screen)
		return target and framesClose(roundFrame(win:frame()), target, SNAP_TOLERANCE) or false
	end

	local function screenId(screen)
		if not screen or type(screen.id) ~= "function" then
			return nil
		end

		local ok, id = pcall(function()
			return screen:id()
		end)
		return ok and id or nil
	end

	local function sameScreen(a, b)
		if a == b then
			return true
		end

		local aId = screenId(a)
		local bId = screenId(b)
		return aId ~= nil and bId ~= nil and aId == bId
	end

	local function screenName(screen)
		if not screen or type(screen.name) ~= "function" then
			return nil
		end

		local ok, name = pcall(function()
			return screen:name()
		end)
		return ok and name or nil
	end

	local function findScreenByName(name)
		for _, screen in ipairs(hs.screen.allScreens()) do
			if screenName(screen) == name then
				return screen
			end
		end
		return nil
	end

	local function screenCenterY(screen)
		local frame = getScreenFrame(screen)
		if not frame then
			return 0
		end
		return frame.y + (frame.h / 2)
	end

	local function fallbackVerticalScreens()
		local screens = hs.screen.allScreens()
		if #screens < 2 then
			return nil, nil
		end

		table.sort(screens, function(a, b)
			return screenCenterY(a) < screenCenterY(b)
		end)

		local external = screens[1]
		local macbook = screens[#screens]
		if sameScreen(macbook, external) then
			return nil, nil
		end

		return macbook, external
	end

	local function configuredScreens()
		local macbook = findScreenByName(MACBOOK_SCREEN_NAME)
		local external = findScreenByName(EXTERNAL_SCREEN_NAME)

		if macbook and external and not sameScreen(macbook, external) then
			return macbook, external
		end

		local fallbackMacbook, fallbackExternal = fallbackVerticalScreens()
		return macbook or fallbackMacbook, external or fallbackExternal
	end

	local function intersectionArea(a, b)
		local x1 = math.max(a.x, b.x)
		local y1 = math.max(a.y, b.y)
		local x2 = math.min(a.x + a.w, b.x + b.w)
		local y2 = math.min(a.y + a.h, b.y + b.h)
		return math.max(0, x2 - x1) * math.max(0, y2 - y1)
	end

	local function windowScreen(win)
		local ok, screen = pcall(function()
			return win:screen()
		end)
		return ok and screen or nil
	end

	local function isOccupyingHalf(win, screen, halfFrame)
		if not win or not halfFrame then
			return false
		end

		if
			callWindowBool(win, "isFullScreen", false)
			or callWindowBool(win, "isMinimized", false)
			or not callWindowBool(win, "isVisible", true)
			or not callWindowBool(win, "isStandard", true)
		then
			return false
		end

		if not sameScreen(windowScreen(win), screen) then
			return false
		end

		local ok, frame = pcall(function()
			return win:frame()
		end)
		if not ok or not frame then
			return false
		end

		local halfArea = halfFrame.w * halfFrame.h
		if halfArea <= 0 then
			return false
		end

		return intersectionArea(frame, halfFrame) >= (halfArea * OCCUPIED_OVERLAP_RATIO)
	end

	local function externalTargetFrame(externalScreen)
		local leftFrame = frameForSnap("left", externalScreen)
		local rightFrame = frameForSnap("right", externalScreen)
		if not leftFrame or not rightFrame then
			return frameForSnap("maximize", externalScreen)
		end

		local leftOccupied = false
		local rightOccupied = false
		for _, win in ipairs(hs.window.visibleWindows()) do
			leftOccupied = leftOccupied or isOccupyingHalf(win, externalScreen, leftFrame)
			rightOccupied = rightOccupied or isOccupyingHalf(win, externalScreen, rightFrame)
			if leftOccupied and rightOccupied then
				break
			end
		end

		if not leftOccupied then
			return leftFrame
		end
		if not rightOccupied then
			return rightFrame
		end
		return frameForSnap("maximize", externalScreen)
	end

	local function moveToExternal()
		local win = focusedWindow()
		if not win then
			return
		end

		local macbookScreen, externalScreen = configuredScreens()
		if not externalScreen then
			notify("No external screen")
			return
		end

		if not macbookScreen or not sameScreen(windowScreen(win), macbookScreen) then
			notify("Already on external screen")
			return
		end

		local target = externalTargetFrame(externalScreen)
		if not target then
			notify("Could not compute external target")
			return
		end

		applyFrame(win, target, "move window to external")
	end

	local function moveToMacbook()
		local win = focusedWindow()
		if not win then
			return
		end

		local macbookScreen, externalScreen = configuredScreens()
		if not macbookScreen then
			notify("No MacBook screen")
			return
		end

		if not externalScreen or not sameScreen(windowScreen(win), externalScreen) then
			notify("Already on MacBook screen")
			return
		end

		local target = frameForSnap("maximize", macbookScreen)
		if not target then
			notify("Could not compute MacBook target")
			return
		end

		applyFrame(win, target, "move window to MacBook")
	end

	function P.getHotkeySpec()
		return {
			left = {
				fn = function()
					snap("left")
				end,
				description = "Snap Left Half",
			},
			right = {
				fn = function()
					snap("right")
				end,
				description = "Snap Right Half",
			},
			up = {
				fn = moveToExternal,
				description = "Move to External Monitor",
			},
			down = {
				fn = moveToMacbook,
				description = "Move to MacBook Display",
			},
			maximize = {
				fn = function()
					snap("maximize")
				end,
				description = "Maximize",
			},
		}
	end

	function P.start()
		loadSettings()

		for _, hotkey in pairs(bound_hotkeys or {}) do
			if hotkey and hotkey.delete then
				hotkey:delete()
			end
		end
		bound_hotkeys = {}

		if previous_animation_duration == nil then
			previous_animation_duration = hs.window.animationDuration
		end
		hs.window.animationDuration = 0

		local mapping = {}
		for action, defaultHotkey in pairs(DEFAULT_HOTKEYS) do
			mapping[action] = manager.getHotkey(PACKAGE_ID, action, defaultHotkey)
		end

		bound_hotkeys = manager.bindHotkeysToSpec(PACKAGE_ID, P.getHotkeySpec(), mapping)
	end

	function P.stop()
		for _, hotkey in pairs(bound_hotkeys or {}) do
			if hotkey and hotkey.delete then
				hotkey:delete()
			end
		end
		bound_hotkeys = {}

		if previous_animation_duration ~= nil then
			hs.window.animationDuration = previous_animation_duration
			previous_animation_duration = nil
		end
	end

	function P.getStatus()
		return "on"
	end

	function P.getMenuItems()
		return {}
	end

	return P
end
