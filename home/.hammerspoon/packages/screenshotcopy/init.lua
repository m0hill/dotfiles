--- Screenshot Copy
--- Copies newly saved native macOS screenshots to the clipboard.
---
--- @package screenshotcopy
--- @version v1

return function(manager)
	local P = {}
	local PACKAGE_NAME = "Screenshot Copy"

	local RECENT_WINDOW_SECONDS = 15
	local RETRY_DELAY_SECONDS = 0.25
	local MAX_COPY_ATTEMPTS = 8

	local IMAGE_EXTENSIONS = {
		png = true,
		jpg = true,
		jpeg = true,
		tif = true,
		tiff = true,
		gif = true,
		pdf = true,
	}

	local watcher = nil
	local watch_dir = nil
	local screenshot_name = "Screenshot"
	local pending_paths = {}
	local copied_paths = {}
	local status = "stopped"

	local function trim(value)
		return tostring(value or ""):gsub("^%s+", ""):gsub("%s+$", "")
	end

	local function shellQuote(value)
		local escaped = tostring(value):gsub("\\", "\\\\"):gsub('"', '\\"')
		return '"' .. escaped .. '"'
	end

	local function expandPath(path)
		local home = os.getenv("HOME") or ""
		if path == "~" then
			return home
		end
		if path:sub(1, 2) == "~/" then
			return home .. path:sub(2)
		end
		return path
	end

	local function baseName(path)
		return tostring(path or ""):match("[^/]+$") or tostring(path or "")
	end

	local function getScreenshotDirectory()
		local output, ok = hs.execute("/usr/bin/defaults read com.apple.screencapture location 2>/dev/null")
		local configured = trim(output)
		if ok and configured ~= "" then
			return expandPath(configured)
		end
		return (os.getenv("HOME") or "") .. "/Desktop"
	end

	local function getScreenshotName()
		local output, ok = hs.execute("/usr/bin/defaults read com.apple.screencapture name 2>/dev/null")
		local configured = trim(output)
		if ok and configured ~= "" then
			return configured
		end
		return "Screenshot"
	end

	local function extensionFor(path)
		return baseName(path):match("%.([^.]+)$")
	end

	local function fileUrlForPath(path)
		return "file://" .. hs.http.encodeForQuery(path)
	end

	local function hasScreenshotName(path)
		local lowerName = baseName(path):lower()
		local prefixes = {
			screenshot_name,
			"Screenshot",
			"Screen Shot",
		}

		for _, prefix in ipairs(prefixes) do
			local lowerPrefix = tostring(prefix or ""):lower()
			if lowerPrefix ~= "" and lowerName:sub(1, #lowerPrefix) == lowerPrefix then
				return true
			end
		end

		return false
	end

	local function isScreenshotFile(path)
		local ext = extensionFor(path)
		if not ext or not IMAGE_EXTENSIONS[ext:lower()] then
			return false
		end
		return hasScreenshotName(path)
	end

	local function fileAttributes(path)
		local ok, attrs = pcall(hs.fs.attributes, path)
		if not ok or type(attrs) ~= "table" then
			return nil
		end
		return attrs
	end

	local function isRecentFile(path)
		local attrs = fileAttributes(path)
		if not attrs or attrs.mode ~= "file" then
			return false
		end
		if (attrs.size or 0) <= 0 then
			return false
		end
		return os.time() - (attrs.modification or 0) <= RECENT_WINDOW_SECONDS
	end

	local function rememberCopied(path)
		copied_paths[path] = os.time()
		for copiedPath, copiedAt in pairs(copied_paths) do
			if os.time() - copiedAt > 300 then
				copied_paths[copiedPath] = nil
			end
		end
	end

	local function copyImage(path, attempt)
		attempt = attempt or 1
		pending_paths[path] = nil

		if copied_paths[path] then
			return
		end
		if not isScreenshotFile(path) or not isRecentFile(path) then
			return
		end

		local image = hs.image.imageFromPath(path)
		if not image then
			if attempt < MAX_COPY_ATTEMPTS then
				pending_paths[path] = hs.timer.doAfter(RETRY_DELAY_SECONDS, function()
					copyImage(path, attempt + 1)
				end)
			end
			return
		end

		if hs.pasteboard.writeObjects(image) then
			hs.pasteboard.writeDataForUTI(nil, "public.file-url", fileUrlForPath(path), true)
			hs.pasteboard.writeDataForUTI(nil, "public.utf8-plain-text", path, true)
			rememberCopied(path)
			status = "copied"
		else
			status = "copy failed"
			manager.notifyError(PACKAGE_NAME, "Could not copy " .. baseName(path), { withdrawAfter = 4 })
		end
	end

	local function scheduleCopy(path)
		if copied_paths[path] or pending_paths[path] then
			return
		end
		pending_paths[path] = hs.timer.doAfter(RETRY_DELAY_SECONDS, function()
			copyImage(path, 1)
		end)
	end

	local function scanDirectoryForRecentScreenshots(dir)
		local ok, iterator, state = pcall(hs.fs.dir, dir)
		if not ok or not iterator then
			return
		end

		for name in iterator, state do
			if name ~= "." and name ~= ".." then
				local path = dir .. "/" .. name
				if isScreenshotFile(path) and isRecentFile(path) then
					scheduleCopy(path)
				end
			end
		end
	end

	local function handleChangedPaths(paths)
		for _, path in ipairs(paths or {}) do
			local attrs = fileAttributes(path)
			if attrs and attrs.mode == "file" then
				if isScreenshotFile(path) then
					scheduleCopy(path)
				end
			elseif attrs and attrs.mode == "directory" then
				scanDirectoryForRecentScreenshots(path)
			else
				scanDirectoryForRecentScreenshots(watch_dir)
			end
		end
	end

	function P.start()
		P.stop()

		watch_dir = getScreenshotDirectory()
		screenshot_name = getScreenshotName()

		if not hs.fs.attributes(watch_dir, "mode") then
			status = "missing folder"
			manager.notifyError(PACKAGE_NAME, "Screenshot folder does not exist: " .. watch_dir, { withdrawAfter = 5 })
			return
		end

		watcher = hs.pathwatcher.new(watch_dir, function(paths)
			local ok, err = pcall(handleChangedPaths, paths)
			if not ok then
				status = "error"
				manager.notifyError(PACKAGE_NAME, "Watcher failed: " .. tostring(err), { withdrawAfter = 4 })
			end
		end)

		if watcher then
			watcher:start()
			status = "watching"
		else
			status = "error"
			manager.notifyError(PACKAGE_NAME, "Could not watch screenshot folder")
		end
	end

	function P.stop()
		if watcher then
			watcher:stop()
			watcher = nil
		end
		for path, timer in pairs(pending_paths) do
			if timer then
				timer:stop()
			end
			pending_paths[path] = nil
		end
		status = "stopped"
	end

	function P.getStatus()
		return status
	end

	function P.getMenuItems()
		return {
			{
				title = "Watching: " .. tostring(watch_dir or getScreenshotDirectory()),
				disabled = true,
			},
			{
				title = "Open Screenshot Folder",
				fn = function()
					hs.execute("/usr/bin/open " .. shellQuote(watch_dir or getScreenshotDirectory()))
				end,
			},
			{
				title = "Refresh Watched Folder",
				fn = function()
					P.start()
				end,
			},
		}
	end

	return P
end
