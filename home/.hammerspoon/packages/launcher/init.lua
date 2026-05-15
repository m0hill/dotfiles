--- Launcher
--- Minimal Raycast-lite command palette for apps, fd-backed files, and clipboard history.
---
--- @package launcher
--- @version v1
--- @author m0hill

return function(manager)
	local P = {}
	local PACKAGE_ID = "launcher"
	local DEFAULT_HOTKEY = { { "cmd" }, "space" }
	local DEFAULT_CLIPBOARD_HOTKEY = { { "cmd", "shift" }, "v" }

	local CONFIG = {
		MAX_APPS = 200,
		MAX_APP_RESULTS = 12,
		MAX_FILE_RESULTS = 20,
		MAX_CLIP_RESULTS = 12,
		MAX_CLIPBOARD_ITEMS = 80,
		MAX_CLIPBOARD_CHARS = 8000,
		MAX_APP_USAGE_ITEMS = 200,
		MAX_DISPLAY_CHARS = 90,
		USE_NATIVE_UI = true,
		NATIVE_BUILD_ON_DEMAND = true,
		FILE_SEARCH_MIN_CHARS = 2,
		FILE_SEARCH_DEBOUNCE = 0.12,
		FILE_SEARCH_TIMEOUT = 2.0,
		FILE_SEARCH_MAX_DEPTH = 8,
		FD_PATHS = {
			"/opt/homebrew/bin/fd",
			"/usr/local/bin/fd",
			"~/.local/bin/fd",
			"~/.cargo/bin/fd",
		},
		FILE_SEARCH_ROOTS = {
			"~/Desktop",
			"~/Documents",
			"~/Downloads",
			"~/dev",
			"~/Developer",
			"~/Projects",
			"~/Workspace",
			"~/Work",
		},
		FILE_SEARCH_EXCLUDES = {
			".git",
			"node_modules",
			"Library",
			"Applications",
			"*.app",
			"Music",
			"Movies",
			"Pictures",
			".Trash",
			"dist",
			"build",
			"target",
			".next",
		},
		CHOOSER_ROWS = 12,
		CHOOSER_WIDTH = 45,
		PERSIST_CLIPBOARD = true,
		APP_SCAN_MAX_DEPTH = 3,
		APP_DIRS = {
			"/Applications",
			"~/Applications",
			"/System/Applications",
			"/System/Applications/Utilities",
		},
		APP_ALIASES = {
			["system settings"] = { "settings", "preferences", "system preferences", "prefs" },
			["system preferences"] = { "settings", "preferences", "system settings", "prefs" },
		},
		IGNORED_CLIPBOARD_BUNDLE_IDS = {
			"com.1password.1password",
			"com.1password.1password7",
			"com.1password.1password8",
			"com.agilebits.onepassword7",
			"com.bitwarden.desktop",
			"com.apple.Passwords",
			"org.keepassxc.keepassxc",
		},
	}

	local chooser = nil
	local native_server = nil
	local native_port = nil
	local native_token = nil
	local native_session = nil
	local native_task = nil
	local native_build_task = nil
	local native_build_callback = nil
	local bound_hotkeys = {}
	local pasteboard_watcher = nil
	local app_cache = {}
	local app_usage = {}
	local clipboard_history = {}
	local file_results = {}
	local previous_app = nil
	local file_search_timer = nil
	local file_search_task = nil
	local file_search_token = 0
	local fd_executable = nil
	local fd_missing_notified = false
	local chooser_mode = "all"
	local settings = {}
	local file_type_icon_cache = {}
	local string_byte = string.byte
	local string_find = string.find
	local string_sub = string.sub
	local handleChoice = nil
	local showChooser = nil


	local function trim(value)
		return tostring(value or ""):match("^%s*(.-)%s*$")
	end

	local function expandHome(path)
		local home = os.getenv("HOME") or ""
		return (path or ""):gsub("^~", home)
	end

	local function basename(path)
		local value = tostring(path or "")
		value = value:gsub("/+$", "")
		return value:match("([^/]+)$") or value
	end

	local function basenameFast(path)
		local value = tostring(path or "")
		local last = #value
		while last > 1 and value:byte(last) == 47 do
			last = last - 1
		end
		for i = last, 1, -1 do
			if value:byte(i) == 47 then
				return value:sub(i + 1, last)
			end
		end
		return value:sub(1, last)
	end

	local function stripAppSuffix(name)
		return tostring(name or ""):gsub("%.app$", "")
	end

	local function normalize(value)
		if type(value) == "string" then
			return value:lower()
		end
		return tostring(value or ""):lower()
	end

	local function singleLine(value)
		return tostring(value or ""):gsub("%s+", " "):match("^%s*(.-)%s*$")
	end

	local function truncate(value, maxLen)
		local text = tostring(value or "")
		maxLen = maxLen or CONFIG.MAX_DISPLAY_CHARS
		if #text <= maxLen then
			return text
		end
		if maxLen <= 1 then
			return text:sub(1, maxLen)
		end
		return text:sub(1, maxLen - 1) .. "…"
	end

	local function shortenPath(path)
		local home = os.getenv("HOME") or ""
		local value = tostring(path or "")
		if home ~= "" and value:sub(1, #home) == home then
			return "~" .. value:sub(#home + 1)
		end
		return value
	end

	local function isDelimiterByte(value)
		return value == 32 or value == 45 or value == 46 or value == 47 or value == 95
	end

	local function scoreFuzzy(query, text)
		local qi = 1
		local queryLen = #query
		local textLen = #text
		local targetByte = query:byte(1)
		local score = 0
		local streak = 0
		local lastPos = 0

		for i = 1, textLen do
			if text:byte(i) == targetByte then
				if lastPos + 1 == i then
					streak = streak + 1
				else
					streak = 0
				end
				score = score + 20 + (streak * 8) - math.min(i - qi, 30)
				lastPos = i
				qi = qi + 1
				if qi > queryLen then
					return 4500 + score - (textLen * 0.1)
				end
				targetByte = query:byte(qi)
			end
		end

		return nil
	end

	local function scorePrepared(q, primary, secondaryText)
		if q == "" then
			return 100
		end
		if primary == "" and secondaryText == "" then
			return nil
		end
		local pos = primary:find(q, 1, true)
		if pos == 1 then
			if #primary == #q then
				return 10000 - #primary
			end
			return 9200 - #primary
		end
		if pos then
			local wordStart = pos
			while wordStart do
				if wordStart > 1 then
					local previous = primary:byte(wordStart - 1)
					if previous == 32 or previous == 45 or previous == 46 or previous == 47 or previous == 95 then
						return 8600 - wordStart
					end
				end
				wordStart = primary:find(q, wordStart + 1, true)
			end
			return 7600 - pos
		end

		if secondaryText ~= "" then
			local secondaryPos = secondaryText:find(q, 1, true)
			if secondaryPos then
				return 6500 - secondaryPos
			end
		end

		if #q > #primary or not primary:find(q:sub(1, 1), 1, true) or not primary:find(q:sub(-1), 1, true) then
			return nil
		end
		return scoreFuzzy(q, primary)
	end

	local function scoreTitle(q, primary)
		if q == "" then
			return 100
		end
		if primary == "" then
			return nil
		end
		local pos = primary:find(q, 1, true)
		if pos == 1 then
			if #primary == #q then
				return 10000 - #primary
			end
			return 9200 - #primary
		end
		if pos then
			local wordStart = pos
			while wordStart do
				if wordStart > 1 then
					local previous = primary:byte(wordStart - 1)
					if previous == 32 or previous == 45 or previous == 46 or previous == 47 or previous == 95 then
						return 8600 - wordStart
					end
				end
				wordStart = primary:find(q, wordStart + 1, true)
			end
			return 7600 - pos
		end

		if #q > #primary or not primary:find(q:sub(1, 1), 1, true) or not primary:find(q:sub(-1), 1, true) then
			return nil
		end
		return scoreFuzzy(q, primary)
	end

	local function scoreText(query, text, secondary)
		return scorePrepared(normalize(trim(query)), normalize(text), normalize(secondary))
	end

	local function kindBoost(kind)
		if kind == "app" then
			return 220
		elseif kind == "clip" then
			return 120
		elseif kind == "file" then
			return 80
		end
		return 0
	end

	local function compareChoices(a, b)
		if a._score ~= b._score then
			return a._score > b._score
		end
		if a._kindOrder ~= b._kindOrder then
			return a._kindOrder < b._kindOrder
		end
		return tostring(a.text or "") < tostring(b.text or "")
	end

	local function compareRankedEntries(a, b)
		if a.score ~= b.score then
			return a.score > b.score
		end
		return tostring(a.title or "") < tostring(b.title or "")
	end

	local function makeChoice(kind, title, subtitle, payload, score, order)
		return {
			text = title,
			subText = subtitle,
			kind = kind,
			payload = payload,
			_score = score,
			_kindOrder = order or 99,
		}
	end

	local function getAppIcon(app)
		if not (hs and hs.image and hs.image.iconForFile) then
			return nil
		end
		if app._iconLoaded then
			return app._icon
		end

		app._iconLoaded = true
		if app.path and app.path ~= "" then
			app._icon = hs.image.iconForFile(app.path)
		end
		return app._icon
	end

	local function fileExtension(file)
		local value = tostring(file.name or file.path or "")
		for i = #value, 1, -1 do
			local byte = string_byte(value, i)
			if byte == 47 then
				return nil
			end
			if byte == 46 and i < #value then
				return normalize(string_sub(value, i + 1))
			end
		end
		return nil
	end

	local function getFileTypeIcon(fileType)
		if not (hs and hs.image and hs.image.iconForFileType and fileType and fileType ~= "") then
			return nil
		end
		local cached = file_type_icon_cache[fileType]
		if cached == nil then
			cached = hs.image.iconForFileType(fileType) or false
			file_type_icon_cache[fileType] = cached
		end
		return cached or nil
	end

	local function getFileIcon(file)
		if not (hs and hs.image) then
			return nil
		end
		if file._iconLoaded then
			return file._icon
		end

		file._iconLoaded = true
		local ext = fileExtension(file)
		file._icon = getFileTypeIcon(ext)
		if file._icon then
			return file._icon
		end

		if hs.image.iconForFile and file.path and file.path ~= "" then
			file._icon = hs.image.iconForFile(file.path)
		end
		return file._icon
	end

	local function getClipboardIcon(clip)
		if not (hs and hs.image) then
			return nil
		end
		if clip._iconLoaded then
			return clip._icon
		end

		clip._iconLoaded = true
		local text = trim(clip.text or "")
		if text:find("\n", 1, true) == nil then
			local expanded = expandHome(text)
			if hs.fs and hs.fs.attributes(expanded) and hs.image.iconForFile then
				clip._icon = hs.image.iconForFile(expanded)
				return clip._icon
			end
		end

		if text:match("^%a[%w+.-]*://") then
			clip._icon = getFileTypeIcon("webloc") or getFileTypeIcon("public.url")
		else
			clip._icon = getFileTypeIcon("txt") or getFileTypeIcon("public.plain-text")
		end
		return clip._icon
	end

	local function getSearchTitle(record)
		if not record._searchTitleLower then
			record._searchTitleLower = normalize(record.name or record.title or record.text or record.path or "")
		end
		return record._searchTitleLower
	end

	local function scoreAliases(q, record, score)
		if not record.aliases then
			return score
		end
		local aliases = record._searchAliasesLower
		if not aliases then
			aliases = {}
			for i, alias in ipairs(record.aliases) do
				aliases[i] = normalize(alias)
			end
			record._searchAliasesLower = aliases
		end
		for _, alias in ipairs(aliases) do
			local aliasScore = scoreTitle(q, alias)
			if aliasScore and (not score or aliasScore > score) then
				score = aliasScore
			end
		end
		return score
	end

	local function pushRanked(choices, query, records, limit, kind, order, make)
		if limit <= 0 then
			return
		end
		local ranked = {}
		local q = normalize(trim(query))
		local boost = kindBoost(kind)
		local worstIndex = nil

		local function refreshWorstIndex()
			worstIndex = 1
			for i = 2, #ranked do
				if compareRankedEntries(ranked[worstIndex], ranked[i]) then
					worstIndex = i
				end
			end
		end

		for index, record in ipairs(records or {}) do
			local titleLower = record._searchTitleLower
			if not titleLower then
				titleLower = normalize(record.name or record.title or record.text or record.path or "")
				record._searchTitleLower = titleLower
			end
			local score = scoreAliases(q, record, scoreTitle(q, titleLower))
			if score then
				score = score + boost + math.max(0, (limit - index))
				local title = nil

				if #ranked < limit then
					title = record.name or record.title or record.text or record.path or ""
					table.insert(ranked, {
						record = record,
						score = score,
						title = title,
					})
					if #ranked == limit then
						refreshWorstIndex()
					end
				else
					local worst = ranked[worstIndex]
					if score > worst.score then
						title = record.name or record.title or record.text or record.path or ""
						ranked[worstIndex] = {
							record = record,
							score = score,
							title = title,
						}
						refreshWorstIndex()
					elseif score == worst.score then
						title = record.name or record.title or record.text or record.path or ""
						if title < worst.title then
							ranked[worstIndex] = {
								record = record,
								score = score,
								title = title,
							}
							refreshWorstIndex()
						end
					end
				end
			end
		end

		table.sort(ranked, compareRankedEntries)
		for _, entry in ipairs(ranked) do
			local choice = make(entry.record, entry.score)
			choice.kind = kind
			choice._score = entry.score
			choice._kindOrder = order
			table.insert(choices, choice)
		end
	end

	local function addClipboardChoices(choices, query, clips, opts)
		local displayChars = opts.maxDisplayChars or CONFIG.MAX_DISPLAY_CHARS
		pushRanked(
			choices,
			query,
			clips,
			opts.maxClipResults or CONFIG.MAX_CLIP_RESULTS,
			"clip",
			2,
			function(clip, score)
				if clip._previewMaxChars ~= displayChars then
					clip._preview = truncate(singleLine(clip.text or ""), displayChars)
					clip._previewMaxChars = displayChars
				end
				local choice = makeChoice("clip", clip._preview, "Clipboard", clip, score, 2)
				if opts.includeImages ~= false then
					choice.image = getClipboardIcon(clip)
				end
				return choice
			end
		)
	end

	local function buildClipboardChoices(query, clips, opts)
		opts = opts or {}
		local choices = {}
		local ranked = {}
		local q = normalize(trim(query))
		local limit = opts.maxClipResults or CONFIG.MAX_CLIP_RESULTS
		local displayChars = opts.maxDisplayChars or CONFIG.MAX_DISPLAY_CHARS
		local worstIndex = nil

		local function refreshWorstIndex()
			worstIndex = 1
			for i = 2, #ranked do
				if compareRankedEntries(ranked[worstIndex], ranked[i]) then
					worstIndex = i
				end
			end
		end

		for index, clip in ipairs(clips or {}) do
			local titleLower = clip._searchTitleLower
			if not titleLower then
				titleLower = normalize(clip.text or "")
				clip._searchTitleLower = titleLower
			end
			local score = scoreTitle(q, titleLower)
			if score then
				score = score + 120 + math.max(0, (limit - index))
				local title = nil

				if #ranked < limit then
					title = clip.text or ""
					table.insert(ranked, {
						record = clip,
						score = score,
						title = title,
					})
					if #ranked == limit then
						refreshWorstIndex()
					end
				else
					local worst = ranked[worstIndex]
					if score > worst.score then
						title = clip.text or ""
						ranked[worstIndex] = {
							record = clip,
							score = score,
							title = title,
						}
						refreshWorstIndex()
					elseif score == worst.score then
						title = clip.text or ""
						if title < worst.title then
							ranked[worstIndex] = {
								record = clip,
								score = score,
								title = title,
							}
							refreshWorstIndex()
						end
					end
				end
			end
		end

		table.sort(ranked, compareRankedEntries)
		for _, entry in ipairs(ranked) do
			local clip = entry.record
			if clip._previewMaxChars ~= displayChars then
				clip._preview = truncate(singleLine(clip.text or ""), displayChars)
				clip._previewMaxChars = displayChars
			end
			local choice = {
				text = clip._preview,
				subText = "Clipboard",
				kind = "clip",
				payload = clip,
			}
			if opts.includeImages ~= false then
				choice.image = getClipboardIcon(clip)
			end
			table.insert(choices, choice)
		end
		return choices
	end

	local function buildChoices(query, apps, clips, files, opts)
		opts = opts or {}
		local q = trim(query)
		local choices = {}

		pushRanked(choices, q, apps, opts.maxAppResults or CONFIG.MAX_APP_RESULTS, "app", 1, function(app, score)
			local choice = makeChoice("app", app.name, "App • " .. shortenPath(app.path or ""), app, score, 1)
			if opts.includeImages ~= false then
				choice.image = getAppIcon(app)
			end
			return choice
		end)

		addClipboardChoices(choices, q, clips, opts)

		if q ~= "" or #(files or {}) > 0 then
			pushRanked(
				choices,
				q,
				files,
				opts.maxFileResults or CONFIG.MAX_FILE_RESULTS,
				"file",
				3,
				function(file, score)
					local name = file.name or basename(file.path)
					local choice = makeChoice("file", name, "File • " .. shortenPath(file.path or ""), file, score, 3)
					if opts.includeImages ~= false then
						choice.image = getFileIcon(file)
					end
					return choice
				end
			)
		end

		table.sort(choices, compareChoices)
		return choices
	end

	local function clipboardPath()
		if settings.clipboardPath and settings.clipboardPath ~= "" then
			return expandHome(settings.clipboardPath)
		end
		local configDir = hs and hs.configdir or "."
		return configDir .. "/packages/launcher/clipboard.json"
	end

	local function readJson(path, defaultValue)
		local file = io.open(path, "r")
		if not file then
			return defaultValue
		end
		local contents = file:read("*all")
		file:close()
		if not contents or contents == "" then
			return defaultValue
		end
		local ok, data = pcall(hs.json.decode, contents)
		if not ok or type(data) ~= "table" then
			return defaultValue
		end
		return data
	end

	local function writeJson(path, data)
		local ok, encoded = pcall(hs.json.encode, data, true)
		if not ok or not encoded then
			return false
		end
		local file = io.open(path, "w")
		if not file then
			return false
		end
		file:write(encoded)
		file:close()
		return true
	end

	local function normalizeAppUsage(value)
		local normalized = {}
		if type(value) ~= "table" then
			return normalized
		end
		for path, stat in pairs(value) do
			if type(path) == "string" and type(stat) == "table" then
				local count = tonumber(stat.count) or 0
				if count > 0 then
					normalized[path] = {
						count = count,
						lastUsed = tonumber(stat.lastUsed) or 0,
						name = type(stat.name) == "string" and stat.name or nil,
					}
				end
			end
		end
		return normalized
	end

	local function appUsageFor(app, usage)
		return (usage or app_usage)[app and app.path or ""]
	end

	local function compareAppsByUsage(a, b, usage)
		local usageA = appUsageFor(a, usage)
		local usageB = appUsageFor(b, usage)
		local countA = usageA and usageA.count or 0
		local countB = usageB and usageB.count or 0
		if countA ~= countB then
			return countA > countB
		end
		local lastA = usageA and usageA.lastUsed or 0
		local lastB = usageB and usageB.lastUsed or 0
		if lastA ~= lastB then
			return lastA > lastB
		end
		return normalize(a and a.name or "") < normalize(b and b.name or "")
	end

	local function sortAppsByUsage(apps, usage)
		table.sort(apps, function(a, b)
			return compareAppsByUsage(a, b, usage)
		end)
		return apps
	end

	local function loadSettings()
		settings = {
			maxAppResults = manager.getSetting(PACKAGE_ID, "maxAppResults", CONFIG.MAX_APP_RESULTS),
			maxFileResults = manager.getSetting(PACKAGE_ID, "maxFileResults", CONFIG.MAX_FILE_RESULTS),
			maxClipResults = manager.getSetting(PACKAGE_ID, "maxClipResults", CONFIG.MAX_CLIP_RESULTS),
			maxClipboardItems = manager.getSetting(PACKAGE_ID, "maxClipboardItems", CONFIG.MAX_CLIPBOARD_ITEMS),
			maxClipboardChars = manager.getSetting(PACKAGE_ID, "maxClipboardChars", CONFIG.MAX_CLIPBOARD_CHARS),
			maxDisplayChars = manager.getSetting(PACKAGE_ID, "maxDisplayChars", CONFIG.MAX_DISPLAY_CHARS),
			useNativeUI = manager.getSetting(PACKAGE_ID, "useNativeUI", CONFIG.USE_NATIVE_UI),
			nativeBuildOnDemand = manager.getSetting(PACKAGE_ID, "nativeBuildOnDemand", CONFIG.NATIVE_BUILD_ON_DEMAND),
			fileSearchMinChars = manager.getSetting(PACKAGE_ID, "fileSearchMinChars", CONFIG.FILE_SEARCH_MIN_CHARS),
			fileSearchDebounce = manager.getSetting(PACKAGE_ID, "fileSearchDebounce", CONFIG.FILE_SEARCH_DEBOUNCE),
			fileSearchTimeout = manager.getSetting(PACKAGE_ID, "fileSearchTimeout", CONFIG.FILE_SEARCH_TIMEOUT),
			fileSearchMaxDepth = manager.getSetting(PACKAGE_ID, "fileSearchMaxDepth", CONFIG.FILE_SEARCH_MAX_DEPTH),
			fileSearchRoots = manager.getSetting(PACKAGE_ID, "fileSearchRoots", CONFIG.FILE_SEARCH_ROOTS),
			fileSearchExcludes = manager.getSetting(PACKAGE_ID, "fileSearchExcludes", CONFIG.FILE_SEARCH_EXCLUDES),
			fdPath = manager.getSetting(PACKAGE_ID, "fdPath", nil),
			persistClipboard = manager.getSetting(PACKAGE_ID, "persistClipboard", CONFIG.PERSIST_CLIPBOARD),
			clipboardPath = manager.getSetting(PACKAGE_ID, "clipboardPath", nil),
			ignoredClipboardBundleIds = manager.getSetting(
				PACKAGE_ID,
				"ignoredClipboardBundleIds",
				CONFIG.IGNORED_CLIPBOARD_BUNDLE_IDS
			),
		}
		app_usage = normalizeAppUsage(manager.getSetting(PACKAGE_ID, "appUsage", {}))
		fd_executable = nil
		fd_missing_notified = false
	end

	local function loadClipboardHistory()
		clipboard_history = {}
		if not settings.persistClipboard then
			return
		end
		local data = readJson(clipboardPath(), {})
		for _, item in ipairs(data) do
			if type(item) == "table" and type(item.text) == "string" and item.text ~= "" then
				table.insert(clipboard_history, {
					text = item.text,
					createdAt = item.createdAt,
					source = item.source,
				})
			end
			if #clipboard_history >= settings.maxClipboardItems then
				break
			end
		end
	end

	local function persistClipboardHistory()
		if not settings.persistClipboard then
			return
		end
		writeJson(clipboardPath(), clipboard_history)
	end

	local function isIgnoredClipboardSource()
		local front = hs.application.frontmostApplication()
		local bundleId = front and front:bundleID()
		if not bundleId then
			return false
		end
		for _, ignored in ipairs(settings.ignoredClipboardBundleIds or {}) do
			if bundleId == ignored then
				return true
			end
		end
		return false
	end

	local function addClipboardText(text, source)
		if type(text) ~= "string" then
			return false
		end
		if text == "" or #text > settings.maxClipboardChars then
			return false
		end

		for i = #clipboard_history, 1, -1 do
			if clipboard_history[i].text == text then
				table.remove(clipboard_history, i)
			end
		end

		table.insert(clipboard_history, 1, {
			text = text,
			createdAt = os.time(),
			source = source,
		})

		while #clipboard_history > settings.maxClipboardItems do
			table.remove(clipboard_history)
		end

		persistClipboardHistory()
		return true
	end

	local function scanAppsInDir(dir, depth, results, seen)
		if depth > CONFIG.APP_SCAN_MAX_DEPTH then
			return
		end

		local ok, _, dirObj = pcall(hs.fs.dir, dir)
		if not ok or type(dirObj) ~= "userdata" then
			return
		end

		local entry = dirObj:next()
		while entry do
			if entry ~= "." and entry ~= ".." then
				local path = dir .. "/" .. entry
				local mode = hs.fs.attributes(path, "mode")
				if mode == "directory" then
					if entry:match("%.app$") then
						if not seen[path] then
							seen[path] = true
							local name = stripAppSuffix(entry)
							table.insert(results, {
								name = name,
								path = path,
								aliases = CONFIG.APP_ALIASES[normalize(name)],
							})
						end
					elseif depth < CONFIG.APP_SCAN_MAX_DEPTH then
						scanAppsInDir(path, depth + 1, results, seen)
					end
				end
			end
			if #results >= CONFIG.MAX_APPS then
				dirObj:close()
				return
			end
			entry = dirObj:next()
		end

		dirObj:close()
	end

	local function refreshApps()
		local results = {}
		local seen = {}
		for _, dir in ipairs(CONFIG.APP_DIRS) do
			scanAppsInDir(expandHome(dir), 0, results, seen)
		end
		sortAppsByUsage(results)
		app_cache = results
	end

	local function pruneAppUsage()
		local entries = {}
		for path, stat in pairs(app_usage) do
			entries[#entries + 1] = {
				path = path,
				count = tonumber(stat.count) or 0,
				lastUsed = tonumber(stat.lastUsed) or 0,
			}
		end
		if #entries <= CONFIG.MAX_APP_USAGE_ITEMS then
			return
		end
		table.sort(entries, function(a, b)
			if a.count ~= b.count then
				return a.count > b.count
			end
			return a.lastUsed > b.lastUsed
		end)
		for i = CONFIG.MAX_APP_USAGE_ITEMS + 1, #entries do
			app_usage[entries[i].path] = nil
		end
	end

	local function persistAppUsage()
		pruneAppUsage()
		if manager.setSetting then
			manager.setSetting(PACKAGE_ID, "appUsage", app_usage)
		end
	end

	local function recordAppUsage(app)
		if not app or not app.path or app.path == "" then
			return
		end
		local stat = app_usage[app.path]
		if not stat then
			stat = { count = 0, lastUsed = 0, name = app.name }
			app_usage[app.path] = stat
		end
		stat.count = (tonumber(stat.count) or 0) + 1
		stat.lastUsed = os.time()
		stat.name = app.name
		sortAppsByUsage(app_cache)
		persistAppUsage()
	end

	local function resetAppUsage()
		app_usage = {}
		sortAppsByUsage(app_cache)
		persistAppUsage()
	end

	local function asList(value, defaultValue)
		if type(value) == "table" then
			return value
		end
		if type(value) == "string" and value ~= "" then
			return { value }
		end
		return defaultValue
	end

	local function pathMode(path)
		if not (hs and hs.fs and hs.fs.attributes) then
			return nil
		end
		return hs.fs.attributes(path, "mode")
	end

	local function resolveFdExecutable()
		if fd_executable ~= nil then
			return fd_executable or nil
		end

		local candidates = {}
		if settings.fdPath and settings.fdPath ~= "" then
			candidates[#candidates + 1] = settings.fdPath
		end
		for _, path in ipairs(CONFIG.FD_PATHS) do
			candidates[#candidates + 1] = path
		end

		for _, path in ipairs(candidates) do
			local expanded = expandHome(path)
			if pathMode(expanded) == "file" then
				fd_executable = expanded
				return expanded
			end
		end

		fd_executable = false
		return nil
	end

	local function resolveFileSearchRoots()
		local roots = {}
		for _, root in ipairs(asList(settings.fileSearchRoots, CONFIG.FILE_SEARCH_ROOTS) or {}) do
			if type(root) == "string" and root ~= "" then
				local expanded = expandHome(root)
				if pathMode(expanded) == "directory" then
					roots[#roots + 1] = expanded
				end
			end
		end

		if #roots == 0 then
			roots[1] = expandHome("~")
		end
		return roots
	end

	local function buildFdArgs(query, limit, roots)
		local args = {
			"--absolute-path",
			"--color",
			"never",
			"--fixed-strings",
			"--ignore-case",
			"--hidden",
			"--type",
			"file",
			"--type",
			"directory",
			"--type",
			"symlink",
			"--max-results",
			tostring(limit or CONFIG.MAX_FILE_RESULTS),
		}

		local maxDepth = tonumber(settings.fileSearchMaxDepth or CONFIG.FILE_SEARCH_MAX_DEPTH)
		if maxDepth and maxDepth > 0 then
			args[#args + 1] = "--max-depth"
			args[#args + 1] = tostring(maxDepth)
		end

		for _, pattern in ipairs(asList(settings.fileSearchExcludes, CONFIG.FILE_SEARCH_EXCLUDES) or {}) do
			if type(pattern) == "string" and pattern ~= "" then
				args[#args + 1] = "--exclude"
				args[#args + 1] = pattern
			end
		end

		args[#args + 1] = "--"
		args[#args + 1] = query
		for _, root in ipairs(roots or {}) do
			args[#args + 1] = root
		end
		return args
	end

	local function parseFileSearchOutput(output, limit)
		if type(output) ~= "string" then
			output = tostring(output or "")
		end
		local results = {}
		local seen = {}
		local resultCount = 0
		local start = 1
		local outputLen = #output
		local outputEnd = outputLen + 1
		while start <= outputLen do
			local newline = string_find(output, "\n", start, true) or outputEnd
			local lineEnd = newline - 1
			local lineLen = lineEnd - start + 1
			if
				lineLen > 0
				and not (
					lineLen >= 4
					and string_byte(output, lineEnd - 3) == 46
					and string_byte(output, lineEnd - 2) == 97
					and string_byte(output, lineEnd - 1) == 112
					and string_byte(output, lineEnd) == 112
				)
			then
				local line = string_sub(output, start, lineEnd)
				if not seen[line] then
					seen[line] = true
					resultCount = resultCount + 1
					local last = lineLen
					while last > 1 and string_byte(line, last) == 47 do
						last = last - 1
					end
					local nameStart = 1
					for i = last, 1, -1 do
						if string_byte(line, i) == 47 then
							nameStart = i + 1
							break
						end
					end
					results[resultCount] = {
						path = line,
						name = string_sub(line, nameStart, last),
					}
					if resultCount >= limit then
						break
					end
				end
			end
			start = newline + 1
		end
		return results
	end

	local function choiceOptions(includeImages)
		return {
			maxAppResults = settings.maxAppResults,
			maxFileResults = settings.maxFileResults,
			maxClipResults = settings.maxClipResults,
			maxDisplayChars = settings.maxDisplayChars,
			includeImages = includeImages ~= false,
		}
	end

	local function computeChoices(query, mode, includeImages)
		local options = choiceOptions(includeImages)
		if mode == "clipboard" then
			return buildClipboardChoices(query, clipboard_history, options)
		end
		return buildChoices(query, app_cache, clipboard_history, file_results, options)
	end

	local function choicesWithEmptyState(choices, mode)
		if #choices > 0 then
			return choices
		end
		return {
			{
				text = "No results",
				subText = mode == "clipboard" and "No clipboard history matches"
					or "Try a different app, file, or clipboard query",
				disabled = true,
			},
		}
	end

	local function isFileSearchRunning()
		if file_search_timer then
			return true
		end
		if file_search_task then
			local ok, running = pcall(function()
				return file_search_task:isRunning()
			end)
			return ok and running == true
		end
		return false
	end

	local function nativeIconInfo(choice)
		local payload = choice.payload or {}
		if choice.kind == "app" then
			return "app", payload.path
		elseif choice.kind == "file" then
			return "file", payload.path
		elseif choice.kind == "clip" then
			local text = trim(payload.text or "")
			if text ~= "" and text:find("\n", 1, true) == nil then
				local expanded = expandHome(text)
				if hs.fs and hs.fs.attributes(expanded) then
					return "path", expanded
				end
			end
			if text:match("^%a[%w+.-]*://") then
				return "url", nil
			end
			return "text", nil
		end
		return choice.kind or "text", nil
	end

	local function refreshNativeChoices(query)
		if not native_session or not native_session.active then
			return nil
		end

		local mode = native_session.mode or chooser_mode or "all"
		query = query or native_session.query or ""
		native_session.query = query
		native_session.version = (native_session.version or 0) + 1
		native_session.choiceMap = {}

		local choices = choicesWithEmptyState(computeChoices(query, mode, false), mode)
		local serialized = {}
		for index, choice in ipairs(choices) do
			local id = string.format("%d:%d", native_session.version, index)
			local iconHint, iconPath = nativeIconInfo(choice)
			native_session.choiceMap[id] = choice
			serialized[index] = {
				id = id,
				kind = choice.kind or "",
				title = tostring(choice.text or ""),
				subtitle = tostring(choice.subText or ""),
				path = iconPath,
				iconHint = iconHint,
				disabled = choice.disabled == true,
			}
		end

		native_session.choices = serialized
		native_session.searching = mode == "all" and isFileSearchRunning() or false
		return native_session
	end

	local function refreshChoices(query)
		if query == nil then
			if chooser then
				query = chooser:query() or ""
			elseif native_session then
				query = native_session.query or ""
			else
				query = ""
			end
		end

		if chooser then
			chooser:choices(choicesWithEmptyState(computeChoices(query, chooser_mode, true), chooser_mode))
		end

		if native_session and native_session.active and native_session.query == query then
			refreshNativeChoices(query)
		end
	end

	local function stopFileSearch()
		if file_search_timer then
			file_search_timer:stop()
			file_search_timer = nil
		end
		if file_search_task and file_search_task:isRunning() then
			file_search_task:terminate()
		end
		file_search_task = nil
	end

	local function searchFiles(query)
		local q = trim(query)
		file_search_token = file_search_token + 1
		local token = file_search_token

		stopFileSearch()
		if #q < settings.fileSearchMinChars then
			file_results = {}
			refreshChoices(q)
			return
		end

		file_search_timer = hs.timer.doAfter(settings.fileSearchDebounce, function()
			file_search_timer = nil
			local fdPath = resolveFdExecutable()
			if not fdPath then
				file_results = {}
				if not fd_missing_notified then
					fd_missing_notified = true
					manager.notify("Launcher", "fd not found; install it with Homebrew or set launcher.fdPath")
				end
				refreshChoices(q)
				return
			end

			local task
			task = hs.task.new(fdPath, function(exitCode, stdOut)
				if file_search_task == task then
					file_search_task = nil
				end
				if token ~= file_search_token then
					return
				end
				if exitCode == 0 then
					file_results = parseFileSearchOutput(stdOut, settings.maxFileResults)
				else
					file_results = {}
				end
				refreshChoices(q)
			end, buildFdArgs(q, settings.maxFileResults, resolveFileSearchRoots()))

			file_search_task = task
			if task then
				task:start()
				hs.timer.doAfter(settings.fileSearchTimeout, function()
					if token == file_search_token and file_search_task == task and task:isRunning() then
						task:terminate()
						file_search_task = nil
					end
				end)
			else
				file_results = {}
				refreshChoices(q)
			end
		end)
	end

	local function openPath(path)
		if not path or path == "" then
			return
		end
		local task = hs.task.new("/usr/bin/open", nil, { path })
		if task then
			task:start()
		end
	end

	local function pasteText(text)
		if not text or text == "" then
			return
		end
		hs.pasteboard.setContents(text)
		if previous_app and previous_app:bundleID() ~= "org.hammerspoon.Hammerspoon" then
			previous_app:activate()
		end
		hs.timer.doAfter(0.06, function()
			hs.eventtap.keyStroke({ "cmd" }, "v", 0)
		end)
	end

	handleChoice = function(choice)
		if not choice or choice.disabled then
			return
		end
		local payload = choice.payload or {}
		if choice.kind == "app" then
			recordAppUsage(payload)
			openPath(payload.path)
		elseif choice.kind == "file" then
			openPath(payload.path)
		elseif choice.kind == "clip" then
			pasteText(payload.text)
		end
	end

	local function makeNativeId()
		if hs.host and type(hs.host.uuid) == "function" then
			local ok, uuid = pcall(hs.host.uuid)
			if ok and uuid and uuid ~= "" then
				return uuid
			end
		end
		return string.format("%d-%06d-%06d", os.time(), math.random(0, 999999), math.random(0, 999999))
	end

	local function nativeDir()
		return (hs and hs.configdir or ".") .. "/packages/launcher"
	end

	local function nativeSourcePath()
		return nativeDir() .. "/NativeLauncher.swift"
	end

	local function nativeBinDir()
		return nativeDir() .. "/bin"
	end

	local function nativeBinaryPath()
		return nativeBinDir() .. "/native-launcher"
	end

	local function shellQuote(value)
		return "'" .. tostring(value or ""):gsub("'", "'\\''") .. "'"
	end

	local function nativeJsonResponse(data, status)
		local ok, encoded = pcall(hs.json.encode, data or {})
		if not ok or not encoded then
			encoded = '{"ok":false,"error":"json encode failed"}'
			status = 500
		end
		return encoded, status or 200, {
			["Content-Type"] = "application/json; charset=utf-8",
			["Cache-Control"] = "no-store",
		}
	end

	local function nativeHeader(headers, name)
		local target = normalize(name)
		for key, value in pairs(headers or {}) do
			if normalize(key) == target then
				return tostring(value or "")
			end
		end
		return nil
	end

	local function nativeDecodeBody(body)
		if not body or body == "" then
			return {}
		end
		local ok, decoded = pcall(hs.json.decode, body)
		if ok and type(decoded) == "table" then
			return decoded
		end
		return nil
	end

	local function nativeSessionResponse(seq)
		if not native_session or not native_session.active then
			return {
				ok = false,
				error = "no active launcher session",
				seq = seq,
			}
		end
		native_session.searching = native_session.mode == "all" and isFileSearchRunning() or false
		return {
			ok = true,
			session = native_session.id,
			mode = native_session.mode,
			query = native_session.query or "",
			version = native_session.version or 0,
			seq = seq,
			searching = native_session.searching == true,
			choices = native_session.choices or {},
		}
	end

	local function finishNativeSession()
		stopFileSearch()
		native_session = nil
	end

	local function routeNativeRequest(method, path, headers, body)
		if path == "/health" then
			return nativeJsonResponse({ ok = true })
		end

		if nativeHeader(headers, "Authorization") ~= "Bearer " .. tostring(native_token or "") then
			return nativeJsonResponse({ ok = false, error = "unauthorized" }, 401)
		end

		if method ~= "POST" then
			return nativeJsonResponse({ ok = false, error = "method not allowed" }, 405)
		end

		local data = nativeDecodeBody(body)
		if not data then
			return nativeJsonResponse({ ok = false, error = "invalid json" }, 400)
		end

		local seq = tonumber(data.seq) or 0
		if not native_session or not native_session.active or data.session ~= native_session.id then
			return nativeJsonResponse({ ok = false, error = "session not found", seq = seq }, 404)
		end

		if path == "/query" then
			local mode = data.mode == "clipboard" and "clipboard" or "all"
			local query = tostring(data.query or "")
			native_session.mode = mode
			native_session.query = query
			chooser_mode = mode
			if mode == "all" then
				searchFiles(query)
			else
				file_results = {}
				stopFileSearch()
			end
			refreshNativeChoices(query)
			return nativeJsonResponse(nativeSessionResponse(seq))
		elseif path == "/poll" then
			return nativeJsonResponse(nativeSessionResponse(seq))
		elseif path == "/select" then
			local choice = native_session.choiceMap and native_session.choiceMap[tostring(data.id or "")]
			if not choice or choice.disabled then
				return nativeJsonResponse({ ok = false, error = "choice not found", seq = seq }, 404)
			end
			local selected = choice
			finishNativeSession()
			handleChoice(selected)
			return nativeJsonResponse({ ok = true, seq = seq })
		elseif path == "/cancel" then
			finishNativeSession()
			return nativeJsonResponse({ ok = true, seq = seq })
		end

		return nativeJsonResponse({ ok = false, error = "not found", seq = seq }, 404)
	end

	local function handleNativeRequest(method, path, headers, body)
		local ok, responseBody, status, responseHeaders = pcall(routeNativeRequest, method, path, headers, body)
		if not ok then
			return nativeJsonResponse({ ok = false, error = tostring(responseBody) }, 500)
		end
		return responseBody, status, responseHeaders
	end

	local function ensureNativeServer()
		if native_server then
			return true
		end
		if not (hs and hs.httpserver) then
			manager.notify("Launcher", "hs.httpserver is unavailable; using hs.chooser")
			return false
		end

		native_token = native_token or makeNativeId()
		local ok, serverOrError = pcall(function()
			local server = hs.httpserver.new(false, false)
			server:setInterface("localhost")
			server:maxBodySize(65536)
			server:setCallback(handleNativeRequest)
			server:start()
			return server
		end)

		if not ok or not serverOrError then
			manager.notify("Launcher", "Failed to start native backend")
			return false
		end

		native_server = serverOrError
		native_port = native_server:getPort()
		return native_port ~= nil
	end

	local function nativeBinaryReady()
		if not (hs and hs.fs and hs.fs.attributes) then
			return false, "hs.fs unavailable"
		end
		local source = nativeSourcePath()
		local binary = nativeBinaryPath()
		if not hs.fs.attributes(source, "mode") then
			return false, "NativeLauncher.swift missing"
		end
		if hs.fs.attributes(binary, "mode") ~= "file" then
			return false, "native launcher binary missing"
		end
		local sourceModified = hs.fs.attributes(source, "modification") or 0
		local binaryModified = hs.fs.attributes(binary, "modification") or 0
		if sourceModified > binaryModified then
			return false, "native launcher binary stale"
		end
		return true
	end

	local function ensureNativeBinary(callback)
		local ready = nativeBinaryReady()
		if ready then
			return true
		end
		if settings.nativeBuildOnDemand == false then
			manager.notify("Launcher", "Native launcher binary missing; using hs.chooser")
			return false
		end
		if native_build_task then
			native_build_callback = callback
			return nil
		end

		local source = nativeSourcePath()
		local binary = nativeBinaryPath()
		os.execute("/bin/mkdir -p " .. shellQuote(nativeBinDir()))
		manager.notify("Launcher", "Building native launcher…")
		native_build_callback = callback
		native_build_task = hs.task.new("/usr/bin/xcrun", function(exitCode, stdOut, stdErr)
			native_build_task = nil
			local done = native_build_callback
			native_build_callback = nil
			if exitCode == 0 then
				if done then
					done(true)
				end
			else
				local message = singleLine(stdErr or stdOut or "swiftc failed")
				manager.notify("Launcher", "Native build failed: " .. truncate(message, 120))
				if done then
					done(false)
				end
			end
		end, { "swiftc", "-O", "-framework", "AppKit", "-o", binary, source })

		if not native_build_task then
			manager.notify("Launcher", "Failed to start swiftc; using hs.chooser")
			native_build_callback = nil
			return false
		end
		if not native_build_task:start() then
			native_build_task = nil
			native_build_callback = nil
			manager.notify("Launcher", "Failed to start swiftc; using hs.chooser")
			return false
		end
		return nil
	end

	local function beginNativeSession(mode)
		native_session = {
			id = makeNativeId(),
			mode = mode or "all",
			query = "",
			version = 0,
			choices = {},
			choiceMap = {},
			active = true,
		}
		chooser_mode = native_session.mode
		refreshNativeChoices("")
		return native_session
	end

	local function launchNativeProcess(mode)
		if native_task then
			local ok, running = pcall(function()
				return native_task:isRunning()
			end)
			if ok and running then
				native_task:terminate()
			end
			native_task = nil
		end

		local session = beginNativeSession(mode)
		local binary = nativeBinaryPath()
		local task
		task = hs.task.new(binary, function()
			if native_task == task then
				native_task = nil
				if native_session then
					finishNativeSession()
				end
			end
		end, {
			"--port",
			tostring(native_port),
			"--token",
			native_token,
			"--session",
			session.id,
			"--mode",
			session.mode,
		})

		if not task then
			finishNativeSession()
			manager.notify("Launcher", "Failed to launch native UI; using hs.chooser")
			return false
		end
		native_task = task
		if not task:start() then
			native_task = nil
			finishNativeSession()
			manager.notify("Launcher", "Failed to launch native UI; using hs.chooser")
			return false
		end
		return true
	end

	local function showNativeLauncher(mode)
		previous_app = hs.application.frontmostApplication()
		mode = mode or "all"
		file_results = {}
		if mode == "all" and #app_cache == 0 then
			refreshApps()
		elseif mode == "clipboard" then
			stopFileSearch()
		end

		if not ensureNativeServer() then
			return false
		end

		local function afterBuild(ok)
			if ok and launchNativeProcess(mode) then
				return
			end
			showChooser(mode)
		end

		local binaryStatus = ensureNativeBinary(afterBuild)
		if binaryStatus == true then
			return launchNativeProcess(mode)
		elseif binaryStatus == false then
			return false
		end
		return true
	end

	local function ensureChooser()
		if chooser then
			return
		end
		chooser = hs.chooser.new(handleChoice)
		chooser:searchSubText(true)
		chooser:rows(CONFIG.CHOOSER_ROWS)
		chooser:width(CONFIG.CHOOSER_WIDTH)
		chooser:queryChangedCallback(function(query)
			refreshChoices(query)
			if chooser_mode == "all" then
				searchFiles(query)
			end
		end)
	end

	showChooser = function(mode)
		previous_app = hs.application.frontmostApplication()
		chooser_mode = mode or "all"
		file_results = {}
		if chooser_mode == "all" and #app_cache == 0 then
			refreshApps()
		elseif chooser_mode == "clipboard" then
			stopFileSearch()
		end
		ensureChooser()
		chooser:placeholderText(
			chooser_mode == "clipboard" and "Search clipboard history" or "Search apps, files, and clipboard"
		)
		chooser:query(nil)
		refreshChoices("")
		chooser:show()
	end

	local function showLauncher()
		if settings.useNativeUI and showNativeLauncher("all") then
			return
		end
		showChooser("all")
	end

	local function showClipboardHistory()
		if settings.useNativeUI and showNativeLauncher("clipboard") then
			return
		end
		showChooser("clipboard")
	end

	function P.getHotkeySpec()
		return {
			open = {
				fn = showLauncher,
				description = "Open Launcher",
			},
			clipboard = {
				fn = showClipboardHistory,
				description = "Open Clipboard History",
			},
		}
	end

	function P.start()
		math.randomseed(os.time())
		loadSettings()
		loadClipboardHistory()
		refreshApps()

		local hotkeyDef = manager.getHotkey(PACKAGE_ID, "open", DEFAULT_HOTKEY)
		local clipboardHotkeyDef = manager.getHotkey(PACKAGE_ID, "clipboard", DEFAULT_CLIPBOARD_HOTKEY)
		bound_hotkeys = manager.bindHotkeysToSpec(PACKAGE_ID, P.getHotkeySpec(), {
			open = hotkeyDef,
			clipboard = clipboardHotkeyDef,
		})

		pasteboard_watcher = hs.pasteboard.watcher.new(function(value)
			if isIgnoredClipboardSource() then
				return
			end
			addClipboardText(value, nil)
			if chooser and chooser:isVisible() then
				refreshChoices(chooser:query() or "")
			elseif native_session and native_session.active then
				refreshChoices(native_session.query or "")
			end
		end)
	end

	function P.stop()
		stopFileSearch()
		if native_task then
			local ok, running = pcall(function()
				return native_task:isRunning()
			end)
			if ok and running then
				native_task:terminate()
			end
			native_task = nil
		end
		if native_build_task then
			local ok, running = pcall(function()
				return native_build_task:isRunning()
			end)
			if ok and running then
				native_build_task:terminate()
			end
			native_build_task = nil
			native_build_callback = nil
		end
		if native_server then
			native_server:stop()
			native_server = nil
			native_port = nil
		end
		native_session = nil
		if chooser then
			chooser:hide()
			chooser = nil
		end
		for _, hotkey in pairs(bound_hotkeys or {}) do
			if hotkey and hotkey.delete then
				hotkey:delete()
			end
		end
		bound_hotkeys = {}
		if pasteboard_watcher then
			pasteboard_watcher:stop()
			pasteboard_watcher = nil
		end
	end

	function P.getStatus()
		local ui = settings.useNativeUI and "native" or "chooser"
		return string.format("%d apps, %d clips, %s", #app_cache, #clipboard_history, ui)
	end

	function P.getMenuItems()
		return {
			{
				title = "Open Launcher",
				fn = showLauncher,
			},
			{
				title = "Open Clipboard History",
				fn = showClipboardHistory,
			},
			{
				title = (settings.useNativeUI and "✓ " or "") .. "Use Native UI",
				fn = function()
					settings.useNativeUI = not settings.useNativeUI
					manager.setSetting(PACKAGE_ID, "useNativeUI", settings.useNativeUI)
					manager.notify("Launcher", settings.useNativeUI and "Native UI enabled" or "Using hs.chooser")
				end,
			},
			{
				title = "Refresh App Index",
				fn = function()
					refreshApps()
					manager.notify("Launcher", "Indexed " .. tostring(#app_cache) .. " apps")
				end,
			},
			{
				title = "Reset App Usage",
				fn = function()
					resetAppUsage()
					manager.notify("Launcher", "App usage ranking reset")
				end,
			},
			{
				title = "Clear Clipboard History (" .. tostring(#clipboard_history) .. ")",
				fn = function()
					clipboard_history = {}
					persistClipboardHistory()
				end,
			},
		}
	end

	P._test = {
		basename = basename,
		buildChoices = buildChoices,
		buildClipboardChoices = buildClipboardChoices,
		buildFdArgs = buildFdArgs,
		parseFileSearchOutput = parseFileSearchOutput,
		scoreText = scoreText,
		shortenPath = shortenPath,
		sortAppsByUsage = sortAppsByUsage,
		singleLine = singleLine,
		truncate = truncate,
	}

	return P
end
