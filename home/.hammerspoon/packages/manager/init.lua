return function(config)
	config = config or {}

	local C = {}
	local CONFIG_DIR = config.configDir or hs.configdir
	local PACKAGES_DIR = CONFIG_DIR .. "/packages"

	local MODULES = {
		{
			id = "whisper",
			name = "Whisper",
			description = "Hold hotkey to record and transcribe with Groq Whisper.",
			defaultEnabled = false,
			entryPath = PACKAGES_DIR .. "/whisper/init.lua",
			hotkeys = {
				{ action = "record", description = "Hold to Record", default = "Option+/" },
			},
			secrets = {
				{ key = "GROQ_API_KEY", label = "Groq API Key", hint = "Get from https://console.groq.com/keys" },
			},
		},
		{
			id = "stt",
			name = "STT",
			description = "Hold a trigger to record and transcribe locally with Parakeet.",
			defaultEnabled = false,
			entryPath = PACKAGES_DIR .. "/stt/init.lua",
			hotkeys = {},
			secrets = {},
		},
		{
			id = "gemini",
			name = "Gemini OCR",
			description = "Capture a region and extract text with Gemini.",
			defaultEnabled = false,
			entryPath = PACKAGES_DIR .. "/gemini/init.lua",
			hotkeys = {
				{ action = "capture", description = "Start Capture", default = "Cmd+Shift+S" },
			},
			secrets = {
				{ key = "GEMINI_API_KEY", label = "Gemini API Key", hint = "Get from https://aistudio.google.com/app/apikey" },
			},
		},
		{
			id = "lyrics",
			name = "Lyrics",
			description = "Show a floating synced Spotify lyrics overlay.",
			defaultEnabled = false,
			entryPath = PACKAGES_DIR .. "/lyrics/init.lua",
			hotkeys = {},
			secrets = {},
		},
	}

	local MODULES_BY_ID = {}
	for _, def in ipairs(MODULES) do
		MODULES_BY_ID[def.id] = def
	end

	local runtime = {
		menubar = nil,
		instances = {},
	}

	local SOUNDS = {
		success = "Glass",
		error = "Basso",
		warning = "Funk",
		start = "Ping",
		stop = "Purr",
		info = "Tink",
		capture = "Tink",
		process = "Purr",
		cancel = "Funk",
	}

	local function logLine(prefix, message)
		local text = string.format("[%s] %s", prefix, tostring(message or ""))
		if hs.printf then
			hs.printf(text)
		else
			print(text)
		end
	end

	local function logError(context, err)
		logLine("controller", string.format("%s: %s", context or "error", err or "unknown error"))
	end

	local function readJsonFile(path, defaultValue)
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

	local function writeJsonFile(path, data)
		local ok, encoded = pcall(hs.json.encode, data, true)
		if not ok or not encoded then
			return false, "Failed to encode JSON"
		end

		local file = io.open(path, "w")
		if not file then
			return false, "Failed to open file"
		end

		file:write(encoded)
		file:close()
		return true
	end

	local function getModuleDef(packageId)
		return MODULES_BY_ID[packageId]
	end

	local function getModuleConfigPath(packageId)
		return PACKAGES_DIR .. "/" .. packageId .. "/" .. packageId .. ".json"
	end

	local function getDefaultModuleData(packageId)
		local def = getModuleDef(packageId)
		return {
			enabled = def and def.defaultEnabled == true or false,
			settings = {},
			secrets = {},
		}
	end

	local function getDeclaredSecretKeys(packageId)
		local def = getModuleDef(packageId)
		local keys = {}
		for _, secret in ipairs(def and def.secrets or {}) do
			keys[secret.key] = true
		end
		return keys
	end

	local function normalizeModuleData(packageId, data)
		local normalized = getDefaultModuleData(packageId)
		local secretKeys = getDeclaredSecretKeys(packageId)
		normalized.enabled = data and data.enabled == true or false

		local settings = type(data and data.settings) == "table" and data.settings or {}
		for key, value in pairs(settings) do
			if not secretKeys[key] then
				normalized.settings[key] = value
			end
		end

		local secrets = type(data and data.secrets) == "table" and data.secrets or {}
		for key, value in pairs(secrets) do
			if secretKeys[key] then
				normalized.secrets[key] = value
			elseif normalized.settings[key] == nil then
				normalized.settings[key] = value
			end
		end

		for key, value in pairs(settings) do
			if secretKeys[key] and normalized.secrets[key] == nil then
				normalized.secrets[key] = value
			end
		end

		return normalized
	end

	local function readModuleData(packageId)
		local data = readJsonFile(getModuleConfigPath(packageId), getDefaultModuleData(packageId))
		return normalizeModuleData(packageId, data)
	end

	local function writeModuleData(packageId, data)
		local normalized = normalizeModuleData(packageId, data)
		return writeJsonFile(getModuleConfigPath(packageId), normalized)
	end

	local function getModuleEnabled(packageId)
		return readModuleData(packageId).enabled == true
	end

	local function setModuleEnabled(packageId, enabled)
		local data = readModuleData(packageId)
		data.enabled = enabled == true
		local ok, err = writeModuleData(packageId, data)
		if not ok then
			logError("Save enabled state for '" .. packageId .. "'", err)
		end
		return ok, err
	end

	local function getSecretOwner(secretKey)
		for _, def in ipairs(MODULES) do
			for _, secret in ipairs(def.secrets or {}) do
				if secret.key == secretKey then
					return def
				end
			end
		end
		return nil
	end

	local function refreshMenu()
		if runtime.menubar then
			runtime.menubar:setMenu(C.buildMenu())
		end
	end

	function C.refreshMenu()
		refreshMenu()
	end

	function C.notify(title, text, options)
		options = options or {}
		local notification = hs.notify.new({
			title = title,
			informativeText = text or "",
			withdrawAfter = options.withdrawAfter or 3,
		})
		notification:send()
	end

	function C.notifyError(title, text, options)
		options = options or {}
		logError(title or "error", text or "unknown error")
		if options.notify == false then
			return
		end
		C.notify(title, text, options)
	end

	function C.playSound(soundType)
		local soundName = SOUNDS[soundType]
		if not soundName then
			return
		end
		local sound = hs.sound.getByName(soundName)
		if sound then
			sound:play()
		end
	end

	function C.log(packageId, message)
		local prefix = packageId and ("module:" .. packageId) or "controller"
		logLine(prefix, message)
	end

	function C.getSetting(packageId, key, defaultValue)
		local settings = readModuleData(packageId).settings
		local value = settings[key]
		if value == nil then
			return defaultValue
		end
		return value
	end

	function C.setSetting(packageId, key, value)
		local data = readModuleData(packageId)
		if value == nil then
			data.settings[key] = nil
		else
			data.settings[key] = value
		end
		local ok, err = writeModuleData(packageId, data)
		if not ok then
			logError("Save setting '" .. packageId .. "." .. key .. "'", err)
		end
		return ok, err
	end

	function C.getSettings(packageId)
		return readModuleData(packageId).settings
	end

	function C.setSettings(packageId, settingsTable)
		local data = readModuleData(packageId)
		data.settings = type(settingsTable) == "table" and settingsTable or {}
		local ok, err = writeModuleData(packageId, data)
		if not ok then
			logError("Save settings for '" .. packageId .. "'", err)
		end
		return ok, err
	end

	function C.getSecret(key)
		local owner = getSecretOwner(key)
		if not owner then
			return nil
		end
		return readModuleData(owner.id).secrets[key]
	end

	function C.setSecret(key, value)
		local owner = getSecretOwner(key)
		if not owner then
			return false, "Unknown secret key"
		end

		local data = readModuleData(owner.id)
		if value == nil or value == "" then
			data.secrets[key] = nil
		else
			data.secrets[key] = value
		end

		local ok, err = writeModuleData(owner.id, data)
		if not ok then
			logError("Save secret '" .. key .. "'", err)
		end
		return ok, err
	end

	function C.bindHotkeysToSpec(packageId, spec, mapping)
		local boundHotkeys = {}
		if not spec or not mapping then
			return boundHotkeys
		end

		for action, def in pairs(spec) do
			local hotkeyDef = mapping[action]
			if hotkeyDef and type(hotkeyDef) == "table" and #hotkeyDef >= 2 then
				local mods = hotkeyDef[1] or {}
				local key = hotkeyDef[2]
				if key and def.fn then
					local pressFn = nil
					local releaseFn = nil
					if type(def.fn) == "function" then
						pressFn = def.fn
					elseif type(def.fn) == "table" then
						pressFn = def.fn.press
						releaseFn = def.fn.release
					end

					local hk = nil
					if releaseFn then
						hk = hs.hotkey.bind(mods, key, pressFn, releaseFn)
					else
						hk = hs.hotkey.bind(mods, key, pressFn)
					end

					if hk then
						boundHotkeys[action] = hk
					end
				end
			end
		end

		return boundHotkeys
	end

	function C.parseHotkeyString(hotkeyStr)
		if not hotkeyStr or hotkeyStr == "" then
			return nil
		end

		local parts = {}
		for part in hotkeyStr:gmatch("[^+]+") do
			table.insert(parts, part:match("^%s*(.-)%s*$"))
		end
		if #parts == 0 then
			return nil
		end

		local key = parts[#parts]
		local mods = {}
		local modMap = {
			cmd = "cmd",
			command = "cmd",
			ctrl = "ctrl",
			control = "ctrl",
			alt = "alt",
			option = "alt",
			opt = "alt",
			shift = "shift",
		}

		for i = 1, #parts - 1 do
			local mod = modMap[parts[i]:lower()]
			if mod then
				table.insert(mods, mod)
			end
		end

		return { mods, key }
	end

	function C.formatHotkeyString(hotkeyDef)
		if not hotkeyDef or type(hotkeyDef) ~= "table" or #hotkeyDef < 2 then
			return ""
		end

		local mods = hotkeyDef[1] or {}
		local key = hotkeyDef[2] or ""
		local modNames = {
			cmd = "Cmd",
			ctrl = "Ctrl",
			alt = "Option",
			shift = "Shift",
		}

		local parts = {}
		for _, mod in ipairs(mods) do
			table.insert(parts, modNames[mod:lower()] or mod)
		end
		table.insert(parts, key:upper())
		return table.concat(parts, "+")
	end

	function C.getHotkey(packageId, action, defaultHotkey)
		local configured = C.getSetting(packageId, "hotkeys", {})
		if configured[action] then
			return configured[action]
		end
		return defaultHotkey
	end

	function C.setHotkey(packageId, action, hotkeyDef)
		local configured = C.getSetting(packageId, "hotkeys", {})
		configured[action] = hotkeyDef
		return C.setSetting(packageId, "hotkeys", configured)
	end

	local function secretMask(value)
		if not value or value == "" then
			return "[not set]"
		end
		if #value <= 4 then
			return "[****]"
		end
		return "[****" .. value:sub(-4) .. "]"
	end

	local function openSecretPrompt(secretDef)
		local current = C.getSecret(secretDef.key) or ""
		local button, text = hs.dialog.textPrompt(secretDef.label, secretDef.hint or "", current, "Save", "Cancel")
		if button == "Save" then
			C.setSecret(secretDef.key, text)
		end
	end

	local function openHotkeyPrompt(packageId, actionDef)
		local defaultParsed = actionDef.default and C.parseHotkeyString(actionDef.default) or nil
		local currentHotkey = C.getHotkey(packageId, actionDef.action, defaultParsed)
		local currentStr = currentHotkey and C.formatHotkeyString(currentHotkey) or ""
		local hint = string.format(
			"Enter hotkey for '%s'. Leave empty to use default: %s",
			actionDef.description or actionDef.action,
			actionDef.default or "none"
		)
		local button, text = hs.dialog.textPrompt("Configure Hotkey", hint, currentStr, "Save", "Cancel")
		if button ~= "Save" then
			return
		end

		if text and text ~= "" then
			local parsed = C.parseHotkeyString(text)
			if not parsed then
				C.notify("Hotkey", "Invalid hotkey format")
				return
			end
			C.setHotkey(packageId, actionDef.action, parsed)
		else
			C.setHotkey(packageId, actionDef.action, nil)
		end

		local instance = runtime.instances[packageId]
		if instance then
			if instance.stop then
				pcall(instance.stop)
			end
			runtime.instances[packageId] = nil
		end
		C.startModule(packageId)
	end

	local function getModuleStatus(packageId)
		if not getModuleEnabled(packageId) then
			return "off"
		end

		local instance = runtime.instances[packageId]
		if instance and type(instance.getStatus) == "function" then
			local ok, status = pcall(instance.getStatus)
			if ok and type(status) == "string" and status ~= "" then
				return status
			end
		end

		return "on"
	end

	local function cloneMenuItems(items)
		local result = {}
		for _, item in ipairs(items or {}) do
			local copy = {}
			for key, value in pairs(item) do
				copy[key] = value
			end

			if type(item.fn) == "function" then
				local originalFn = item.fn
				copy.fn = function()
					originalFn()
					refreshMenu()
				end
			end

			if type(item.menu) == "table" then
				copy.menu = cloneMenuItems(item.menu)
			end

			table.insert(result, copy)
		end
		return result
	end

	function C.loadModule(packageId)
		local def = getModuleDef(packageId)
		if not def then
			return nil, "Unknown module"
		end
		if runtime.instances[packageId] then
			return runtime.instances[packageId]
		end

		local okLoad, factoryOrErr = pcall(dofile, def.entryPath)
		if not okLoad then
			return nil, tostring(factoryOrErr)
		end
		if type(factoryOrErr) ~= "function" then
			return nil, "Module did not return a factory function"
		end

		local okCreate, instanceOrErr = pcall(factoryOrErr, C)
		if not okCreate then
			return nil, tostring(instanceOrErr)
		end

		if type(instanceOrErr) ~= "table" then
			return nil, "Module factory returned invalid object"
		end

		runtime.instances[packageId] = instanceOrErr
		return instanceOrErr
	end

	function C.startModule(packageId)
		if not getModuleEnabled(packageId) then
			return true
		end

		local instance, err = C.loadModule(packageId)
		if not instance then
			logError("Load module '" .. packageId .. "'", err)
			C.notifyError("Module error", packageId .. ": " .. tostring(err), { withdrawAfter = 5 })
			return false, err
		end

		if type(instance.start) == "function" then
			local ok, startErr = pcall(instance.start)
			if not ok then
				logError("Start module '" .. packageId .. "'", startErr)
				C.notifyError("Module error", packageId .. ": " .. tostring(startErr), { withdrawAfter = 5 })
				return false, startErr
			end
		end

		return true
	end

	function C.stopModule(packageId)
		local instance = runtime.instances[packageId]
		if not instance then
			return true
		end

		if type(instance.stop) == "function" then
			local ok, err = pcall(instance.stop)
			if not ok then
				logError("Stop module '" .. packageId .. "'", err)
			end
		end

		runtime.instances[packageId] = nil
		return true
	end

	function C.toggleModule(packageId)
		local enabled = getModuleEnabled(packageId)
		setModuleEnabled(packageId, not enabled)
		if enabled then
			C.stopModule(packageId)
		else
			C.startModule(packageId)
		end
		refreshMenu()
	end

	local function buildModuleMenu(def)
		local packageId = def.id
		local enabled = getModuleEnabled(packageId)
		local submenu = {
			{
				title = enabled and "Disable" or "Enable",
				fn = function()
					C.toggleModule(packageId)
				end,
			},
			{
				title = "Status: " .. getModuleStatus(packageId),
				disabled = true,
			},
			{
				title = def.description,
				disabled = true,
			},
		}

		if def.hotkeys and #def.hotkeys > 0 then
			table.insert(submenu, { title = "-" })
			table.insert(submenu, { title = "Hotkeys", disabled = true })
			for _, hotkeyDef in ipairs(def.hotkeys) do
				local defaultParsed = hotkeyDef.default and C.parseHotkeyString(hotkeyDef.default) or nil
				local currentHotkey = C.getHotkey(packageId, hotkeyDef.action, defaultParsed)
				local displayStr = currentHotkey and C.formatHotkeyString(currentHotkey) or "[not set]"
				local isCustom = C.getSetting(packageId, "hotkeys", {})[hotkeyDef.action] ~= nil
				table.insert(submenu, {
					title = string.format(
						"%s: %s%s",
						hotkeyDef.description or hotkeyDef.action,
						displayStr,
						isCustom and " (custom)" or ""
					),
					menu = {
						{
							title = "Change Hotkey",
							fn = function()
								openHotkeyPrompt(packageId, hotkeyDef)
								refreshMenu()
							end,
						},
						{
							title = "Reset to Default",
							disabled = not isCustom,
							fn = function()
								C.setHotkey(packageId, hotkeyDef.action, nil)
								C.stopModule(packageId)
								C.startModule(packageId)
								refreshMenu()
							end,
						},
					},
				})
			end
		end

		if def.secrets and #def.secrets > 0 then
			table.insert(submenu, { title = "-" })
			table.insert(submenu, { title = "Secrets", disabled = true })
			for _, secretDef in ipairs(def.secrets) do
				local value = C.getSecret(secretDef.key)
				table.insert(submenu, {
					title = string.format("%s: %s", secretDef.label or secretDef.key, secretMask(value)),
					menu = {
						{
							title = "Set or Update",
							fn = function()
								openSecretPrompt(secretDef)
								refreshMenu()
							end,
						},
						{
							title = "Clear",
							fn = function()
								C.setSecret(secretDef.key, nil)
								refreshMenu()
							end,
						},
					},
				})
			end
		end

		local instance = runtime.instances[packageId]
		if instance and type(instance.getMenuItems) == "function" then
			local ok, itemsOrErr = pcall(instance.getMenuItems)
			if ok and type(itemsOrErr) == "table" and #itemsOrErr > 0 then
				table.insert(submenu, { title = "-" })
				for _, item in ipairs(cloneMenuItems(itemsOrErr)) do
					table.insert(submenu, item)
				end
			end
		end

		return submenu
	end

	function C.buildMenu()
		local menu = {
			{ title = "Automations", disabled = true },
			{ title = "-" },
		}

		for _, def in ipairs(MODULES) do
			table.insert(menu, {
				title = string.format("%s [%s]", def.name, getModuleStatus(def.id)),
				menu = buildModuleMenu(def),
			})
		end

		table.insert(menu, { title = "-" })
		table.insert(menu, {
			title = "Reload Hammerspoon",
			fn = function()
				hs.reload()
			end,
		})
		table.insert(menu, {
			title = "About",
			fn = function()
				hs.dialog.blockAlert(
					"Automations",
					"Local Hammerspoon controller. All modules load from packages/ and keep their JSON config beside their code.",
					"OK"
				)
			end,
		})

		return menu
	end

	function C.start()
		if runtime.menubar then
			C.stop()
		end

		for _, def in ipairs(MODULES) do
			local configPath = getModuleConfigPath(def.id)
			if hs.fs.attributes(configPath, "mode") then
				local ok, err = writeModuleData(def.id, readModuleData(def.id))
				if not ok then
					logError("Normalize module data for '" .. def.id .. "'", err)
				end
			end
		end

		runtime.menubar = hs.menubar.new()
		runtime.menubar:setIcon(hs.image.imageFromName("NSSlideshowTemplate"))
		runtime.menubar:setTooltip("Automations")

		for _, def in ipairs(MODULES) do
			if getModuleEnabled(def.id) then
				C.startModule(def.id)
			end
		end

		refreshMenu()
		return C
	end

	function C.stop()
		for _, def in ipairs(MODULES) do
			C.stopModule(def.id)
		end
		if runtime.menubar then
			runtime.menubar:delete()
			runtime.menubar = nil
		end
		return C
	end

	return C
end
