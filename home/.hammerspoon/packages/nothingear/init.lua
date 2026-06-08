--- Nothing Ear
--- Control Nothing Ear ANC, EQ, bass boost, and battery from the Hammerspoon menu.
---
--- @package nothingear
--- @author m0hill

return function(manager)
	local P = {}
	local PACKAGE_ID = "nothingear"
	local HELPER_MARKER = "__NOTHINGEAR_JSON_B64__"

	local CONFIG = {
		ENABLE_NOTIFY = true,
		ENABLE_SOUND = false,
	}

	local ANC_MODES = {
		{ title = "ANC Strong", arg = "strong", value = 1, name = "ANC strong" },
		{ title = "ANC Medium", arg = "medium", value = 2, name = "ANC medium" },
		{ title = "ANC Weak", arg = "weak", value = 3, name = "ANC weak" },
		{ title = "Smart ANC", arg = "smart", value = 4, name = "Smart ANC" },
		{ title = "Off", arg = "off", value = 5, name = "Off" },
		{ title = "Comfortable", arg = "comfortable", value = 6, name = "Comfortable" },
		{ title = "Transparency", arg = "transparency", value = 7, name = "Transparency" },
		{ title = "Smart ANC 2", arg = "smart2", value = 8, name = "Smart ANC 2" },
	}

	local EQ_MODES = {
		{ title = "Balanced", arg = "balanced", value = 0, name = "Balanced" },
		{ title = "More Voice", arg = "voice", value = 1, name = "More voice" },
		{ title = "More Treble", arg = "treble", value = 2, name = "More treble" },
		{ title = "More Bass", arg = "bass", value = 3, name = "More bass" },
		{ title = "Dirac EQ", arg = "dirac", value = 4, name = "Dirac EQ" },
		{ title = "Custom", arg = "custom", value = 5, name = "Custom" },
	}

	local settings = {
		enableNotify = manager.getSetting(PACKAGE_ID, "enableNotify", CONFIG.ENABLE_NOTIFY),
		enableSound = manager.getSetting(PACKAGE_ID, "enableSound", CONFIG.ENABLE_SOUND),
	}

	local helperState = {
		checked = false,
		helperReady = false,
		deviceFound = false,
		message = "Checking helper...",
		deviceName = nil,
	}

	local lastState = {
		ancMode = nil,
		ancModeName = nil,
		eqMode = nil,
		eqModeName = nil,
		battery = nil,
		protocolVersion = nil,
		bassBoost = nil,
	}

	local status_task = nil
	local command_task = nil
	local build_task = nil
	local is_busy = false

	local function packageDir()
		local source = debug.getinfo(1, "S").source or ""
		source = source:gsub("^@", "")
		return source:match("(.+)/init%.lua$") or (hs.configdir .. "/packages/" .. PACKAGE_ID)
	end

	local function runtimeRoot()
		local home = os.getenv("HOME") or ""
		return home .. "/Library/Application Support/Hammerspoon/NothingEar"
	end

	local function helperAppPath()
		return runtimeRoot() .. "/NothingEarHelper.app"
	end

	local function helperExecutablePath()
		return helperAppPath() .. "/Contents/MacOS/nothingear-helper"
	end

	local function helperInfoPlistPath()
		return packageDir() .. "/helper/NothingEarHelper-Info.plist"
	end

	local function shellQuote(value)
		local escaped = tostring(value):gsub("\\", "\\\\"):gsub('"', '\\"')
		return '"' .. escaped .. '"'
	end

	local function helperExists()
		local attrs = hs.fs.attributes(helperExecutablePath())
		if not attrs or attrs.mode ~= "file" then
			return false
		end
		local _, ok = hs.execute("/bin/test -x " .. shellQuote(helperExecutablePath()))
		return ok == true
	end

	local function saveSetting(key, value)
		settings[key] = value
		manager.setSetting(PACKAGE_ID, key, value)
	end

	local function log(message)
		manager.log(PACKAGE_ID, message)
	end

	local function notify(title, text)
		if settings.enableNotify then
			manager.notify(title, text)
		end
	end

	local function notifyError(title, text)
		manager.notifyError(title, text, { notify = settings.enableNotify })
	end

	local function playSound(soundType)
		if settings.enableSound then
			manager.playSound(soundType)
		end
	end

	local function extractHelperPayload(output)
		local payload = nil
		for candidate in (output or ""):gmatch(HELPER_MARKER .. "([A-Za-z0-9+/=]+)") do
			payload = candidate
		end
		return payload
	end

	local function parseJsonResult(contents)
		if not contents or contents == "" then
			return nil
		end
		local okJson, decoded = pcall(hs.json.decode, contents)
		if okJson and type(decoded) == "table" then
			return decoded
		end
		return nil
	end

	local function parseHelperResult(exitCode, stdout, stderr, outputContents)
		local fromFile = parseJsonResult(outputContents)
		if fromFile then
			return fromFile
		end

		local payload = extractHelperPayload(stdout) or extractHelperPayload(stderr)
		if payload then
			local okBase64, decodedBase64 = pcall(hs.base64.decode, payload)
			local okJson, decoded = pcall(hs.json.decode, okBase64 and decodedBase64 or "")
			if okJson and type(decoded) == "table" then
				return decoded
			end
		end

		local fallback = (stderr or "") ~= "" and stderr or stdout or ""
		fallback = fallback:gsub("%s+$", "")
		if fallback == "" then
			fallback = exitCode == 0 and "Helper finished without output." or "Helper failed."
		end

		return {
			ok = exitCode == 0,
			error = fallback,
			message = fallback,
		}
	end

	local function tmpOutputPath()
		local dir = os.getenv("TMPDIR") or "/tmp/"
		return dir .. string.format("nothingear-%d-%d.json", os.time(), math.random(1000, 9999))
	end

	local function readFile(path)
		local file = io.open(path, "r")
		if not file then
			return nil
		end
		local contents = file:read("*all")
		file:close()
		return contents
	end

	local function formatBattery(battery)
		if type(battery) ~= "table" or #battery == 0 then
			return "Battery: unknown"
		end

		local parts = {}
		for _, item in ipairs(battery) do
			local name = item.name or ("device" .. tostring(item.id or ""))
			local level = item.level ~= nil and tostring(item.level) .. "%" or "?"
			if item.charging == true then
				level = level .. " charging"
			end
			table.insert(parts, name .. " " .. level)
		end
		return "Battery: " .. table.concat(parts, ", ")
	end

	local function applyResult(result)
		if type(result) ~= "table" then
			return
		end

		helperState.checked = true
		helperState.helperReady = result.helperReady == true
		helperState.deviceFound = result.deviceFound == true
		helperState.deviceName = result.deviceName
		helperState.message = result.message or result.error or (result.ok and "Ready" or "Error")

		if result.ancMode ~= nil then
			lastState.ancMode = result.ancMode
			lastState.ancModeName = result.ancModeName or tostring(result.ancMode)
		end
		if result.eqMode ~= nil then
			lastState.eqMode = result.eqMode
			lastState.eqModeName = result.eqModeName or tostring(result.eqMode)
		end
		if result.battery ~= nil then
			lastState.battery = result.battery
		end
		if result.protocolVersion ~= nil then
			lastState.protocolVersion = result.protocolVersion
		end
		if result.command == "bass-query" and result.message then
			lastState.bassBoost = result.message
		end
	end

	local function helperMissingMessage()
		return "Helper missing. Build and install nothingear-helper."
	end

	local function runHelper(args, onComplete)
		if not helperExists() then
			helperState.checked = true
			helperState.helperReady = false
			helperState.deviceFound = false
			helperState.message = helperMissingMessage()
			manager.refreshMenu()
			return nil, helperState.message
		end

		-- Launch through LaunchServices instead of as a direct Hammerspoon child. CoreBluetooth's
		-- TCC check requires the launched app bundle's Info.plist privacy string.
		local outputPath = tmpOutputPath()
		local launchArgs = { "-W", "-n", helperAppPath(), "--args" }
		for _, arg in ipairs(args or {}) do
			table.insert(launchArgs, tostring(arg))
		end
		table.insert(launchArgs, "--output")
		table.insert(launchArgs, outputPath)

		local task = hs.task.new("/usr/bin/open", function(exitCode, stdout, stderr)
			local outputContents = readFile(outputPath)
			os.remove(outputPath)
			local result = parseHelperResult(exitCode, stdout, stderr, outputContents)
			onComplete(exitCode, result, stdout, stderr)
		end, launchArgs)

		if not task then
			return nil, "Could not create nothingear-helper task."
		end
		if not task:start() then
			return nil, "Could not start nothingear-helper."
		end
		return task
	end

	local function refreshStatus()
		if status_task or command_task or build_task then
			return
		end

		status_task, _ = runHelper({ "status" }, function(_, result)
			status_task = nil
			applyResult(result)
			manager.refreshMenu()
		end)
	end

	local function runCommand(args, optimistic, successTitle)
		if command_task or build_task then
			notify("Nothing Ear", "Busy")
			return
		end

		is_busy = true
		helperState.message = "Running " .. table.concat(args, " ") .. "..."
		manager.refreshMenu()

		local err = nil
		command_task, err = runHelper(args, function(_, result)
			command_task = nil
			is_busy = false
			applyResult(result)

			if result and result.ok == true then
				if optimistic then
					for key, value in pairs(optimistic) do
						lastState[key] = value
					end
				end
				notify(successTitle or "Nothing Ear", result.message or "Done")
				playSound("success")
			else
				notifyError("Nothing Ear", result and (result.error or result.message) or "Command failed")
				playSound("error")
			end

			manager.refreshMenu()
		end)

		if not command_task then
			is_busy = false
			notifyError("Nothing Ear", err or "Could not start helper")
			manager.refreshMenu()
		end
	end

	local function buildAndInstallHelper()
		if build_task then
			return
		end

		local sourceRoot = packageDir() .. "/helper"
		local buildProduct = sourceRoot .. "/.build/release/nothingear-helper"
		local appPath = helperAppPath()
		local appContents = appPath .. "/Contents"
		local appMacOS = appContents .. "/MacOS"
		local target = helperExecutablePath()
		local command = table.concat({
			"/usr/bin/swift build -c release --package-path " .. shellQuote(sourceRoot),
			"/bin/rm -rf " .. shellQuote(appPath),
			"/bin/mkdir -p " .. shellQuote(appMacOS),
			"/bin/cp " .. shellQuote(helperInfoPlistPath()) .. " " .. shellQuote(appContents .. "/Info.plist"),
			"/bin/cp " .. shellQuote(buildProduct) .. " " .. shellQuote(target),
			"/bin/chmod +x " .. shellQuote(target),
			"/usr/bin/codesign --force --deep --sign - " .. shellQuote(appPath),
		}, " && ")

		helperState.message = "Building helper..."
		manager.refreshMenu()

		build_task = hs.task.new("/bin/zsh", function(exitCode, stdout, stderr)
			build_task = nil
			if exitCode == 0 then
				notify("Nothing Ear", "Helper installed")
				playSound("success")
				refreshStatus()
			else
				local output = ((stderr or "") ~= "" and stderr or stdout or "Build failed"):gsub("%s+$", "")
				helperState.message = "Build failed"
				notifyError("Nothing Ear", output)
				playSound("error")
			end
			manager.refreshMenu()
		end, { "-lc", command })

		if not build_task or not build_task:start() then
			build_task = nil
			notifyError("Nothing Ear", "Could not start Swift build")
			manager.refreshMenu()
		end
	end

	local function setAnc(mode)
		runCommand({ "anc-set", mode.arg }, {
			ancMode = mode.value,
			ancModeName = mode.name,
		}, "Nothing Ear ANC")
	end

	local function setEq(mode)
		runCommand({ "eq-set", mode.arg }, {
			eqMode = mode.value,
			eqModeName = mode.name,
		}, "Nothing Ear EQ")
	end

	local function checkedTitle(isChecked, title)
		return (isChecked and "[x] " or "") .. title
	end

	local function openPackageFolder()
		hs.execute("/usr/bin/open " .. shellQuote(packageDir()))
	end

	local function toggleNotifySetting()
		saveSetting("enableNotify", not settings.enableNotify)
	end

	local function toggleSoundSetting()
		saveSetting("enableSound", not settings.enableSound)
	end

	function P.start()
		refreshStatus()
	end

	function P.stop()
		local tasks = { status_task, command_task, build_task }
		for _, task in ipairs(tasks) do
			if task and task:isRunning() then
				task:terminate()
			end
		end
		status_task = nil
		command_task = nil
		build_task = nil
		is_busy = false
	end

	function P.getMenuItems()
		local installed = helperExists()
		local ancMenu = {
			{ title = "Query Current", fn = function() runCommand({ "anc-query" }, nil, "Nothing Ear ANC") end },
			{ title = "-" },
		}
		for _, mode in ipairs(ANC_MODES) do
			table.insert(ancMenu, {
				title = checkedTitle(lastState.ancMode == mode.value, mode.title),
				disabled = not installed or is_busy,
				fn = function()
					setAnc(mode)
				end,
			})
		end

		local eqMenu = {
			{ title = "Query Current", fn = function() runCommand({ "eq-query" }, nil, "Nothing Ear EQ") end },
			{ title = "-" },
		}
		for _, mode in ipairs(EQ_MODES) do
			table.insert(eqMenu, {
				title = checkedTitle(lastState.eqMode == mode.value, mode.title),
				disabled = not installed or is_busy,
				fn = function()
					setEq(mode)
				end,
			})
		end

		return {
			{
				title = installed and "Helper: installed" or "Helper: missing",
				disabled = true,
			},
			{
				title = "Status: " .. (helperState.message or "unknown"),
				disabled = true,
			},
			{
				title = helperState.deviceName and ("Device: " .. helperState.deviceName) or "Device: unknown",
				disabled = true,
			},
			{
				title = build_task and "Building Helper..." or "Build / Install Helper",
				disabled = build_task ~= nil,
				fn = buildAndInstallHelper,
			},
			{
				title = "Recheck Status",
				disabled = status_task ~= nil or build_task ~= nil,
				fn = refreshStatus,
			},
			{ title = "-" },
			{
				title = "ANC" .. (lastState.ancModeName and (": " .. lastState.ancModeName) or ""),
				disabled = not installed,
				menu = ancMenu,
			},
			{
				title = "EQ" .. (lastState.eqModeName and (": " .. lastState.eqModeName) or ""),
				disabled = not installed,
				menu = eqMenu,
			},
			{
				title = formatBattery(lastState.battery),
				disabled = not installed,
				menu = {
					{ title = "Refresh Battery", fn = function() runCommand({ "battery" }, nil, "Nothing Ear Battery") end },
				},
			},
			{
				title = lastState.bassBoost or "Bass Boost",
				disabled = not installed,
				menu = {
					{ title = "Query", fn = function() runCommand({ "bass-query" }, nil, "Nothing Ear Bass") end },
					{ title = "On Level 5", fn = function() runCommand({ "bass-set", "on", "5" }, { bassBoost = "Bass boost: on, level 5" }, "Nothing Ear Bass") end },
					{ title = "On Level 10", fn = function() runCommand({ "bass-set", "on", "10" }, { bassBoost = "Bass boost: on, level 10" }, "Nothing Ear Bass") end },
					{ title = "Off", fn = function() runCommand({ "bass-set", "off", "0" }, { bassBoost = "Bass boost: off" }, "Nothing Ear Bass") end },
				},
			},
			{
				title = lastState.protocolVersion and ("Protocol: " .. lastState.protocolVersion) or "Protocol Version",
				disabled = not installed,
				fn = function()
					runCommand({ "protocol" }, nil, "Nothing Ear")
				end,
			},
			{ title = "-" },
			{
				title = (settings.enableNotify and "[x] " or "") .. "Show notifications",
				fn = toggleNotifySetting,
			},
			{
				title = (settings.enableSound and "[x] " or "") .. "Play sounds",
				fn = toggleSoundSetting,
			},
			{
				title = "Open Package Folder",
				fn = openPackageFolder,
			},
		}
	end

	function P.getStatus()
		if build_task then
			return "Building..."
		end
		if is_busy then
			return "Working..."
		end
		if not helperExists() then
			return "Helper missing"
		end
		if lastState.ancModeName then
			return "ANC " .. lastState.ancModeName
		end
		if helperState.checked and not helperState.deviceFound then
			return "No device"
		end
		return helperState.message or "Ready"
	end

	return P
end
