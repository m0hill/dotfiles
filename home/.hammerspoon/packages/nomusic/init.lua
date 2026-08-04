--- No Music
--- Prevent Apple Music or iTunes from launching, with an optional replacement.
---
--- @package nomusic
--- @version v1

return function(manager)
	local P = {}
	local PACKAGE_ID = "nomusic"
	local PACKAGE_NAME = "No Music"
	local HOME = assert(os.getenv("HOME"), "HOME is not set")
	local RUNTIME_DIR = HOME .. "/Library/Application Support/Hammerspoon/NoMusic/bin"
	local HELPER_PATH = RUNTIME_DIR .. "/nomusic-helper"
	local SOURCE_PATH = hs.configdir .. "/packages/nomusic/helper/main.swift"

	local active = false
	local status = "stopped"
	local helper_task = nil
	local build_task = nil

	local function refreshMenu()
		if manager.refreshMenu then
			manager.refreshMenu()
		end
	end

	local function fileModification(path)
		local attributes = hs.fs.attributes(path)
		return attributes and attributes.modification or nil
	end

	local function helperIsCurrent()
		local helperModified = fileModification(HELPER_PATH)
		local sourceModified = fileModification(SOURCE_PATH)
		return helperModified ~= nil and sourceModified ~= nil and helperModified >= sourceModified
	end

	local function replacement()
		local value = manager.getSetting(PACKAGE_ID, "replacement", nil)
		if type(value) ~= "string" or value == "" then
			return nil
		end
		return value
	end

	local function stopHelper()
		if helper_task and helper_task:isRunning() then
			helper_task:terminate()
		end
		helper_task = nil
	end

	local function startHelper()
		if not active then
			return
		end

		stopHelper()
		local arguments = { "watch" }
		local replacementValue = replacement()
		if replacementValue then
			table.insert(arguments, "--replacement")
			table.insert(arguments, replacementValue)
		end

		helper_task = hs.task.new(HELPER_PATH, function(exitCode, _, stderr)
			helper_task = nil
			if not active then
				return
			end

			local detail = tostring(stderr or ""):gsub("%s+$", "")
			status = "helper exited (" .. tostring(exitCode) .. ")"
			manager.notifyError(
				PACKAGE_NAME,
				detail ~= "" and detail or "The blocker helper exited unexpectedly.",
				{ withdrawAfter = 6 }
			)
			refreshMenu()
		end, arguments)

		if not helper_task or not helper_task:start() then
			helper_task = nil
			status = "could not start helper"
			manager.notifyError(PACKAGE_NAME, "Could not start the blocker helper.", { withdrawAfter = 5 })
			refreshMenu()
			return
		end

		status = replacementValue and "blocking → replacement" or "blocking"
		refreshMenu()
	end

	local function buildHelper()
		if build_task then
			return
		end
		if not fileModification(SOURCE_PATH) then
			status = "helper source missing"
			manager.notifyError(PACKAGE_NAME, "Missing helper source: " .. SOURCE_PATH, { withdrawAfter = 6 })
			refreshMenu()
			return
		end

		stopHelper()
		hs.execute("/bin/mkdir -p " .. string.format("%q", RUNTIME_DIR))
		status = "building helper"
		refreshMenu()

		build_task = hs.task.new("/usr/bin/xcrun", function(exitCode, stdout, stderr)
			build_task = nil
			if exitCode ~= 0 then
				local output = tostring((stderr or "") ~= "" and stderr or stdout or ""):gsub("%s+$", "")
				status = "build failed"
				manager.notifyError(PACKAGE_NAME, output ~= "" and output or "Swift helper build failed.", {
					withdrawAfter = 8,
				})
				refreshMenu()
				return
			end

			if active then
				startHelper()
			else
				status = "stopped"
				refreshMenu()
			end
		end, { "swiftc", "-O", SOURCE_PATH, "-o", HELPER_PATH })

		if not build_task or not build_task:start() then
			build_task = nil
			status = "could not build helper"
			manager.notifyError(PACKAGE_NAME, "Could not start xcrun to build the Swift helper.", { withdrawAfter = 6 })
			refreshMenu()
		end
	end

	local function restartHelper()
		if active then
			if helperIsCurrent() then
				startHelper()
			else
				buildHelper()
			end
		end
	end

	local function setReplacement(value)
		local ok, err = manager.setSetting(PACKAGE_ID, "replacement", value)
		if not ok then
			manager.notifyError(PACKAGE_NAME, "Could not save replacement: " .. tostring(err), { withdrawAfter = 5 })
			return
		end
		restartHelper()
		refreshMenu()
	end

	local function promptForReplacement()
		local button, value = hs.dialog.textPrompt(
			"No Music Replacement",
			"Enter an app path or URL to open when Apple Music is blocked.",
			replacement() or "/Applications/Spotify.app",
			"Save",
			"Cancel"
		)
		if button == "Save" and value and value ~= "" then
			setReplacement(value)
		end
	end

	function P.start()
		active = true
		if helperIsCurrent() then
			startHelper()
		else
			buildHelper()
		end
	end

	function P.stop()
		active = false
		stopHelper()
		if build_task and build_task:isRunning() then
			build_task:terminate()
		end
		build_task = nil
		status = "stopped"
	end

	function P.getStatus()
		return status
	end

	function P.getMenuItems()
		local replacementValue = replacement()
		return {
			{ title = "Blocks: Music and iTunes", disabled = true },
			{
				title = "Replacement: " .. (replacementValue or "none"),
				disabled = true,
			},
			{ title = "Set Replacement…", fn = promptForReplacement },
			{
				title = "Use Spotify",
				checked = replacementValue == "/Applications/Spotify.app",
				fn = function()
					setReplacement("/Applications/Spotify.app")
				end,
			},
			{
				title = "Clear Replacement",
				disabled = replacementValue == nil,
				fn = function()
					setReplacement(nil)
				end,
			},
			{ title = "Rebuild Swift Helper", disabled = build_task ~= nil, fn = buildHelper },
		}
	end

	return P
end
