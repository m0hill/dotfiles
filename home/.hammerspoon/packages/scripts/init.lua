--- Run Script
--- Run local scripts from the Automations manager; Paper is the first default entry.
---
--- @package scripts

return function(manager)
	local P = {}
	local PACKAGE_ID = "scripts"
	local PACKAGE_NAME = "Run Script"
	local HOME = assert(os.getenv("HOME"), "HOME is not set")
	local DEFAULT_SCRIPTS = { { name = "Paper", path = "~/projects/paper/paper.sh" } }
	local TASK_PATH = table.concat({
		HOME .. "/.local/share/mise/shims",
		"/opt/homebrew/bin",
		"/usr/local/bin",
		"/usr/bin",
		"/bin",
	}, ":")

	local scripts = {}
	local current_task = nil
	local running_script = nil
	local cancelled = false
	local last_results = {}

	local function expandPath(path)
		return (path:gsub("^~", HOME))
	end

	local function refreshMenu()
		manager.refreshMenu()
	end

	local function scriptExists(script)
		return hs.fs.attributes(expandPath(script.path), "mode") == "file"
	end

	local function saveScripts(updated)
		local ok, err = manager.setSetting(PACKAGE_ID, "scripts", updated)
		if not ok then
			manager.notifyError(PACKAGE_NAME, "Could not save scripts: " .. tostring(err), { withdrawAfter = 5 })
			return
		end
		scripts = updated
		refreshMenu()
	end

	function P.run(script)
		if current_task then
			return
		end
		local path = expandPath(script.path)
		if not scriptExists(script) then
			last_results[script.path] = "script missing"
			manager.notifyError(script.name, "Script not found: " .. path, { withdrawAfter = 5 })
			refreshMenu()
			return
		end

		local args = { "PATH=" .. TASK_PATH }
		-- Shell scripts need not be executable. Other scripts use their executable shebang.
		if path:match("%.sh$") then
			args[#args + 1] = "/bin/bash"
		end
		args[#args + 1] = path
		last_results[script.path] = nil
		cancelled = false
		local task
		task = hs.task.new("/usr/bin/env", function(exitCode, stdout, stderr)
			if current_task ~= task then
				return
			end
			current_task, running_script = nil, nil
			local output = tostring((stderr or "") ~= "" and stderr or stdout or ""):gsub("%s+$", "")
			if cancelled then
				last_results[script.path] = "cancelled"
				manager.notify(script.name, "Script cancelled", { withdrawAfter = 3 })
			elseif exitCode == 0 then
				last_results[script.path] = "succeeded"
				manager.notify(script.name, output ~= "" and output or "Script completed", { withdrawAfter = 5 })
			else
				last_results[script.path] = "failed (exit " .. tostring(exitCode) .. ")"
				manager.notifyError(
					script.name,
					output ~= "" and output or last_results[script.path],
					{ withdrawAfter = 7 }
				)
			end
			refreshMenu()
		end, args)
		current_task, running_script = task, script
		if not task or not task:start() then
			current_task, running_script = nil, nil
			last_results[script.path] = "could not start"
			manager.notifyError(script.name, "Could not start the script", { withdrawAfter = 5 })
		end
		refreshMenu()
	end

	local function addScript()
		local path = hs.dialog.chooseFileOrFolder("Choose a script to add", HOME, true, false, false)
		if not path or path == "" then
			return
		end
		for _, script in ipairs(scripts) do
			if expandPath(script.path) == path then
				manager.notify(PACKAGE_NAME, "This script is already listed", { withdrawAfter = 3 })
				return
			end
		end
		local defaultName = path:match("([^/]+)$") or path
		local button, name =
			hs.dialog.textPrompt("Script name", "Name shown in the Run Script menu", defaultName, "Add", "Cancel")
		name = tostring(name or ""):match("^%s*(.-)%s*$")
		if button ~= "Add" or name == "" then
			return
		end
		local updated = {}
		for i, script in ipairs(scripts) do
			updated[i] = script
		end
		updated[#updated + 1] = { name = name, path = path }
		saveScripts(updated)
	end

	local function removeScript(index)
		local script = scripts[index]
		if
			hs.dialog.blockAlert(
				"Remove script?",
				"Remove " .. script.name .. " from this menu? The script file will not be deleted.",
				"Remove",
				"Cancel"
			) ~= "Remove"
		then
			return
		end
		local updated = {}
		for i, entry in ipairs(scripts) do
			if i ~= index then
				updated[#updated + 1] = entry
			end
		end
		saveScripts(updated)
	end

	function P.start()
		scripts = manager.getSetting(PACKAGE_ID, "scripts", DEFAULT_SCRIPTS)
		last_results = {}
	end

	function P.stop()
		local task = current_task
		current_task, running_script = nil, nil
		if task and task:isRunning() then
			task:terminate()
		end
	end

	function P.getStatus()
		return running_script and ("running " .. running_script.name) or (#scripts .. " scripts")
	end

	function P.getMenuItems()
		local items = {}
		for index, script in ipairs(scripts) do
			local isRunning = running_script == script
			local submenu = {
				{
					title = isRunning and "Running…" or "Run",
					disabled = current_task ~= nil,
					fn = function()
						P.run(script)
					end,
				},
			}
			if isRunning then
				submenu[#submenu + 1] = {
					title = "Cancel Run",
					fn = function()
						if current_task and running_script == script then
							cancelled = true
							current_task:terminate()
						end
					end,
				}
			end
			if last_results[script.path] then
				submenu[#submenu + 1] = { title = "Last run: " .. last_results[script.path], disabled = true }
			end
			submenu[#submenu + 1] = { title = "Script: " .. script.path, disabled = true }
			submenu[#submenu + 1] = {
				title = "Reveal in Finder",
				disabled = not scriptExists(script),
				fn = function()
					local task = hs.task.new("/usr/bin/open", nil, { "-R", expandPath(script.path) })
					if task then
						task:start()
					end
				end,
			}
			submenu[#submenu + 1] = {
				title = "Remove from Menu…",
				disabled = current_task ~= nil,
				fn = function()
					removeScript(index)
				end,
			}
			items[#items + 1] = { title = script.name, menu = submenu }
		end
		if #scripts == 0 then
			items[#items + 1] = { title = "No scripts added", disabled = true }
		end
		items[#items + 1] = { title = "-" }
		items[#items + 1] = { title = "Add Script…", fn = addScript }
		return items
	end

	return P
end
