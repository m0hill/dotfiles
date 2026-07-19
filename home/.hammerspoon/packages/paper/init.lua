--- Paper
--- Run the local Paper maintenance script from the Automations manager.
---
--- @package paper

return function(manager)
	local P = {}
	local PACKAGE_ID = "paper"
	local PACKAGE_NAME = "Paper"
	local HOME = assert(os.getenv("HOME"), "HOME is not set")
	local DEFAULT_SCRIPT_PATH = HOME .. "/projects/paper/paper.sh"
	local TASK_PATH = table.concat({
		HOME .. "/.local/share/mise/shims",
		"/opt/homebrew/bin",
		"/usr/local/bin",
		"/usr/bin",
		"/bin",
	}, ":")

	local current_task = nil
	local last_result = nil

	local function scriptPath()
		return manager.getSetting(PACKAGE_ID, "scriptPath", DEFAULT_SCRIPT_PATH)
	end

	local function refreshMenu()
		if manager.refreshMenu then
			manager.refreshMenu()
		end
	end

	local function scriptExists()
		return hs.fs.attributes(scriptPath(), "mode") == "file"
	end

	function P.run()
		if current_task then
			return
		end

		local path = scriptPath()
		if not scriptExists() then
			last_result = "script missing"
			manager.notifyError(PACKAGE_NAME, "Script not found: " .. path, { withdrawAfter = 5 })
			refreshMenu()
			return
		end

		last_result = nil
		current_task = hs.task.new("/usr/bin/env", function(exitCode, stdout, stderr)
			current_task = nil
			local output = tostring((stderr or "") ~= "" and stderr or stdout or ""):gsub("%s+$", "")

			if exitCode == 0 then
				last_result = "succeeded"
				manager.notify(PACKAGE_NAME, output ~= "" and output or "Script completed", { withdrawAfter = 5 })
			else
				last_result = "failed (exit " .. tostring(exitCode) .. ")"
				manager.notifyError(PACKAGE_NAME, output ~= "" and output or last_result, { withdrawAfter = 7 })
			end
			refreshMenu()
		end, { "PATH=" .. TASK_PATH, "/bin/bash", path })

		if not current_task or not current_task:start() then
			current_task = nil
			last_result = "could not start"
			manager.notifyError(PACKAGE_NAME, "Could not start the script", { withdrawAfter = 5 })
			refreshMenu()
			return
		end

		refreshMenu()
	end

	function P.start()
		last_result = nil
	end

	function P.stop()
		if current_task and current_task:isRunning() then
			current_task:terminate()
		end
		current_task = nil
	end

	function P.getStatus()
		if current_task then
			return "running"
		end
		if not scriptExists() then
			return "missing"
		end
		return "ready"
	end

	function P.getMenuItems()
		local items = {
			{ title = current_task and "Running…" or "Run Script", disabled = current_task ~= nil, fn = P.run },
		}

		if last_result then
			table.insert(items, { title = "Last run: " .. last_result, disabled = true })
		end

		table.insert(items, { title = "Script: " .. scriptPath(), disabled = true })
		table.insert(items, {
			title = "Reveal Script in Finder",
			disabled = not scriptExists(),
			fn = function()
				hs.execute("/usr/bin/open -R " .. string.format("%q", scriptPath()))
			end,
		})
		return items
	end

	return P
end
